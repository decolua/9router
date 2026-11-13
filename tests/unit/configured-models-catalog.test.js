import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getCombos: vi.fn(async () => []),
  getCustomModels: vi.fn(async () => []),
  getModelAliases: vi.fn(async () => ({}))
}));
const mocks = vi.hoisted(() => ({
  live: vi.fn(),
  disabled: vi.fn(async () => ({}))
}));
vi.mock("@/lib/localDb", () => db);
vi.mock("@/lib/disabledModelsDb", () => ({
  getDisabledModels: mocks.disabled
}));
vi.mock("../../open-sse/services/kiroModels.js", () => ({
  resolveKiroModels: mocks.live
}));
import { buildModelsList } from "../../src/app/api/v1/models/route.js";
const connection = {
  id: "fixture",
  provider: "openai-compatible-fixture",
  isActive: true,
  apiKey: "fixture",
  providerSpecificData: {
    prefix: "curated",
    baseUrl: "https://gateway.fixture/v1"
  }
};
beforeEach(() => {
  vi.clearAllMocks();
  db.getProviderConnections.mockResolvedValue([connection]);
  db.getCustomModels.mockResolvedValue([]);
  mocks.disabled.mockResolvedValue({});
  mocks.live.mockResolvedValue({
    models: [{
      id: "unrequested"
    }]
  });
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({
    data: [{
      id: "upstream-live"
    }]
  })));
});
afterEach(() => vi.unstubAllGlobals());
describe("configured public model catalogs", () => {
  it("does not expand a compatible node beyond saved custom models", async () => {
    db.getCustomModels.mockResolvedValue([{
      providerAlias: connection.provider,
      id: "chosen",
      type: "llm"
    }]);
    const models = await buildModelsList(["llm"]);
    expect(models.some(m => m.id === "curated/chosen")).toBe(true);
    expect(models.some(m => m.id === "curated/upstream-live")).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("keeps registry models instead of overwriting them with an account catalog", async () => {
    db.getProviderConnections.mockResolvedValue([{
      id: "fixture",
      provider: "kiro",
      isActive: true,
      accessToken: "fixture",
      providerSpecificData: {}
    }]);
    const models = await buildModelsList(["llm"]);
    expect(models.some(m => m.id === "kr/claude-sonnet-5")).toBe(true);
    expect(models.some(m => m.id.includes("unrequested"))).toBe(false);
    expect(mocks.live).not.toHaveBeenCalled();
  });
  it("still discovers models for an unconfigured compatible node", async () => {
    const models = await buildModelsList(["llm"]);
    expect(models.some(m => m.id === "curated/upstream-live")).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("keeps explicit per-connection model lists", async () => {
    db.getProviderConnections.mockResolvedValue([{
      ...connection,
      providerSpecificData: {
        ...connection.providerSpecificData,
        enabledModels: ["explicit"]
      }
    }]);
    const models = await buildModelsList(["llm"]);
    expect(models.some(m => m.id === "curated/explicit")).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("respects disabled saved models and still exposes no-auth free providers", async () => {
    db.getCustomModels.mockResolvedValue([{
      providerAlias: connection.provider,
      id: "chosen",
      type: "llm"
    }]);
    mocks.disabled.mockResolvedValue({
      curated: ["chosen"]
    });
    const models = await buildModelsList(["llm"]);
    expect(models.some(m => m.id === "curated/chosen")).toBe(false);
    expect(models.some(m => m.id === "oc/union-alpha")).toBe(true);
  });
});
