// /api/usage/stats serializes stats.byApiKey. Its property names used to embed the raw
// 9router API key on the daily-aggregate periods (GHSA-vjc7, #2918), and the live
// today/24h branch merged every key sharing the install-wide sk-{machineId} prefix.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
const KEY_A = "sk-abcde12345-keyA-00000000000000000001";
const KEY_B = "sk-abcde12345-keyB-00000000000000000002";
let tempDir;
let db;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-usage-redact-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();

  // Distinct timestamps: saveRequestUsage drops an identical entry saved in the same
  // millisecond as a duplicate write, and these are three separate requests.
  const now = Date.now();
  for (const [i, apiKey] of [KEY_A, KEY_B, KEY_B].entries()) {
    await db.saveRequestUsage({
      timestamp: new Date(now - i * 1000).toISOString(),
      provider: "openai",
      model: "gpt-4o",
      connectionId: "c-1",
      apiKey,
      tokens: { prompt_tokens: 10, completion_tokens: 5 },
      endpoint: "/v1/chat/completions",
      status: "ok",
    });
  }
});

afterAll(() => {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("usage stats API-key redaction", () => {
  it.each(["today", "24h", "7d", "30d", "all"])("never serializes a raw API key (%s)", async (period) => {
    const stats = await db.getUsageStats(period);
    const body = JSON.stringify(stats);

    expect(body).not.toContain(KEY_A);
    expect(body).not.toContain(KEY_B);
  });

  it.each(["today", "24h", "7d", "all"])("keeps distinct keys in distinct rows (%s)", async (period) => {
    const stats = await db.getUsageStats(period);
    const rows = Object.values(stats.byApiKey).filter((r) => r.apiKeyMasked);

    expect(rows.map((r) => r.requests).sort()).toEqual([1, 2]);
  });
});
