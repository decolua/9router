import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { SCHEMA_VERSION, TABLES } from "@/lib/db/schema.js";

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
      tokens: { prompt_tokens: 100, completion_tokens: 50, reasoning_tokens: 50 },
    });

    expect((await db.reserveApiKeyUsage(key.key, 500, now)).accepted).toBe(true);
    expect(await db.reserveApiKeyUsage(key.key, 301, now)).toMatchObject({
      accepted: false,
      usedTokens: 200,
      reservedTokens: 500,
      remainingTokens: 300,
    });
    expect(await db.getApiKeyUsageLimitStatus(key.key, now)).toEqual({
      enforced: true,
      exceeded: false,
      usedTokens: 200,
      reservedTokens: 500,
      limitTokens: 1_000,
      remainingTokens: 300,
      resetAt: getExpectedResetAt(now),
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
      tokens: { prompt_tokens: 100, completion_tokens: 50, reasoning_tokens: 25 },
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
      usedTokens: 175,
      reservedTokens: 0,
      remainingTokens: 825,
    });
  });

  it("deletes a matching reservation when usage is a duplicate", async () => {
    const key = await db.createApiKey("limited", "machine-test", 1_000);
    const timestamp = "2026-07-19T12:00:00.000Z";
    const entry = {
      provider: "openai",
      model: "gpt-4o",
      connectionId: "connection-test",
      apiKey: key.key,
      timestamp,
      tokens: { prompt_tokens: 10, completion_tokens: 5 },
    };
    await db.saveRequestUsage(entry);
    const reservation = await db.reserveApiKeyUsage(key.key, 100, new Date(timestamp));

    await db.saveRequestUsage({ ...entry, usageReservationId: reservation.reservationId });

    expect(rawDb.get("SELECT COUNT(*) AS count FROM usageHistory").count).toBe(1);
    expect(rawDb.get("SELECT COUNT(*) AS count FROM apiKeyUsageReservations").count).toBe(0);
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

  it("deletes API-key reservations with the key", async () => {
    const key = await db.createApiKey("limited", "machine-test", 100);
    await db.reserveApiKeyUsage(key.key, 100);

    expect(await db.deleteApiKey(key.id)).toBe(true);
    expect(rawDb.get("SELECT COUNT(*) AS count FROM apiKeys").count).toBe(0);
    expect(rawDb.get("SELECT COUNT(*) AS count FROM apiKeyUsageReservations").count).toBe(0);
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
