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

vi.mock("@/lib/disabledModelsDb", () => ({
  getDisabledModels: mocks.getDisabledModels,
}));

describe("combo model context metadata", () => {
  beforeEach(() => {
    mocks.getProviderConnections.mockResolvedValue([]);
    mocks.getCombos.mockResolvedValue([{
      name: "gpt-5.2",
      models: ["cx/gpt-5.3-codex-spark"],
    }]);
    mocks.getCustomModels.mockResolvedValue([]);
    mocks.getModelAliases.mockResolvedValue({});
    mocks.getDisabledModels.mockResolvedValue({});
  });

  it("inherits the smallest member context window", async () => {
    const { buildModelsList } = await import("../../src/app/api/v1/models/route.js");
    const models = await buildModelsList(["llm"], { skipDynamicFetch: true });

    expect(models.find((model) => model.id === "gpt-5.2")).toMatchObject({
      owned_by: "combo",
      context_length: 128000,
    });
  });
});
