// Combo entries in /v1/models must merge capabilities (incl. context window)
// from the provider models they hold — flat and nested.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-combo-caps-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
  // Flat combo: gemini-3.8-flash (1,048,576 / vision) + gpt-4o (128,000 / vision)
  await db.createCombo({ name: "tier1", models: ["ag/gemini-3.8-flash", "gh/gpt-4o"] });
  // Small-window, no-vision leaf used for nesting
  await db.createCombo({ name: "tier2", models: ["gh/gpt-3.5-turbo"] });
  // Nested combo: holds another combo name + a concrete model
  await db.createCombo({ name: "plan", models: ["tier2", "ag/gemini-3.8-flash"] });
  // Web combo must stay bare (not an LLM model)
  await db.createCombo({ name: "web1", kind: "webSearch", models: ["ag/gemini-3.8-flash"] });
  // Two-layer nesting matching real usage:
  //   selection-provider1 -> [gemini-3.8-flash, gpt-4o]
  //   selection-provider2 -> [gpt-3.5-turbo]
  //   tier1               -> [selection-provider1, selection-provider2]
  //   deepplan            -> [tier1]
  await db.createCombo({ name: "selection-provider1", models: ["ag/gemini-3.8-flash", "gh/gpt-4o"] });
  await db.createCombo({ name: "selection-provider2", models: ["gh/gpt-3.5-turbo"] });
  await db.createCombo({ name: "tierA", models: ["selection-provider1", "selection-provider2"] });
  await db.createCombo({ name: "deepplan", models: ["tierA"] });
});

afterAll(() => {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

async function getComboModels() {
  const { buildModelsList } = await import("../../src/app/api/v1/models/route.js");
  const list = await buildModelsList(["llm"]);
  return list.filter((m) => m.owned_by === "combo");
}

describe("combo capabilities in /v1/models", () => {
  it("merges min context window and OR'd features for a flat LLM combo", async () => {
    const combos = await getComboModels();
    const tier1 = combos.find((m) => m.id === "tier1");
    expect(tier1).toBeDefined();
    // min(1,048,576, 128,000) across members
    expect(tier1.context_length).toBe(128000);
    // min(65,536, 16,384) across members
    expect(tier1.max_completion_tokens).toBe(16384);
    expect(tier1.capabilities.vision).toBe(true);
    expect(tier1.capabilities.tools).toBe(true);
  });

  it("flattens nested combos when merging", async () => {
    const combos = await getComboModels();
    const plan = combos.find((m) => m.id === "plan");
    // tier2 -> gpt-3.5-turbo (16,385, no vision) + gemini-3.8-flash (1,048,576, vision)
    expect(plan.context_length).toBe(16385);
    expect(plan.capabilities.vision).toBe(true); // OR across flattened members
  });

  it("flattens two layers of nested combos when merging", async () => {
    const combos = await getComboModels();
    const deepplan = combos.find((m) => m.id === "deepplan");
    // deepplan -> tier1 -> { selection-provider1 [gemini-3.8-flash, gpt-4o],
    //                         selection-provider2 [gpt-3.5-turbo] }
    // min context window across all leaves = min(1,048,576, 128,000, 16,385) = 16,385
    expect(deepplan.context_length).toBe(16385);
    // min maxOutput = min(65,536, 16,384, 4,096) = 4,096
    expect(deepplan.max_completion_tokens).toBe(4096);
    // vision OR'd across leaves (gemini-3.8-flash + gpt-4o are vision)
    expect(deepplan.capabilities.vision).toBe(true);
  });

  it("keeps web combos bare (no capabilities/context window)", async () => {
    const { buildModelsList } = await import("../../src/app/api/v1/models/route.js");
    const list = await buildModelsList(["webSearch"]);
    const web1 = list.find((m) => m.id === "web1");
    expect(web1).toBeDefined();
    expect(web1.kind).toBe("webSearch");
    expect(web1.capabilities).toBeUndefined();
    expect(web1.context_length).toBeUndefined();
    expect(web1.max_completion_tokens).toBeUndefined();
  });
});
