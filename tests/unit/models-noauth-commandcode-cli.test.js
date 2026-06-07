import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: vi.fn(),
  getCombos: vi.fn(),
  getCustomModels: vi.fn(),
  getModelAliases: vi.fn(),
}));

vi.mock("@/lib/disabledModelsDb", () => ({
  getDisabledModels: vi.fn(),
}));

vi.mock("open-sse/services/commandCodeCliModels.js", () => ({
  resolveCommandCodeCliModels: vi.fn(),
}));

vi.mock("open-sse/services/kiroModels.js", () => ({
  resolveKiroModels: vi.fn(),
}));

vi.mock("open-sse/services/qoderModels.js", () => ({
  resolveQoderModels: vi.fn(),
}));

const localDb = await import("@/lib/localDb");
const disabledModelsDb = await import("@/lib/disabledModelsDb");
const commandCodeCliModels = await import("open-sse/services/commandCodeCliModels.js");
const { buildModelsList } = await import("../../src/app/api/v1/models/route.js");

describe("/v1/models noAuth commandcode-cli catalog", () => {
  beforeEach(() => {
    vi.mocked(localDb.getProviderConnections).mockResolvedValue([
      { provider: "openai", isActive: true, providerSpecificData: {} },
    ]);
    vi.mocked(localDb.getCombos).mockResolvedValue([]);
    vi.mocked(localDb.getCustomModels).mockResolvedValue([]);
    vi.mocked(localDb.getModelAliases).mockResolvedValue({});
    vi.mocked(disabledModelsDb.getDisabledModels).mockResolvedValue({});
    vi.mocked(commandCodeCliModels.resolveCommandCodeCliModels).mockResolvedValue({
      models: [{ id: "deepseek/deepseek-v4-pro", name: "DeepSeek V4 Pro" }],
      source: "static",
    });
  });

  it("includes cccli models for noAuth commandcode-cli without a saved connection", async () => {
    const models = await buildModelsList(["llm"]);

    expect(models).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "cccli/deepseek/deepseek-v4-pro",
        object: "model",
        owned_by: "cccli",
      }),
    ]));
  });
});
