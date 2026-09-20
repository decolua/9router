import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { AUTO_ROUTING_TIERS } from "../../open-sse/config/autoRouting.js";

const previousDataDir = process.env.DATA_DIR;
let tempDir, db, validate, patch;
const routing = () => ({ fallbackStrategy: "auto-routing", autoRouting: { classifierModel: "openai/gpt-4o-mini", timeoutMs: 2000, tiers: Object.fromEntries(AUTO_ROUTING_TIERS.map(({ id }) => [id, ["openai/gpt-4o"]])) } });
beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-auto-routing-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
  validate = (await import("@/lib/autoRoutingValidation.js")).validateAutoRoutingStrategies;
  patch = (await import("@/app/api/settings/route.js")).PATCH;
});
afterAll(() => {
  if (previousDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = previousDataDir;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("auto-routing settings and lifecycle", () => {
  it("validates concrete configured LLM providers, including custom nodes", async () => {
    expect(await validate({ smart: routing(), legacy: { fallbackStrategy: "fusion" } })).toBeNull();
    expect(await validate({ smart: { ...routing(), autoRouting: { ...routing().autoRouting, classifierModel: "smart" } } })).toMatch(/concrete/);
    expect(await validate({ smart: { ...routing(), autoRouting: { ...routing().autoRouting, classifierModel: "unknown/no-model" } } })).toMatch(/Unknown provider/);
    expect(await validate({ smart: { ...routing(), autoRouting: { ...routing().autoRouting, classifierModel: "openai/tts-1" } } })).toMatch(/not an LLM/);
    await db.createProviderNode({ id: "openai-compatible-auto-test", type: "openai-compatible", name: "Test", prefix: "testllm", baseUrl: "https://test.invalid/v1" });
    expect(await validate({ smart: { ...routing(), autoRouting: { ...routing().autoRouting, classifierModel: "testllm/custom-model" } } })).toBeNull();
  });
  it("rejects invalid settings writes and preserves saved settings", async () => {
    await db.updateSettings({ comboStrategies: { smart: routing() } });
    const bad = routing();
    bad.autoRouting.tiers.SIMPLE = [];
    const response = await patch(new Request("http://localhost/api/settings", { method: "PATCH", body: JSON.stringify({ comboStrategies: { smart: bad } }) }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("Simple");
    expect((await db.getSettings()).comboStrategies.smart).toEqual(routing());
  });
  it("persists configuration and moves/removes settings atomically with combo lifecycle", async () => {
    const combo = await db.createCombo({ name: "smart", models: ["openai/gpt-4o"], kind: "llm" });
    const response = await patch(new Request("http://localhost/api/settings", { method: "PATCH", body: JSON.stringify({ comboStrategies: { smart: routing(), other: { fallbackStrategy: "round-robin" } } }) }));
    expect(response.ok).toBe(true);
    expect((await db.getSettings()).comboStrategies.smart).toEqual(routing());
    await db.updateCombo(combo.id, { name: "renamed" });
    let settings = await db.getSettings();
    expect(settings.comboStrategies.smart).toBeUndefined();
    expect(settings.comboStrategies.renamed).toEqual(routing());
    expect(settings.comboStrategies.other.fallbackStrategy).toBe("round-robin");
    expect(await db.deleteCombo(combo.id)).toBe(true);
    settings = await db.getSettings();
    expect(settings.comboStrategies.renamed).toBeUndefined();
    expect(settings.comboStrategies.other.fallbackStrategy).toBe("round-robin");
  });
});
