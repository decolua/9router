import { afterEach, describe, expect, it, vi } from "vitest";
import { getCapabilitiesForModel, setCatalogSource } from "open-sse/providers/capabilities.js";
import { getDefaultModel, getModelsByProviderId } from "open-sse/config/providerModels.js";

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: async () => [{ id: "kimi-test", provider: "kimi", isActive: true }],
  getCombos: async () => [],
  getCustomModels: async () => [],
  getModelAliases: async () => ({}),
}));
vi.mock("@/lib/disabledModelsDb", () => ({ getDisabledModels: async () => ({}) }));

const { buildModelsList } = await import("../../src/app/api/v1/models/route.js");
afterEach(() => setCatalogSource(null));

describe("Kimi Code K3.1 context metadata (#5605)", () => {
  it.each(["k3.1-pro", "k3.1-pro-highspeed"])("recognizes the official Coding Plan id %s", (id) => {
    expect(getCapabilitiesForModel("kimi", id)).toMatchObject({
      contextWindow: 1048576,
      reasoning: true,
      thinkingFormat: "kimi",
      thinkingCanDisable: false,
      vision: true,
      videoInput: true,
    });
    expect(getModelsByProviderId("kimi").find(model => model.id === id)).toBeDefined();
  });

  it("advertises the correct context length to OpenAI-compatible model clients", async () => {
    const models = await buildModelsList(["llm"], { skipDynamicFetch: true });
    for (const id of ["k3.1-pro", "k3.1-pro-highspeed"]) {
      expect(models.find(model => model.id === `kimi/${id}`)).toMatchObject({
        context_length: 1048576,
        capabilities: { contextWindow: 1048576, reasoning: true, vision: true },
      });
    }
  });

  it("resolves the same model through existing Kimi provider aliases and vendor-prefixed ids", () => {
    for (const provider of ["kimi", "kimi-coding", "kmc"]) {
      expect(getCapabilitiesForModel(provider, "moonshotai/k3.1-pro").contextWindow).toBe(1048576);
    }
  });

  it("retains a provider-scoped synced context limit", () => {
    setCatalogSource({ getModalities: () => null, getLimits: () => ({ contextWindow: 262144 }) });
    expect(getCapabilitiesForModel("kimi", "k3.1-pro").contextWindow).toBe(262144);
  });

  it("preserves existing model defaults and avoids assigning 1M to unknown bare ids", () => {
    expect(getDefaultModel("kimi")).toBe("kimi-k3");
    expect(getCapabilitiesForModel("kimi", "k3").contextWindow).toBe(1048576);
    expect(getCapabilitiesForModel("kimi", "kimi-for-coding-highspeed").contextWindow).toBe(262144);
    expect(getCapabilitiesForModel("kimi", "k3-unknown").contextWindow).toBe(200000);
  });
});
