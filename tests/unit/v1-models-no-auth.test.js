import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getProviderConnections } = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections,
  getCombos: vi.fn(async () => []),
  getCustomModels: vi.fn(async () => []),
  getModelAliases: vi.fn(async () => ({})),
}));
vi.mock("@/lib/disabledModelsDb", () => ({
  getDisabledModels: vi.fn(async () => ({})),
}));
vi.mock("@/sse/services/tokenRefresh", () => ({
  updateProviderCredentials: vi.fn(),
}));
vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: vi.fn(() => null),
}));

import { buildModelsList } from "../../src/app/api/v1/models/route.js";

const opencodeCatalog = {
  object: "list",
  data: [
    { id: "paid-model", object: "model" },
    { id: "big-pickle", object: "model" },
    { id: "deepseek-v4-flash-free", object: "model" },
  ],
};

describe("/v1/models no-auth providers", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      if (String(url) === "https://opencode.ai/zen/v1/models") {
        return { ok: true, json: async () => opencodeCatalog };
      }
      return { ok: false, json: async () => ({}) };
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("lists OpenCode Free models when another provider is connected", async () => {
    getProviderConnections.mockResolvedValue([
      { provider: "openai", isActive: true, providerSpecificData: {} },
    ]);

    const models = await buildModelsList(["llm"]);
    const ids = models.map((model) => model.id);

    expect(ids).toContain("oc/big-pickle");
    expect(ids).toContain("oc/deepseek-v4-flash-free");
    expect(ids).not.toContain("oc/paid-model");
  });

  it("lists OpenCode Free models without persisted connections", async () => {
    getProviderConnections.mockResolvedValue([]);

    const models = await buildModelsList(["llm"]);
    const ids = models.map((model) => model.id);

    expect(ids).toContain("oc/big-pickle");
    expect(ids).toContain("oc/deepseek-v4-flash-free");
  });

  it("does not fetch dynamic catalogs for recursive model requests", async () => {
    getProviderConnections.mockResolvedValue([]);

    const models = await buildModelsList(["llm"], { skipDynamicFetch: true });

    expect(fetch).not.toHaveBeenCalled();
    expect(models.some((model) => model.id.startsWith("oc/"))).toBe(false);
  });
});
