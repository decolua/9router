// Combo usage stats — usageHistory.meta.requestedModel must aggregate into
// stats.byCombo in both stats code paths (24h live history + daily summary).
// Entries accumulate across the file: 3 combo entries total (10/5 + 20/10 + 30/15).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-combo-stats-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
});

afterAll(() => {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

async function saveComboUsage(model, promptTokens, completionTokens) {
  await db.saveRequestUsage({
    provider: "openai",
    model,
    tokens: { prompt_tokens: promptTokens, completion_tokens: completionTokens },
    connectionId: "conn-1",
    meta: { requestedModel: "my-combo" },
  });
}

describe("usage stats by combo", () => {
  it("persists requestedModel in the usageHistory meta column", async () => {
    await saveComboUsage("gpt-4o", 10, 5);
    const { getAdapter } = await import("@/lib/db/driver.js");
    const adapter = await getAdapter();
    const rows = adapter.all(`SELECT model, meta FROM usageHistory WHERE model = ?`, ["gpt-4o"]);
    expect(rows.length).toBe(1);
    expect(JSON.parse(rows[0].meta)).toEqual({ requestedModel: "my-combo" });
  });

  it("aggregates combo usage in the 24h (live history) stats path", async () => {
    await saveComboUsage("gpt-4o", 20, 10);
    await saveComboUsage("claude-3-5-sonnet", 30, 15); // second combo member
    await db.saveRequestUsage({ // non-combo traffic must not leak into byCombo
      provider: "openai",
      model: "gpt-4o",
      tokens: { prompt_tokens: 100, completion_tokens: 50 },
    });

    const stats = await db.getUsageStats("24h");
    const combo = stats.byCombo?.["my-combo"];
    expect(combo).toBeDefined();
    expect(combo.requests).toBe(3);
    expect(combo.promptTokens).toBe(60);
    expect(combo.completionTokens).toBe(30);
    expect(combo.comboName).toBe("my-combo");
    expect(stats.byModel["gpt-4o (openai)"].requests).toBe(3); // byModel unchanged
  });

  it("aggregates combo usage in the daily-summary stats path (7d)", async () => {
    const stats = await db.getUsageStats("7d");
    const combo = stats.byCombo?.["my-combo"];
    expect(combo).toBeDefined();
    expect(combo.requests).toBe(3);
    expect(combo.promptTokens).toBe(60);
  });
});

describe("usage stats by provider", () => {
  it("exposes provider rows with display name and lastUsed in the 24h path", async () => {
    const stats = await db.getUsageStats("24h");
    const provider = stats.byProvider?.openai;
    expect(provider).toBeDefined();
    expect(provider.requests).toBe(4); // 3 combo members + 1 non-combo entry
    expect(provider.promptTokens).toBe(160); // 10 + 20 + 30 + 100
    expect(provider.provider).toBeTruthy();
    expect(provider.lastUsed).toBeTruthy();
  });

  it("exposes provider rows with display name and lastUsed in the daily-summary path (7d)", async () => {
    const stats = await db.getUsageStats("7d");
    const provider = stats.byProvider?.openai;
    expect(provider).toBeDefined();
    expect(provider.requests).toBe(4);
    expect(provider.provider).toBe("openai"); // falls back to the id without a matching node name
    expect(provider.lastUsed).toBeTruthy();
  });
});
