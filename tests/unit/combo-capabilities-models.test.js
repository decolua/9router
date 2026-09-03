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

describe("combo model metadata", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getProviderConnections.mockResolvedValue([]);
    mocks.getCustomModels.mockResolvedValue([]);
    mocks.getModelAliases.mockResolvedValue({});
    mocks.getDisabledModels.mockResolvedValue({});
  });

  it("advertises configured context and input capabilities", async () => {
    const caps = {
      contextWindow: 128000,
      vision: true,
      pdf: true,
      audioInput: false,
      videoInput: false,
    };
    mocks.getCombos.mockResolvedValue([{ name: "mixed", kind: null, models: ["glm/glm-5.3-flash"], caps }]);

    const model = (await buildModelsList(["llm"])).find((entry) => entry.id === "mixed");

    expect(model).toMatchObject({
      owned_by: "combo",
      context_length: 128000,
      capabilities: caps,
    });
  });

  it("clamps advertised metadata when a model override lowers the safe limit", async () => {
    mocks.getCustomModels.mockResolvedValue([{
      providerAlias: "cx",
      id: "gpt-5.6-sol",
      type: "llm",
      caps: { contextWindow: 123456, vision: false },
    }]);
    mocks.getCombos.mockResolvedValue([{
      name: "lowered",
      kind: null,
      models: ["codex/gpt-5.6-sol"],
      caps: { contextWindow: 200000, vision: true },
    }]);

    const model = (await buildModelsList(["llm"])).find((entry) => entry.id === "lowered");

    expect(model.context_length).toBe(123456);
    expect(model.capabilities.contextWindow).toBe(123456);
    expect(model.capabilities.vision).toBe(false);
  });

  it("keeps legacy combos backward compatible", async () => {
    mocks.getCombos.mockResolvedValue([{ name: "legacy", kind: null, models: ["p/model"] }]);

    const model = (await buildModelsList(["llm"])).find((entry) => entry.id === "legacy");

    expect(model).toEqual({ id: "legacy", object: "model", owned_by: "combo" });
  });
});
