import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getCombos: vi.fn(),
  getCustomModels: vi.fn(),
  getModelAliases: vi.fn(),
  getDisabledModels: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
  getCombos: mocks.getCombos,
  getCustomModels: mocks.getCustomModels,
  getModelAliases: mocks.getModelAliases,
}));
vi.mock("@/lib/disabledModelsDb", () => ({ getDisabledModels: mocks.getDisabledModels }));

const { buildModelsList } = await import("../../src/app/api/v1/models/route.js");

describe("custom model /v1/models metadata", () => {
  beforeEach(() => {
    mocks.getCombos.mockResolvedValue([]);
    mocks.getModelAliases.mockResolvedValue({});
    mocks.getDisabledModels.mockResolvedValue({});
    mocks.getProviderConnections.mockResolvedValue([
      {
        provider: "openai-compatible-node-a",
        isActive: true,
        providerSpecificData: { prefix: "prefix-a", enabledModels: ["shared", "unknown"] },
      },
      {
        provider: "openai-compatible-node-b",
        isActive: true,
        providerSpecificData: { prefix: "prefix-b", enabledModels: ["shared"] },
      },
    ]);
    mocks.getCustomModels.mockResolvedValue([
      {
        providerAlias: "openai-compatible-node-a",
        id: "shared",
        type: "llm",
        caps: { contextWindow: 131072, maxOutput: 8192 },
      },
      {
        providerAlias: "openai-compatible-node-b",
        id: "shared",
        type: "llm",
        caps: { contextWindow: 262144, maxOutput: 16384 },
      },
      { providerAlias: "openai-compatible-node-a", id: "unknown", type: "llm" },
    ]);
  });

  it("exposes provider-scoped saved limits under configured prefixes", async () => {
    const models = await buildModelsList(["llm"], { skipDynamicFetch: true });
    const a = models.find((model) => model.id === "prefix-a/shared");
    const b = models.find((model) => model.id === "prefix-b/shared");

    expect(a).toMatchObject({
      context_length: 131072,
      max_input_tokens: 131072,
      max_completion_tokens: 8192,
      max_output_tokens: 8192,
      capabilities: { contextWindow: 131072, maxOutput: 8192 },
    });
    expect(b).toMatchObject({
      context_length: 262144,
      max_completion_tokens: 16384,
      capabilities: { contextWindow: 262144, maxOutput: 16384 },
    });
  });

  it("does not invent limits for an unknown custom model", async () => {
    const models = await buildModelsList(["llm"], { skipDynamicFetch: true });
    const unknown = models.find((model) => model.id === "prefix-a/unknown");

    expect(unknown).toBeDefined();
    expect(unknown).not.toHaveProperty("context_length");
    expect(unknown).not.toHaveProperty("max_completion_tokens");
    expect(unknown.capabilities).not.toHaveProperty("contextWindow");
    expect(unknown.capabilities).not.toHaveProperty("maxOutput");
  });
});
