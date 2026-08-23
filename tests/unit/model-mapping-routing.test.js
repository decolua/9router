import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;
let catalogService;
let modelService;
let resolver;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-model-mapping-routing-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  catalogService = await import("@/shared/services/modelMappingCatalog.js");
  modelService = await import("@/sse/services/model.js");
  resolver = await import("@/sse/services/modelMappingResolver.js");
  await db.createProviderConnection({
    provider: "openai",
    authType: "apikey",
    name: "mapping-test",
    apiKey: "sk-test",
  });
});

afterAll(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  global._dbAdapter = { instance: null, initPromise: null, logged: false };
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("model mapping routing", () => {
  it("lists configured provider models and routes a mapped name back upstream", async () => {
    const catalog = await catalogService.getModelMappingCatalog();
    const target = catalog.find((item) => item.provider === "openai");
    expect(target).toBeTruthy();

    await db.setModelMappings([{ provider: target.provider, upstreamModel: target.upstreamModel, mappedModel: "unified-routing-test" }]);
    resolver.clearModelMappingCatalogCache();

    await expect(modelService.getComboModels("unified-routing-test"))
      .resolves.toContain(target.routeModel);
  });
});
