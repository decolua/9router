import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-global-pricing-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
});

afterAll(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  global._dbAdapter = { instance: null, initPromise: null, logged: false };
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("global pricing mappings", () => {
  it("uses one global price for explicitly mapped provider models", async () => {
    await db.upsertPricingModels({
      "glm-5.3": { input: 1.2, output: 4.8, cached: 0.2, source: "opencode" },
    });
    await db.setPricingMappings([
      { provider: "opencode-go", model: "glm-5.3", pricingModel: "glm-5.3" },
      { provider: "glm-cn", model: "glm-5.3", pricingModel: "glm-5.3" },
    ]);

    await expect(db.getPricingForModel("opencode-go", "glm-5.3")).resolves.toMatchObject({ input: 1.2, output: 4.8 });
    await expect(db.getPricingForModel("glm-cn", "glm-5.3")).resolves.toMatchObject({ input: 1.2, output: 4.8 });
  });

  it("falls back to the configured default pricing model when no explicit mapping exists", async () => {
    await db.upsertPricingModels({ fallback: { input: 0.5, output: 2, cached: 0.1 } });
    await db.updateSettings({ defaultPricingModel: "fallback" });

    await expect(db.getPricingForModel("unknown-provider", "new-model")).resolves.toMatchObject({ input: 0.5, output: 2 });
  });

  it("replaces a target model mapping set and allows reassignment", async () => {
    await db.upsertPricingModels({ premium: { input: 5, output: 25 } });
    await db.setPricingMappings([{ provider: "glm", model: "glm-5.3", pricingModel: "premium" }]);
    await db.replacePricingMappings("glm-5.3", [{ provider: "glm", model: "glm-5.3" }]);

    const mappings = await db.getPricingMappings();
    expect(mappings).toContainEqual({ provider: "glm", model: "glm-5.3", pricingModel: "glm-5.3" });
    expect(mappings).not.toContainEqual({ provider: "glm", model: "glm-5.3", pricingModel: "premium" });
  });
});
