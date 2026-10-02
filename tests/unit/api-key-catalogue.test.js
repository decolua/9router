import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getApiKeyByValue: vi.fn(), getModelInfo: vi.fn(),
  getProviderConnections: vi.fn(async () => []), getCombos: vi.fn(async () => []),
  getCustomModels: vi.fn(async () => []), getModelAliases: vi.fn(async () => ({})),
}));
vi.mock("@/lib/localDb", () => mocks);
vi.mock("@/lib/disabledModelsDb", () => ({ getDisabledModels: async () => ({}) }));
vi.mock("@/sse/services/model", () => ({ getModelInfo: mocks.getModelInfo }));

const { filterModelsForApiKey } = await import("../../src/app/api/v1/models/route.js");
const { GET: getInfo } = await import("../../src/app/api/v1/models/info/route.js");
const catalogue = [{ id: "local/model-a" }, { id: "local/model-b" }, { id: "ds/deepseek-chat" }, { id: "combo" }];

describe("key-scoped model catalogue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getModelInfo.mockImplementation(async (id) => {
      const slash = id.indexOf("/");
      const prefix = id.slice(0, slash);
      return { provider: prefix === "local" ? "openai-compatible-node" : "deepseek", model: id.slice(slash + 1) };
    });
  });

  it("retains the full catalogue for legacy keys without lookups", async () => {
    expect(await filterModelsForApiKey(catalogue, { permissions: {} })).toEqual(catalogue);
    expect(mocks.getModelInfo).not.toHaveBeenCalled();
  });

  it("resolves custom prefixes and built-in aliases to stable provider IDs", async () => {
    expect(await filterModelsForApiKey(catalogue, { permissions: { providerIds: ["openai-compatible-node"] } }))
      .toEqual(catalogue.slice(0, 2));
    expect(mocks.getModelInfo).toHaveBeenCalledTimes(2);
    expect(await filterModelsForApiKey(catalogue, { permissions: { models: ["deepseek/deepseek-chat"] } }))
      .toEqual([catalogue[2]]);
  });

  it("publishes only the enforced model and still honors grants", async () => {
    expect(await filterModelsForApiKey(catalogue, { permissions: { forceModel: "local/model-a" } })).toEqual([catalogue[0]]);
    expect(await filterModelsForApiKey(catalogue, { permissions: {
      forceModel: "local/model-a", providerIds: ["deepseek"],
    } })).toEqual([]);
    expect(await filterModelsForApiKey(catalogue, { permissions: {
      forceModel: "local/model-a", forceProviderId: "deepseek",
    } })).toEqual([]);
  });

  it("fails closed when resolution fails", async () => {
    mocks.getModelInfo.mockRejectedValue(new Error("lookup unavailable"));
    expect(await filterModelsForApiKey(catalogue, { permissions: { forceModel: "local/model-a" } })).toEqual([]);
  });

  it("does not publish an invalid forced combo route", async () => {
    expect(await filterModelsForApiKey(catalogue, { permissions: { forceModel: "combo" } })).toEqual([]);
  });

  it.each(["bearer", "x-api-key", "x-goog-api-key", "query"])("filters metadata with %s key transport", async (transport) => {
    mocks.getApiKeyByValue.mockResolvedValue({ isActive: true, permissions: { providerIds: ["other"] } });
    const headers = transport === "bearer" ? { Authorization: "Bearer test-key" }
      : transport === "query" ? {} : { [transport]: "test-key" };
    const request = new Request(`https://router.test/v1/models/info?id=ds/deepseek-chat${transport === "query" ? "&key=test-key" : ""}`, { headers });
    expect((await getInfo(request)).status).toBe(404);
    expect(mocks.getApiKeyByValue).toHaveBeenCalledWith("test-key");
  });
});
