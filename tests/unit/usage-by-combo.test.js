import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
let db;

beforeEach(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-usage-combo-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
});

afterEach(() => {
  delete process.env.DATA_DIR;
});

const base = { provider: "openai", connectionId: "c1", endpoint: "/v1/chat/completions", status: "ok" };

async function seed() {
  await db.saveRequestUsage({ ...base, model: "small", combo: "team-code", tokens: { prompt_tokens: 10, completion_tokens: 1 } });
  await db.saveRequestUsage({ ...base, model: "small", combo: "team-code", tokens: { prompt_tokens: 20, completion_tokens: 2 } });
  await db.saveRequestUsage({ ...base, model: "large", combo: "team-code", tokens: { prompt_tokens: 30, completion_tokens: 3 } });
  await db.saveRequestUsage({ ...base, model: "large", combo: "team-plan", comboVia: "team-pro", tokens: { prompt_tokens: 40, completion_tokens: 4 } });
  await db.saveRequestUsage({ ...base, model: "small", tokens: { prompt_tokens: 50, completion_tokens: 5 } });
}

function summarize(byCombo) {
  return Object.values(byCombo)
    .map((e) => `${e.combo}|${e.comboVia}|${e.rawModel}|${e.requests}|${e.promptTokens}|${e.completionTokens}`)
    .sort();
}

const expected = [
  "team-code||large|1|30|3",
  "team-code||small|2|30|3",
  "team-plan|team-pro|large|1|40|4",
  "||small|1|50|5",
].sort();

describe("Usage stats by combo", () => {
  // One seed for all assertions: the DB adapter is a process-wide singleton, so
  // separate tests would accumulate into the same store.
  it("attributes requests to the combo they came through, on both read paths", async () => {
    await seed();

    // Live history path (today / 24h)
    const live = await db.getUsageStats("24h");
    expect(summarize(live.byCombo)).toEqual(expected);

    // Daily rollup path (7d and longer)
    const daily = await db.getUsageStats("7d");
    expect(summarize(daily.byCombo)).toEqual(expected);

    // Per-model totals are unchanged and the combo view accounts for every request
    const total = Object.values(live.byModel).reduce((sum, m) => sum + m.requests, 0);
    const comboTotal = Object.values(live.byCombo).reduce((sum, c) => sum + c.requests, 0);
    expect(total).toBe(5);
    expect(comboTotal).toBe(5);
  });
});
