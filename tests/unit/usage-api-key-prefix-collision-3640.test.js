// #3640 — "Usage by API Key" collapsed distinct keys that share an 8-char prefix.
//
// Keys are minted as sk-{machineId}-{keyId}-{crc}, so every key issued by one
// install shares its first 8 characters. The 24h/today branch of getUsageStats
// grouped on maskApiKey(key), which is exactly those 8 characters, so all keys
// landed in one bucket: the first one seen kept its name and absorbed the rest
// of the install's requests, tokens and cost.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { generateApiKeyWithMachine } from "../../src/shared/utils/apiKey.js";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-apikey-3640-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
});

afterAll(() => {
  // Best-effort: the adapter has no close(), so on Windows the open SQLite
  // handle makes rmSync raise EPERM. The OS reclaims the temp dir either way,
  // and failing teardown must not mask the assertions above.
  try {
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {}
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("usage by API key (#3640)", () => {
  it("two keys from one install really do share their first 8 characters", () => {
    const machineId = "00275ae3";
    const first = generateApiKeyWithMachine(machineId).key;
    const second = generateApiKeyWithMachine(machineId).key;

    expect(first).not.toBe(second);
    expect(first.slice(0, 8)).toBe(second.slice(0, 8));
  });

  it("keeps a separate bucket, name and totals for each key", async () => {
    const machineId = "00275ae3";
    const clientA = await db.createApiKey("Client-A", machineId);
    const clientB = await db.createApiKey("Client-B", machineId);
    expect(clientA.key.slice(0, 8)).toBe(clientB.key.slice(0, 8));

    const record = (apiKey, promptTokens) =>
      db.saveRequestUsage({
        provider: "google",
        model: "gemini-3.7-flash-high",
        connectionId: "c-3640",
        apiKey,
        tokens: { prompt_tokens: promptTokens, completion_tokens: 1 },
        endpoint: "/v1/chat/completions",
        status: "ok",
      });

    await record(clientA.key, 10);
    await record(clientB.key, 20);
    await record(clientB.key, 30);

    const stats = await db.getUsageStats("24h");
    const buckets = Object.values(stats.byApiKey);
    expect(buckets).toHaveLength(2);

    const byName = Object.fromEntries(buckets.map((b) => [b.keyName, b]));
    expect(Object.keys(byName).sort()).toEqual(["Client-A", "Client-B"]);
    expect(byName["Client-A"].requests).toBe(1);
    expect(byName["Client-A"].promptTokens).toBe(10);
    expect(byName["Client-B"].requests).toBe(2);
    expect(byName["Client-B"].promptTokens).toBe(50);
  });

  it("still reports the key masked, never in full", async () => {
    const stats = await db.getUsageStats("24h");
    for (const bucket of Object.values(stats.byApiKey)) {
      expect(bucket.apiKeyMasked).toMatch(/\*\*\*$/);
      expect(bucket.apiKeyMasked.length).toBeLessThanOrEqual(11);
    }
  });
});

describe("AUDIT-002 at runtime: the raw key must not reach the response", () => {
  it("no period puts the raw key in a byApiKey bucket name or payload", async () => {
    const secret = (await db.createApiKey("Audit-Probe", "00275ae3")).key;
    await db.saveRequestUsage({
      provider: "google",
      model: "gemini-3.7-flash-high",
      connectionId: "c-audit",
      apiKey: secret,
      tokens: { prompt_tokens: 5, completion_tokens: 5 },
      endpoint: "/v1/chat/completions",
      status: "ok",
    });

    // The daily-summary periods read usageDaily, whose stored bucket names are
    // built from the raw key. Before this fix they were copied into the
    // response verbatim, which is exactly what the source-text check missed.
    for (const period of ["24h", "today", "7d", "30d", "all"]) {
      const stats = await db.getUsageStats(period);
      expect(JSON.stringify(stats.byApiKey), `period=${period}`).not.toContain(secret);
      for (const name of Object.keys(stats.byApiKey)) {
        expect(name, `period=${period}`).not.toContain(secret);
      }
    }
  });
});
