import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  comboModels: ["provider/model-a", "provider/model-b"],
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: async () => [{
    id: "connection-a",
    provider: "provider",
    isActive: true,
    providerSpecificData: {
      enabledModels: ["model-a", "model-b"],
      prefix: "provider",
    },
  }],
  getCombos: async () => [{
    name: "coding-pro",
    models: [...state.comboModels],
  }],
  getCustomModels: async () => [],
  getModelAliases: async () => ({}),
}));

vi.mock("@/shared/constants/models", () => ({
  PROVIDER_MODELS: {},
  PROVIDER_ID_TO_ALIAS: {},
  getModelKind: () => "llm",
}));

vi.mock("@/shared/constants/providers", () => ({
  AI_PROVIDERS: {},
  getProviderAlias: (provider) => provider,
  isAnthropicCompatibleProvider: () => false,
  isOpenAICompatibleProvider: () => false,
}));

vi.mock("@/lib/disabledModelsDb", () => ({
  getDisabledModels: async () => ({}),
}));

vi.mock("@/sse/services/tokenRefresh", () => ({
  updateProviderCredentials: async () => {},
}));

vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: async () => ({}),
}));

import { GET } from "../../src/app/api/v1/models/route.js";

async function modelsResponse(headers = {}) {
  return GET(new Request("http://localhost/v1/models", { headers }));
}

async function comboEntry(response) {
  const payload = await response.json();
  return payload.data.find((model) => model.id === "coding-pro");
}

beforeEach(() => {
  state.comboModels = ["provider/model-a", "provider/model-b"];
});

describe("proposed safe Combo /v1/models metadata contract", () => {
  it("never exposes Combo membership or a representative physical model", async () => {
    const combo = await comboEntry(await modelsResponse());

    expect(combo).toMatchObject({
      id: "coding-pro",
      object: "model",
      owned_by: "combo",
    });
    expect(combo).not.toHaveProperty("models");
    expect(combo).not.toHaveProperty("members");
    expect(combo).not.toHaveProperty("representativeModel");
  });

  it.fails("projects only capabilities safe across every resolved Combo leaf", async () => {
    const { aggregateComboCapabilities } = await import("../../open-sse/providers/capabilities.js");
    const capabilitiesById = {
      "provider/model-a": {
        vision: true,
        tools: true,
        reasoning: true,
        contextWindow: 200000,
        maxOutput: 64000,
      },
      "provider/model-b": {
        vision: false,
        tools: true,
        reasoning: false,
        contextWindow: 120000,
        maxOutput: 32000,
      },
    };

    const caps = aggregateComboCapabilities(state.comboModels, {
      resolveCapabilities: (modelId) => capabilitiesById[modelId],
    });

    expect(caps).toMatchObject({
      vision: false,
      tools: true,
      reasoning: false,
      contextWindow: 120000,
      maxOutput: 32000,
    });
  });

  it.fails("adds conservative public metadata to the logical Combo entry", async () => {
    const combo = await comboEntry(await modelsResponse());

    expect(combo.contextWindow).toBeGreaterThan(0);
    expect(combo.capabilities).toEqual(expect.objectContaining({
      vision: expect.any(Boolean),
      tools: expect.any(Boolean),
      reasoning: expect.any(Boolean),
    }));
  });

  it.fails("returns a strong ETag and honors If-None-Match with 304", async () => {
    const first = await modelsResponse();
    const etag = first.headers.get("etag");
    expect(etag).toMatch(/^"sha256:[a-f0-9]{64}"$/);

    const conditional = await modelsResponse({ "If-None-Match": etag });
    expect(conditional.status).toBe(304);
    expect(conditional.headers.get("etag")).toBe(etag);
    expect(await conditional.text()).toBe("");
  });

  it.fails("changes the opaque validator when private routing membership changes", async () => {
    const first = await modelsResponse();
    const firstPayload = await first.clone().json();
    const firstTag = first.headers.get("etag");

    state.comboModels = ["provider/model-b", "provider/model-a"];
    const second = await modelsResponse();
    const secondPayload = await second.clone().json();
    const secondTag = second.headers.get("etag");

    expect(secondPayload).toEqual(firstPayload);
    expect(secondTag).toMatch(/^"sha256:[a-f0-9]{64}"$/);
    expect(secondTag).not.toBe(firstTag);
    expect(secondTag).not.toContain("provider/model-a");
    expect(secondTag).not.toContain("provider/model-b");
  });
});
