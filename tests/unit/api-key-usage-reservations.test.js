import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { SCHEMA_VERSION, TABLES } from "@/lib/db/schema.js";
import { canonicalizeUsage } from "../../open-sse/utils/usageTracking.js";

vi.mock("@/shared/utils/machineId", () => ({
  getConsistentMachineId: vi.fn(async () => "machine-test"),
}));

function getExpectedResetAt(now) {
  const reset = new Date(now);
  reset.setHours(24, 0, 0, 0);
  return reset.toISOString();
}

describe("API key usage reservation schema", () => {
  it("declares version 2 reservation storage and lookup indexes", () => {
    expect(SCHEMA_VERSION).toBe(2);
    expect(TABLES.apiKeyUsageReservations).toEqual({
      columns: {
        id: "TEXT PRIMARY KEY",
        apiKeyId: "TEXT NOT NULL",
        reservedTokens: "INTEGER NOT NULL",
        createdAt: "TEXT NOT NULL",
        expiresAt: "TEXT NOT NULL",
      },
      indexes: [
        "CREATE INDEX IF NOT EXISTS idx_akur_key_expiry ON apiKeyUsageReservations(apiKeyId, expiresAt)",
      ],
    });
    expect(TABLES.usageHistory.indexes).toContain(
      "CREATE INDEX IF NOT EXISTS idx_uh_api_key_ts ON usageHistory(apiKey, timestamp)",
    );
  });
});

describe("API key usage reservation admission", () => {
  const originalDataDir = process.env.DATA_DIR;
  let db;
  let rawDb;
  let tempDir;

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-reservations-"));
    process.env.DATA_DIR = tempDir;
    delete global._dbAdapter;
    vi.resetModules();
    db = await import("@/lib/db/index.js");
    await db.initDb();
    ({ instance: rawDb } = global._dbAdapter);
  });

  beforeEach(() => {
    rawDb.exec("DROP TRIGGER IF EXISTS fail_api_key_delete");
    rawDb.exec("DROP TRIGGER IF EXISTS fail_usage_insert");
    rawDb.transaction(() => {
      rawDb.run("DELETE FROM apiKeyUsageReservations");
      rawDb.run("DELETE FROM usageHistory");
      rawDb.run("DELETE FROM usageDaily");
      rawDb.run("DELETE FROM apiKeys");
    });
  });

  afterAll(() => {
    try { rawDb?.close?.(); } catch {}
    delete global._dbAdapter;
    fs.rmSync(tempDir, { recursive: true, force: true });
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
  });

  it("atomically accepts exactly one of two reservations that cannot both fit", async () => {
    const key = await db.createApiKey("limited", "machine-test", 100);
    const now = new Date("2026-07-19T12:00:00.000Z");

    const results = await Promise.all([
      db.reserveApiKeyUsage(key.key, 60, now),
      db.reserveApiKeyUsage(key.key, 60, now),
    ]);

    expect(results.filter((status) => status.accepted)).toHaveLength(1);
    expect(results.filter((status) => !status.accepted)).toHaveLength(1);
    expect(results.find((status) => status.accepted)).toEqual({
      enforced: true,
      accepted: true,
      reservationId: expect.any(String),
      usedTokens: 0,
      reservedTokens: 60,
      requestedTokens: 60,
      limitTokens: 100,
      remainingTokens: 40,
      resetAt: getExpectedResetAt(now),
    });
    expect(results.find((status) => !status.accepted)).toEqual({
      enforced: true,
      accepted: false,
      reservationId: null,
      usedTokens: 0,
      reservedTokens: 60,
      requestedTokens: 60,
      limitTokens: 100,
      remainingTokens: 40,
      resetAt: getExpectedResetAt(now),
    });

    const reservations = rawDb.all("SELECT * FROM apiKeyUsageReservations");
    expect(reservations).toHaveLength(1);
    expect(reservations[0]).toMatchObject({
      apiKeyId: key.id,
      reservedTokens: 60,
      createdAt: "2026-07-19T12:00:00.000Z",
      expiresAt: "2026-07-19T18:00:00.000Z",
    });
    expect(reservations[0]).not.toHaveProperty("key");
    expect(JSON.stringify(reservations[0])).not.toContain(key.key);
  });

  it("counts committed usage and active reservations in admission and status", async () => {
    const key = await db.createApiKey("limited", "machine-test", 1_000);
    const now = new Date("2026-07-19T12:00:00.000Z");
    await db.saveRequestUsage({
      provider: "openai",
      model: "gpt-4o",
      apiKey: key.key,
      timestamp: now.toISOString(),
      tokens: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150, reasoning_tokens: 50 },
    });

    expect((await db.reserveApiKeyUsage(key.key, 500, now)).accepted).toBe(true);
    expect(await db.reserveApiKeyUsage(key.key, 351, now)).toMatchObject({
      accepted: false,
      usedTokens: 150,
      reservedTokens: 500,
      remainingTokens: 350,
    });
    expect(await db.getApiKeyUsageLimitStatus(key.key, now)).toEqual({
      enforced: true,
      exceeded: false,
      usedTokens: 150,
      reservedTokens: 500,
      limitTokens: 1_000,
      remainingTokens: 350,
      resetAt: getExpectedResetAt(now),
    });
  });

  it("counts Gemini candidate and thought output once", async () => {
    const key = await db.createApiKey("gemini-limited", "machine-test", 1_000);
    const now = new Date("2026-07-19T12:00:00.000Z");
    await db.saveRequestUsage({
      provider: "gemini",
      model: "gemini-2.5-pro",
      apiKey: key.key,
      timestamp: now.toISOString(),
      tokens: canonicalizeUsage({
        prompt_tokens: 100,
        completion_tokens: 40,
        total_tokens: 150,
        reasoning_tokens: 10,
      }),
    });

    expect(await db.getApiKeyUsageLimitStatus(key.key, now)).toMatchObject({
      usedTokens: 150,
      remainingTokens: 850,
    });
  });

  it("reads committed and reserved totals from one status snapshot", async () => {
    const key = await db.createApiKey("limited", "machine-test", 1_000);
    const now = new Date("2026-07-19T12:00:00.000Z");
    const reservation = await db.reserveApiKeyUsage(key.key, 60, now);
    const { createBetterSqliteAdapter } = await import("@/lib/db/adapters/betterSqliteAdapter.js");
    const secondConnection = createBetterSqliteAdapter(path.join(tempDir, "db", "data.sqlite"));
    const originalGet = rawDb.get.bind(rawDb);
    let reconciled = false;
    rawDb.get = (sql, params = []) => {
      const result = originalGet(sql, params);
      if (!reconciled && sql.includes("FROM usageHistory WHERE apiKey")) {
        reconciled = true;
        secondConnection.transaction(() => {
          secondConnection.run("DELETE FROM apiKeyUsageReservations WHERE id = ?", [reservation.reservationId]);
          secondConnection.run(
            `INSERT INTO usageHistory(timestamp, apiKey, promptTokens, completionTokens, tokens)
             VALUES(?, ?, ?, ?, ?)`,
            [now.toISOString(), key.key, 40, 20, "{}"],
          );
        });
      }
      return result;
    };

    try {
      expect(await db.getApiKeyUsageLimitStatus(key.key, now)).toMatchObject({
        usedTokens: 0,
        reservedTokens: 60,
        remainingTokens: 940,
      });
    } finally {
      rawDb.get = originalGet;
      secondConnection.close();
    }
    expect(await db.getApiKeyUsageLimitStatus(key.key, now)).toMatchObject({
      usedTokens: 60,
      reservedTokens: 0,
      remainingTokens: 940,
    });
  });

  it("does not reserve for unlimited, inactive, or missing keys", async () => {
    const unlimited = await db.createApiKey("unlimited", "machine-test");
    const inactive = await db.createApiKey("inactive", "machine-test", 100);
    await db.updateApiKey(inactive.id, { isActive: false });

    for (const key of [unlimited.key, inactive.key, "sk-missing"]) {
      expect(await db.reserveApiKeyUsage(key, 10)).toEqual({
        enforced: false,
        accepted: true,
        reservationId: null,
        usedTokens: 0,
        reservedTokens: 0,
        requestedTokens: 10,
        limitTokens: null,
        remainingTokens: null,
        resetAt: expect.any(String),
      });
    }
    expect(rawDb.get("SELECT COUNT(*) AS count FROM apiKeyUsageReservations").count).toBe(0);
  });

  it("treats whitespace-only repository limits as unlimited", async () => {
    const created = await db.createApiKey("blank-create", "machine-test", "   \t");
    expect(created.dailyLimitTokens).toBeNull();
    expect(await db.reserveApiKeyUsage(created.key, 10)).toMatchObject({
      enforced: false,
      accepted: true,
      limitTokens: null,
    });

    const limited = await db.createApiKey("blank-update", "machine-test", 100);
    const updated = await db.updateApiKey(limited.id, { dailyLimitTokens: "\n  " });
    expect(updated.dailyLimitTokens).toBeNull();
    expect((await db.getApiKeyById(limited.id)).dailyLimitTokens).toBeNull();
  });

  it("treats a whitespace-only API limit as unlimited", async () => {
    const { POST } = await import("@/app/api/keys/route.js");
    const response = await POST(new Request("http://localhost/api/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "blank-api", dailyLimitTokens: "   " }),
    }));

    expect(response.status).toBe(201);
    const payload = await response.json();
    expect(payload.dailyLimitTokens).toBeNull();
    expect((await db.getApiKeyById(payload.id)).dailyLimitTokens).toBeNull();
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1, "1", null])(
    "rejects invalid requested token amount %s",
    async (amount) => {
      const key = await db.createApiKey("limited", "machine-test", 100);
      await expect(db.reserveApiKeyUsage(key.key, amount)).rejects.toThrow(
        "requestedTokens must be a positive safe integer",
      );
    },
  );

  it("prunes reservations at the exact six-hour expiry boundary", async () => {
    const key = await db.createApiKey("limited", "machine-test", 100);
    const createdAt = new Date("2026-07-19T12:00:00.000Z");
    const expiresAt = new Date("2026-07-19T18:00:00.000Z");

    expect((await db.reserveApiKeyUsage(key.key, 100, createdAt)).accepted).toBe(true);
    expect((await db.reserveApiKeyUsage(key.key, 100, new Date(expiresAt.getTime() - 1))).accepted).toBe(false);
    expect((await db.reserveApiKeyUsage(key.key, 100, expiresAt)).accepted).toBe(true);
    expect(rawDb.all("SELECT * FROM apiKeyUsageReservations")).toHaveLength(1);
  });

  it("releases a reservation idempotently", async () => {
    const key = await db.createApiKey("limited", "machine-test", 100);
    const reservation = await db.reserveApiKeyUsage(key.key, 100);

    expect(await db.releaseApiKeyUsageReservation(reservation.reservationId)).toBe(true);
    expect(await db.releaseApiKeyUsageReservation(reservation.reservationId)).toBe(false);
    expect(await db.getApiKeyUsageLimitStatus(key.key)).toMatchObject({
      reservedTokens: 0,
      remainingTokens: 100,
    });
  });

  it("keeps same-prefix API keys isolated", async () => {
    const first = await db.createApiKey("first", "machine-test", 100);
    const second = await db.createApiKey("second", "machine-test", 100);
    await db.updateApiKey(first.id, { key: "sk-sameprefix-111" });
    await db.updateApiKey(second.id, { key: "sk-sameprefix-222" });

    expect((await db.reserveApiKeyUsage("sk-sameprefix-111", 100)).accepted).toBe(true);
    expect((await db.reserveApiKeyUsage("sk-sameprefix-222", 100)).accepted).toBe(true);
    expect((await db.reserveApiKeyUsage("sk-sameprefix-111", 1)).accepted).toBe(false);
    expect((await db.getApiKeyUsageLimitStatus("sk-sameprefix-222")).reservedTokens).toBe(100);
  });

  it("bounds status numbers when committed usage exceeds safe integer range", async () => {
    const key = await db.createApiKey("limited", "machine-test", Number.MAX_SAFE_INTEGER);
    rawDb.run(
      `INSERT INTO usageHistory(timestamp, apiKey, promptTokens, completionTokens, tokens)
       VALUES(?, ?, ?, ?, ?)`,
      [new Date().toISOString(), key.key, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, "{}"],
    );

    const status = await db.reserveApiKeyUsage(key.key, 1);
    expect(status.accepted).toBe(false);
    for (const field of ["usedTokens", "reservedTokens", "requestedTokens", "limitTokens", "remainingTokens"]) {
      expect(Number.isSafeInteger(status[field])).toBe(true);
      expect(status[field]).toBeGreaterThanOrEqual(0);
    }
  });

  it("bounds committed usage after aggregate exceeds SQLite integer range", async () => {
    const key = await db.createApiKey("limited", "machine-test", Number.MAX_SAFE_INTEGER);
    const timestamp = new Date().toISOString();
    rawDb.transaction(() => {
      for (let index = 0; index < 1_025; index += 1) {
        rawDb.run(
          `INSERT INTO usageHistory(timestamp, apiKey, promptTokens, completionTokens, tokens)
           VALUES(?, ?, ?, ?, ?)`,
          [timestamp, key.key, Number.MAX_SAFE_INTEGER, 0, "{}"],
        );
      }
    });

    expect(await db.getApiKeyUsageLimitStatus(key.key)).toMatchObject({
      usedTokens: Number.MAX_SAFE_INTEGER,
      reservedTokens: 0,
      remainingTokens: 0,
      exceeded: true,
    });
    expect(await db.reserveApiKeyUsage(key.key, 1)).toMatchObject({
      accepted: false,
      usedTokens: Number.MAX_SAFE_INTEGER,
      remainingTokens: 0,
    });
  });

  it("atomically records actual usage and deletes its reservation", async () => {
    const key = await db.createApiKey("limited", "machine-test", 1_000);
    const now = new Date("2026-07-19T12:00:00.000Z");
    const reservation = await db.reserveApiKeyUsage(key.key, 500, now);

    await db.saveRequestUsage({
      provider: "openai",
      model: "gpt-4o",
      apiKey: key.key,
      usageReservationId: reservation.reservationId,
      timestamp: now.toISOString(),
      tokens: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150, reasoning_tokens: 25 },
    });

    expect(rawDb.get(
      "SELECT id FROM apiKeyUsageReservations WHERE id = ?",
      [reservation.reservationId],
    )).toBeUndefined();
    const usage = rawDb.get("SELECT * FROM usageHistory WHERE apiKey = ?", [key.key]);
    expect(usage).toMatchObject({ promptTokens: 100, completionTokens: 50 });
    expect(JSON.parse(usage.tokens)).toMatchObject({ reasoning_tokens: 25 });
    expect(usage.tokens).not.toContain(reservation.reservationId);
    expect(usage.meta).not.toContain(reservation.reservationId);
    expect(await db.getApiKeyUsageLimitStatus(key.key, now)).toMatchObject({
      usedTokens: 150,
      reservedTokens: 0,
      remainingTokens: 850,
    });
  });

  it("keeps a replay of one reservation idempotent", async () => {
    const key = await db.createApiKey("limited", "machine-test", 1_000);
    const reservation = await db.reserveApiKeyUsage(key.key, 100);
    const entry = {
      provider: "openai",
      model: "gpt-4o",
      connectionId: "connection-test",
      apiKey: key.key,
      tokens: { prompt_tokens: 10, completion_tokens: 5 },
    };
    await db.saveRequestUsage({ ...entry, usageReservationId: reservation.reservationId });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await db.saveRequestUsage({ ...entry, usageReservationId: reservation.reservationId });

    expect(rawDb.get("SELECT COUNT(*) AS count FROM usageHistory").count).toBe(1);
    expect(rawDb.get("SELECT COUNT(*) AS count FROM apiKeyUsageReservations").count).toBe(0);
    const stored = rawDb.get("SELECT tokens, meta FROM usageHistory");
    const requestIdentity = JSON.parse(stored.meta).requestIdentity;
    expect(requestIdentity).toEqual(expect.any(String));
    expect(requestIdentity).not.toContain(reservation.reservationId);
    expect(stored.tokens).not.toContain(reservation.reservationId);
    expect(await db.getUsageHistory()).toEqual([
      expect.not.objectContaining({ requestIdentity: expect.anything(), usageReservationId: expect.anything() }),
    ]);
  });

  it("charges distinct reservations with identical same-millisecond usage", async () => {
    const key = await db.createApiKey("limited", "machine-test", 1_000);
    const now = new Date("2026-07-19T12:00:00.000Z");
    const first = await db.reserveApiKeyUsage(key.key, 100, now);
    const second = await db.reserveApiKeyUsage(key.key, 100, now);
    const entry = {
      provider: "openai",
      model: "gpt-4o",
      connectionId: "connection-test",
      apiKey: key.key,
      timestamp: now.toISOString(),
      tokens: { prompt_tokens: 10, completion_tokens: 5 },
    };

    await db.saveRequestUsage({ ...entry, usageReservationId: first.reservationId });
    await db.saveRequestUsage({ ...entry, usageReservationId: second.reservationId });

    expect(rawDb.get("SELECT COUNT(*) AS count FROM usageHistory").count).toBe(2);
    expect(rawDb.get("SELECT COUNT(*) AS count FROM apiKeyUsageReservations").count).toBe(0);
    expect(await db.getApiKeyUsageLimitStatus(key.key, now)).toMatchObject({
      usedTokens: 30,
      reservedTokens: 0,
      remainingTokens: 970,
    });
  });

  it.each([
    ["cross-key", "sk-owner-a", "sk-other-b"],
    ["same-prefix", "sk-sameprefix-111", "sk-sameprefix-222"],
  ])("does not reconcile a %s reservation/key mismatch", async (_name, firstKey, secondKey) => {
    const first = await db.createApiKey("first", "machine-test", 1_000);
    const second = await db.createApiKey("second", "machine-test", 1_000);
    await db.updateApiKey(first.id, { key: firstKey });
    await db.updateApiKey(second.id, { key: secondKey });
    const firstReservation = await db.reserveApiKeyUsage(firstKey, 100);
    const secondReservation = await db.reserveApiKeyUsage(secondKey, 100);

    await db.saveRequestUsage({
      provider: "openai",
      model: "gpt-4o",
      apiKey: firstKey,
      usageReservationId: secondReservation.reservationId,
      tokens: { prompt_tokens: 10, completion_tokens: 5 },
    });

    expect(rawDb.all("SELECT id FROM apiKeyUsageReservations ORDER BY id").map(({ id }) => id).sort()).toEqual(
      [firstReservation.reservationId, secondReservation.reservationId].sort(),
    );
    expect(rawDb.get("SELECT COUNT(*) AS count FROM usageHistory WHERE apiKey = ?", [firstKey]).count).toBe(1);
    expect(await db.getApiKeyUsageLimitStatus(firstKey)).toMatchObject({ usedTokens: 15, reservedTokens: 100 });
    expect(await db.getApiKeyUsageLimitStatus(secondKey)).toMatchObject({ usedTokens: 0, reservedTokens: 100 });
  });

  it("rolls back reservation deletion when usage insertion fails", async () => {
    const key = await db.createApiKey("limited", "machine-test", 1_000);
    const reservation = await db.reserveApiKeyUsage(key.key, 100);
    rawDb.exec(`CREATE TRIGGER fail_usage_insert BEFORE INSERT ON usageHistory
      BEGIN SELECT RAISE(ABORT, 'forced usage failure'); END`);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await db.saveRequestUsage({
      provider: "openai",
      model: "gpt-4o",
      apiKey: key.key,
      usageReservationId: reservation.reservationId,
      tokens: { prompt_tokens: 10, completion_tokens: 5 },
    });

    expect(rawDb.get(
      "SELECT id FROM apiKeyUsageReservations WHERE id = ?",
      [reservation.reservationId],
    )).toBeDefined();
    expect(rawDb.get("SELECT COUNT(*) AS count FROM usageHistory").count).toBe(0);
    expect(errorSpy).toHaveBeenCalledWith("Failed to save usage stats:", expect.any(Error));
    errorSpy.mockRestore();
    rawDb.exec("DROP TRIGGER fail_usage_insert");
  });

  it.each([
    ["negative prompt", { prompt_tokens: -1, completion_tokens: 5 }],
    ["fractional completion", { prompt_tokens: 5, completion_tokens: 1.5 }],
    ["unsafe reasoning", { prompt_tokens: 5, completion_tokens: 5, reasoning_tokens: Number.MAX_SAFE_INTEGER + 1 }],
    ["negative nested reasoning", { prompt_tokens: 5, completion_tokens: 5, completion_tokens_details: { reasoning_tokens: -1 } }],
  ])("keeps reservations for invalid authoritative %s usage", async (_name, tokens) => {
    const key = await db.createApiKey("limited", "machine-test", 1_000);
    const reservation = await db.reserveApiKeyUsage(key.key, 100);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      await db.saveRequestUsage({
        provider: "openai",
        model: "gpt-4o",
        apiKey: key.key,
        usageReservationId: reservation.reservationId,
        tokens,
      });

      expect(rawDb.get("SELECT id FROM apiKeyUsageReservations WHERE id = ?", [reservation.reservationId])).toBeDefined();
      expect(rawDb.get("SELECT COUNT(*) AS count FROM usageHistory").count).toBe(0);
      expect(errorSpy).toHaveBeenCalledWith("Failed to save usage stats:", expect.any(Error));
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("deletes API-key reservations with the key", async () => {
    const key = await db.createApiKey("limited", "machine-test", 100);
    await db.reserveApiKeyUsage(key.key, 100);

    expect(await db.deleteApiKey(key.id)).toBe(true);
    expect(rawDb.get("SELECT COUNT(*) AS count FROM apiKeys").count).toBe(0);
    expect(rawDb.get("SELECT COUNT(*) AS count FROM apiKeyUsageReservations").count).toBe(0);
  });

  it("clears reservations during full import before reusing API-key IDs", async () => {
    const key = await db.createApiKey("limited", "machine-test", 100);
    await db.reserveApiKeyUsage(key.key, 100);
    const payload = await db.exportDb();

    expect(payload).not.toHaveProperty("apiKeyUsageReservations");
    await db.importDb(payload);

    expect((await db.getApiKeyById(key.id))?.key).toBe(key.key);
    expect(rawDb.get("SELECT COUNT(*) AS count FROM apiKeyUsageReservations").count).toBe(0);
    expect(await db.getApiKeyUsageLimitStatus(key.key)).toMatchObject({ reservedTokens: 0, remainingTokens: 100 });
  });

  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects imported daily limit %s before changing database state",
    async (dailyLimitTokens) => {
      const key = await db.createApiKey("keep-key", "machine-test", 100);
      const reservation = await db.reserveApiKeyUsage(key.key, 50);
      await db.updateSettings({ cavemanEnabled: true });
      await db.setModelAlias("keep-alias", "openai/gpt-4o");
      const snapshot = () => ({
        settings: rawDb.all("SELECT * FROM settings ORDER BY id"),
        apiKeys: rawDb.all("SELECT * FROM apiKeys ORDER BY id"),
        reservations: rawDb.all("SELECT * FROM apiKeyUsageReservations ORDER BY id"),
        aliases: rawDb.all("SELECT * FROM kv WHERE scope = 'modelAliases' ORDER BY key"),
      });
      const before = snapshot();
      const payload = await db.exportDb();
      payload.apiKeys[0].dailyLimitTokens = dailyLimitTokens;
      const transactionSpy = vi.spyOn(rawDb, "transaction");

      try {
        await expect(db.importDb(payload)).rejects.toThrow("dailyLimitTokens must be a non-negative integer");
        expect(transactionSpy).not.toHaveBeenCalled();
      } finally {
        transactionSpy.mockRestore();
      }

      expect(snapshot()).toEqual(before);
      expect(rawDb.get("SELECT id FROM apiKeyUsageReservations WHERE id = ?", [reservation.reservationId])).toBeDefined();
    },
  );

  it("normalizes a blank imported daily limit to unlimited", async () => {
    const key = await db.createApiKey("blank-import", "machine-test", 100);
    const payload = await db.exportDb();
    payload.apiKeys[0].dailyLimitTokens = " \n\t ";

    await db.importDb(payload);

    expect((await db.getApiKeyById(key.id)).dailyLimitTokens).toBeNull();
  });

  it("rolls back reservation deletion when API-key deletion fails", async () => {
    const key = await db.createApiKey("limited", "machine-test", 100);
    await db.reserveApiKeyUsage(key.key, 100);
    rawDb.exec(`CREATE TRIGGER fail_api_key_delete BEFORE DELETE ON apiKeys
      BEGIN SELECT RAISE(ABORT, 'forced API-key failure'); END`);

    await expect(db.deleteApiKey(key.id)).rejects.toThrow("forced API-key failure");
    expect(rawDb.get("SELECT COUNT(*) AS count FROM apiKeys").count).toBe(1);
    expect(rawDb.get("SELECT COUNT(*) AS count FROM apiKeyUsageReservations").count).toBe(1);
  });
});
