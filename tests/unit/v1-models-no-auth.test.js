import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getProviderConnections, getCombos, getDisabledModels } = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getCombos: vi.fn(),
  getDisabledModels: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections,
  getCombos,
  getCustomModels: vi.fn(async () => []),
  getModelAliases: vi.fn(async () => ({})),
}));
vi.mock("@/lib/disabledModelsDb", () => ({
  getDisabledModels,
}));
vi.mock("@/sse/services/tokenRefresh", () => ({
  updateProviderCredentials: vi.fn(),
}));
vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: vi.fn(() => null),
}));

import { buildModelsList } from "../../src/app/api/v1/models/route.js";
import { AI_PROVIDERS } from "../../src/shared/constants/providers.js";

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
    getCombos.mockResolvedValue([]);
    getDisabledModels.mockResolvedValue({});
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

    const tokenRequiredAliases = new Set(
      Object.values(AI_PROVIDERS)
        .filter((provider) => !provider.noAuth)
        .flatMap((provider) => [provider.id, provider.alias].filter(Boolean)),
    );
    expect(models.every((model) => (
      model.owned_by === "combo" || !tokenRequiredAliases.has(model.owned_by)
    ))).toBe(true);
  });

  it("does not fetch dynamic catalogs for recursive model requests", async () => {
    getProviderConnections.mockResolvedValue([]);

    const models = await buildModelsList(["llm"], { skipDynamicFetch: true });

    expect(fetch).not.toHaveBeenCalled();
    expect(models.some((model) => model.id.startsWith("oc/"))).toBe(false);
  });

  it("keeps disabled models out of the public list but includes them for dashboard management", async () => {
    getProviderConnections.mockResolvedValue([]);
    getCombos.mockResolvedValue([{ name: "fallback-combo", kind: "llm", models: [] }]);
    getDisabledModels.mockResolvedValue({ combo: ["fallback-combo"] });

    const publicModels = await buildModelsList(["llm"], { skipDynamicFetch: true });
    const dashboardModels = await buildModelsList(["llm"], {
      includeDisabled: true,
      skipDynamicFetch: true,
    });

    expect(publicModels.some((model) => model.id === "fallback-combo")).toBe(false);
    expect(dashboardModels).toContainEqual(expect.objectContaining({
      id: "fallback-combo",
      owned_by: "combo",
      disabled: true,
    }));
  });
});
