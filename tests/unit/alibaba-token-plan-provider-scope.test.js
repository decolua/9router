import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: async () => [{
    id: "openai-1",
    provider: "openai",
    isActive: true,
    apiKey: "sk-test",
    providerSpecificData: {},
  }],
  getCombos: async () => [],
  getCustomModels: async () => [],
  getModelAliases: async () => ({}),
}));

vi.mock("@/lib/disabledModelsDb", () => ({
  getDisabledModels: async () => ({}),
}));

const { buildModelsList } = await import("../../src/app/api/v1/models/route.js");

describe("Alibaba Token Plan provider scope", () => {
  it("does not change capabilities on typed models from other providers", async () => {
    const models = await buildModelsList(["image"]);
    const image = models.find((model) => model.id === "openai/gpt-image-1");

    expect(image).toBeDefined();
    expect(image.capabilities).toBeUndefined();
  });
});
