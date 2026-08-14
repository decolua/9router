import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  jsonResponse: vi.fn((body, init) => ({ status: init?.status || 200, body })),
  getProviderConnections: vi.fn(),
  getCombos: vi.fn(),
  getCustomModels: vi.fn(),
  getModelAliases: vi.fn(),
  getDisabledModels: vi.fn(),
  getCapsOverrides: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: { json: mocks.jsonResponse },
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

vi.mock("@/lib/db/index.js", () => ({
  getCapsOverrides: mocks.getCapsOverrides,
}));

const { GET } = await import("../../src/app/api/v1/models/route.js");

describe("GET /v1/models — caps overrides and model aliases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getProviderConnections.mockResolvedValue([
      { id: "conn-1", provider: "openai", apiKey: "sk-test", isActive: true },
    ]);
    mocks.getCombos.mockResolvedValue([]);
    mocks.getCustomModels.mockResolvedValue([]);
    mocks.getModelAliases.mockResolvedValue({});
    mocks.getDisabledModels.mockResolvedValue({});
    mocks.getCapsOverrides.mockResolvedValue({});
  });

  it("applies capability overrides to context_length and capabilities in /v1/models", async () => {
    mocks.getCapsOverrides.mockResolvedValue({
      "openai|gpt-4o": { contextWindow: 500000, maxOutput: 32000, reasoning: true },
    });

    const response = await GET(new Request("http://localhost:20128/v1/models"));
    const data = await response.json();
    const model = data.data.find((m) => m.id === "openai/gpt-4o");

    expect(model).toBeTruthy();
    expect(model.context_length).toBe(500000);
    expect(model.max_completion_tokens).toBe(32000);
    expect(model.capabilities.reasoning).toBe(true);
  });

  it("exposes configured model aliases as top-level models in /v1/models", async () => {
    mocks.getModelAliases.mockResolvedValue({
      "my-custom-gpt4": "openai/gpt-4o",
    });
    mocks.getCapsOverrides.mockResolvedValue({
      "openai|gpt-4o": { contextWindow: 250000 },
    });

    const response = await GET(new Request("http://localhost:20128/v1/models"));
    const data = await response.json();
    const aliasModel = data.data.find((m) => m.id === "my-custom-gpt4");

    expect(aliasModel).toBeTruthy();
    expect(aliasModel.owned_by).toBe("alias");
    expect(aliasModel.context_length).toBe(250000);
  });

  it("computes conservative minimum context and capabilities for combos", async () => {
    mocks.getCombos.mockResolvedValue([
      {
        id: "combo-1",
        name: "test-combo",
        models: ["openai/gpt-4o", "anthropic/claude-3-haiku-20240307"],
      },
    ]);
    mocks.getCapsOverrides.mockResolvedValue({
      "openai|gpt-4o": { contextWindow: 128000, maxOutput: 4096, vision: true, tools: true },
      "anthropic|claude-3-haiku-20240307": { contextWindow: 200000, maxOutput: 4096, vision: false, tools: true },
    });

    const response = await GET(new Request("http://localhost:20128/v1/models"));
    const data = await response.json();
    const combo = data.data.find((m) => m.id === "test-combo");

    expect(combo).toBeTruthy();
    expect(combo.owned_by).toBe("combo");
    // Minimum context window (min(128k, 200k) = 128k)
    expect(combo.context_length).toBe(128000);
    // Intersection of boolean capabilities (vision is false because haiku has false)
    expect(combo.capabilities.vision).toBe(false);
    // Tools is true because both support tools
    expect(combo.capabilities.tools).toBe(true);
  });
});
