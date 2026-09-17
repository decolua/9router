// removeModelFromCombos against a real SQLite adapter, following the
// DATA_DIR + initDb() pattern used by the other db tests.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-combo-prune-"));
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

beforeEach(async () => {
  for (const combo of await db.getCombos()) await db.deleteCombo(combo.id);
  await db.updateSettings({ comboStrategies: {} });
});

describe("removeModelFromCombos", () => {
  it("removes the member from every combo that uses it", async () => {
    await db.createCombo({ name: "fast", models: ["or/gpt-5", "bai/m1"] });
    await db.createCombo({ name: "cheap", models: ["or/gpt-5"] });
    await db.createCombo({ name: "other", models: ["bai/m2"] });

    const summary = await db.removeModelFromCombos(["or/gpt-5"]);

    expect(summary.map((s) => s.name).sort()).toEqual(["cheap", "fast"]);
    expect((await db.getComboByName("fast")).models).toEqual(["bai/m1"]);
    expect((await db.getComboByName("cheap")).models).toEqual([]);
    expect((await db.getComboByName("other")).models).toEqual(["bai/m2"]);
  });

  it("reports what it removed and what is left", async () => {
    await db.createCombo({ name: "fast", models: ["or/gpt-5", "bai/m1"] });
    const [entry] = await db.removeModelFromCombos(["or/gpt-5"]);
    expect(entry).toMatchObject({
      name: "fast",
      removed: ["or/gpt-5"],
      remainingCount: 1,
      judgeCleared: false,
    });
  });

  it("matches any of the candidate name forms", async () => {
    await db.createCombo({ name: "mixed", models: ["or/gpt-5", "openrouter/gpt-5", "bai/m1"] });
    await db.removeModelFromCombos(["or/gpt-5", "openrouter/gpt-5"]);
    expect((await db.getComboByName("mixed")).models).toEqual(["bai/m1"]);
  });

  it("leaves a combo empty rather than refusing", async () => {
    await db.createCombo({ name: "solo", models: ["or/gpt-5"] });
    const [entry] = await db.removeModelFromCombos(["or/gpt-5"]);
    expect(entry.remainingCount).toBe(0);
    expect((await db.getComboByName("solo")).models).toEqual([]);
  });

  it("clears a fusion judge naming the removed model", async () => {
    await db.createCombo({ name: "fusion", models: ["or/gpt-5", "bai/m1"] });
    await db.updateSettings({
      comboStrategies: { fusion: { fallbackStrategy: "fusion", judgeModel: "or/gpt-5" } },
    });

    const [entry] = await db.removeModelFromCombos(["or/gpt-5"]);

    expect(entry.judgeCleared).toBe(true);
    const settings = await db.getSettings();
    expect(settings.comboStrategies.fusion.judgeModel).toBeNull();
    expect(settings.comboStrategies.fusion.fallbackStrategy).toBe("fusion");
  });

  it("clears a judge even when that combo has no matching member", async () => {
    await db.createCombo({ name: "judged", models: ["bai/m1"] });
    await db.updateSettings({ comboStrategies: { judged: { judgeModel: "or/gpt-5" } } });

    const summary = await db.removeModelFromCombos(["or/gpt-5"]);

    expect(summary).toHaveLength(1);
    expect(summary[0]).toMatchObject({ name: "judged", removed: [], judgeCleared: true });
    expect((await db.getSettings()).comboStrategies.judged.judgeModel).toBeNull();
  });

  it("touches nothing when no combo uses the model", async () => {
    await db.createCombo({ name: "fast", models: ["bai/m1"] });
    const before = await db.getComboByName("fast");
    expect(await db.removeModelFromCombos(["or/unused"])).toEqual([]);
    expect((await db.getComboByName("fast")).updatedAt).toBe(before.updatedAt);
  });

  it("returns an empty summary for an empty candidate list", async () => {
    await db.createCombo({ name: "fast", models: ["or/gpt-5"] });
    expect(await db.removeModelFromCombos([])).toEqual([]);
    expect((await db.getComboByName("fast")).models).toEqual(["or/gpt-5"]);
  });
});

describe("POST /api/combos/remove-model", () => {
  let POST;

  beforeAll(async () => {
    ({ POST } = await import("@/app/api/combos/remove-model/route.js"));
  });

  const call = (body) => POST({ json: async () => body });

  it("prunes and returns the summary", async () => {
    await db.createCombo({ name: "fast", models: ["or/gpt-5", "bai/m1"] });
    const res = await call({ candidates: ["or/gpt-5"] });
    expect(res.status).toBe(200);
    const payload = await res.json();
    expect(payload.combos).toHaveLength(1);
    expect(payload.combos[0]).toMatchObject({ name: "fast", remainingCount: 1 });
    expect((await db.getComboByName("fast")).models).toEqual(["bai/m1"]);
  });

  it("rejects a body with no usable candidate", async () => {
    for (const body of [{}, { candidates: [] }, { candidates: "or/gpt-5" }, { candidates: [null, ""] }]) {
      const res = await call(body);
      expect(res.status).toBe(400);
    }
  });

  it("answers 500 on a malformed body instead of throwing", async () => {
    const res = await POST({ json: async () => { throw new Error("bad json"); } });
    expect(res.status).toBe(500);
  });
});
