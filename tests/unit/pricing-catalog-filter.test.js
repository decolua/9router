import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  connections: [],
  nodes: [],
  customModels: [],
  pricingModels: {},
  mappings: [],
  settings: {},
  disabledModels: {},
}));

vi.mock("@/lib/disabledModelsDb", () => ({
  getDisabledModels: vi.fn(async () => state.disabledModels),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: vi.fn(async () => state.connections),
  getProviderNodes: vi.fn(async () => state.nodes),
  getCustomModels: vi.fn(async () => state.customModels),
  getPricingModels: vi.fn(async () => state.pricingModels),
  getPricingMappings: vi.fn(async () => state.mappings),
  getSettings: vi.fn(async () => state.settings),
}));

import { getPricingPageData, getProviderPricingCatalog } from "../../src/shared/services/pricingCatalog.js";

beforeEach(() => {
  state.connections = [
    { provider: "glm", isActive: true },
    { provider: "glm-cn", isActive: false },
    { provider: "opencode-go", isActive: false, autoDisabled: true },
    { provider: "github", isActive: true },
    { provider: "claude", isActive: true },
    { provider: "custom-node", isActive: true, providerSpecificData: { enabledModels: ["custom-node/live-model"] } },
    { provider: "legacy-auto", isActive: false, autoDisabledReason: "quota exceeded", providerSpecificData: { enabledModels: ["legacy-model"] } },
  ];
  state.nodes = [
    { id: "custom-node", prefix: "custom-node", name: "Custom Node" },
    { id: "legacy-auto", prefix: "legacy-auto", name: "Legacy Auto" },
  ];
  state.customModels = [
    { providerAlias: "glm", id: "glm-custom" },
    { providerAlias: "glm-cn", id: "disabled-custom" },
    { providerAlias: "gh", id: "smart-custom" },
  ];
  state.pricingModels = { "glm-5.3": { input: 1, output: 4 } };
  state.mappings = [
    { provider: "glm", model: "glm-5.3", pricingModel: "glm-5.3" },
    { provider: "glm-cn", model: "glm-5.3", pricingModel: "glm-5.3" },
  ];
  state.settings = {
    defaultPricingModel: "glm-5.3",
    providerDisplayNames: {},
    smartRoutingProviders: { github: { enabled: true } },
  };
  state.disabledModels = {};
});

describe("pricing provider catalog filtering", () => {
  it("keeps enabled and auto-disabled providers while excluding manual-disabled and smart-routing providers", async () => {
    const catalog = await getProviderPricingCatalog();
    const providers = new Set(catalog.map((item) => item.provider));

    expect(providers).toContain("glm");
    expect(providers).toContain("opencode-go");
    expect(providers).toContain("custom-node");
    expect(providers).toContain("legacy-auto");
    expect(providers).not.toContain("glm-cn");
    expect(providers).not.toContain("github");
    expect(catalog).toContainEqual(expect.objectContaining({ provider: "claude", disableProviderAlias: "cc" }));
    expect(catalog).toContainEqual(expect.objectContaining({ provider: "glm", model: "glm-custom" }));
    expect(catalog).not.toContainEqual(expect.objectContaining({ model: "disabled-custom" }));
    expect(catalog).not.toContainEqual(expect.objectContaining({ model: "smart-custom" }));
  });

  it("counts only mappings belonging to currently visible provider models", async () => {
    const data = await getPricingPageData();
    const glmPricing = data.priced.find((item) => item.model === "glm-5.3");

    expect(glmPricing.mappedCount).toBe(1);
    expect(data.providerModels.some((item) => item.provider === "glm-cn")).toBe(false);
  });

  it("excludes disabled models after normalizing provider aliases", async () => {
    state.disabledModels = { glm: ["glm-5.3", "glm-custom"] };

    const catalog = await getProviderPricingCatalog();

    expect(catalog).not.toContainEqual(expect.objectContaining({ provider: "glm", model: "glm-5.3" }));
    expect(catalog).not.toContainEqual(expect.objectContaining({ provider: "glm", model: "glm-custom" }));
  });

  it("excludes no-auth free providers after they are disabled", async () => {
    state.settings.freeProviderStates = { opencode: false };

    const catalog = await getProviderPricingCatalog();

    expect(catalog).not.toContainEqual(expect.objectContaining({ provider: "opencode" }));
  });

  it("excludes hidden free providers from the pricing catalog", async () => {
    const catalog = await getProviderPricingCatalog();

    expect(catalog).not.toContainEqual(expect.objectContaining({ provider: "mimo-free" }));
  });
});
