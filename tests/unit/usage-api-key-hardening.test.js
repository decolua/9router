import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
let dbApi;
let driver;

function usageId(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex").slice(0, 16)}`;
}

async function loadFreshDb() {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-usage-key-hardening-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  delete global._recentRing;
  vi.resetModules();
  dbApi = await import("@/lib/db/index.js");
  driver = await import("@/lib/db/driver.js");
  await dbApi.initDb();
}

async function rawDb() {
  return await driver.getAdapter();
}

beforeEach(async () => {
  await loadFreshDb();
});

afterEach(() => {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  delete process.env.DATA_DIR;
  delete global._dbAdapter;
  delete global._recentRing;
});

describe("usage API key hardening", () => {
  it("stores only derived usage ids for new request usage", async () => {
    const rawKey = "fixture-router-key-alpha";

    await dbApi.saveRequestUsage({
      provider: "openai",
      model: "gpt-4o-mini",
      apiKey: rawKey,
      tokens: { prompt_tokens: 12, completion_tokens: 4 },
      endpoint: "/v1/chat/completions",
      status: "ok",
    });

    const db = await rawDb();
    const history = db.get(`SELECT apiKey FROM usageHistory ORDER BY id DESC LIMIT 1`);
    expect(history.apiKey).toBe(usageId(rawKey));
    expect(history.apiKey).not.toContain(rawKey);

    const daily = db.get(`SELECT data FROM usageDaily ORDER BY dateKey DESC LIMIT 1`);
    const serialized = daily.data;
    expect(serialized).toContain(usageId(rawKey));
    expect(serialized).not.toContain(rawKey);

    const publicHistory = await dbApi.getUsageHistory({ provider: "openai" });
    expect(publicHistory.at(-1).apiKey).toBe(usageId(rawKey));
  });

  it("hashes request-derived literal sha256-looking keys instead of trusting them", async () => {
    const literalKey = "sha256:0123456789abcdef";

    await dbApi.saveRequestUsage({
      provider: "openai",
      model: "gpt-4o-mini",
      apiKey: literalKey,
      tokens: { prompt_tokens: 1, completion_tokens: 1 },
      endpoint: "/v1/chat/completions",
      status: "ok",
    });

    const db = await rawDb();
    const history = db.get(`SELECT apiKey FROM usageHistory ORDER BY id DESC LIMIT 1`);
    expect(history.apiKey).toBe(usageId(literalKey));
    expect(history.apiKey).not.toBe(literalKey);
  });

  it("normalizes legacy raw history and daily summary values without public re-exposure", async () => {
    const rawKey = "fixture-router-key-legacy";
    const expected = usageId(rawKey);
    const dateKey = "2026-06-12";
    const db = await rawDb();

    db.run(
      `INSERT INTO usageHistory(timestamp, provider, model, connectionId, apiKey, endpoint, promptTokens, completionTokens, cost, status, tokens, meta) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        `${dateKey}T00:00:00.000Z`,
        "openai",
        "gpt-4o-mini",
        null,
        rawKey,
        "/v1/chat/completions",
        5,
        6,
        0,
        "ok",
        JSON.stringify({ prompt_tokens: 5, completion_tokens: 6 }),
        JSON.stringify({}),
      ]
    );
    db.run(
      `INSERT OR REPLACE INTO usageDaily(dateKey, data) VALUES(?, ?)`,
      [dateKey, JSON.stringify({
        requests: 1,
        promptTokens: 5,
        completionTokens: 6,
        cost: 0,
        byApiKey: {
          [`${rawKey}|gpt-4o-mini|openai`]: {
            requests: 1,
            promptTokens: 5,
            completionTokens: 6,
            cost: 0,
            rawModel: "gpt-4o-mini",
            provider: "openai",
            apiKey: rawKey,
          },
        },
      })]
    );

    const migration = await import("@/lib/db/migrations/002-normalize-usage-api-keys.js");
    migration.default.up(db);

    const storedHistory = db.get(`SELECT apiKey FROM usageHistory WHERE apiKey = ?`, [expected]);
    expect(storedHistory.apiKey).toBe(expected);
    expect(db.get(`SELECT apiKey FROM usageHistory WHERE apiKey = ?`, [rawKey])).toBeUndefined();

    const storedDaily = db.get(`SELECT data FROM usageDaily WHERE dateKey = ?`, [dateKey]).data;
    expect(storedDaily).toContain(expected);
    expect(storedDaily).not.toContain(rawKey);

    const stats = await dbApi.getUsageStats("all");
    const serializedStats = JSON.stringify(stats.byApiKey);
    expect(serializedStats).toContain(expected);
    expect(serializedStats).not.toContain(rawKey);
  });
});
