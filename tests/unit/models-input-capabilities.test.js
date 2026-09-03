import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCustomModels: vi.fn(async () => []),
  getProviderConnections: vi.fn(async () => []),
}));

vi.mock("@/models", () => ({
  getModelAliases: vi.fn(async () => ({})),
  getCustomModels: mocks.getCustomModels,
  setModelAlias: vi.fn(),
}));
vi.mock("@/lib/disabledModelsDb", () => ({ getDisabledModels: vi.fn(async () => ({})) }));
vi.mock("@/lib/localDb", () => ({ getProviderConnections: mocks.getProviderConnections }));
vi.mock("@/shared/constants/config", () => ({
  AI_MODELS: [
    { provider: "gemini", model: "gemini-2.5-pro", name: "Gemini" },
    { provider: "cx", model: "gpt-5.6-sol", name: "Codex" },
  ],
}));

const { GET } = await import("../../src/app/api/models/route.js");

describe("GET /api/models input capabilities", () => {
  it("exposes every input capability used by combo safety checks", async () => {
    const response = await GET();
    const [{ caps }] = (await response.json()).models;

    expect(caps).toMatchObject({
      vision: true,
      pdf: false,
      audioInput: true,
      videoInput: true,
      contextWindow: 1048576,
    });
  });

  it("exposes the configured prefix for compatible-provider custom models", async () => {
    mocks.getCustomModels.mockResolvedValueOnce([{
      providerAlias: "openai-compatible-chat-1",
      id: "multimodal-probe",
      caps: { vision: true },
    }]);
    mocks.getProviderConnections.mockResolvedValueOnce([{
      provider: "openai-compatible-chat-1",
      providerSpecificData: { prefix: "private" },
    }]);

    const response = await GET();
    const custom = (await response.json()).models.find((model) => model.model === "multimodal-probe");
    expect(custom.routedModel).toBe("private/multimodal-probe");
  });

  it("resolves provider aliases before computing model limits", async () => {
    const response = await GET();
    const codex = (await response.json()).models.find((model) => model.fullModel === "cx/gpt-5.6-sol");
    expect(codex.caps.contextWindow).toBe(372000);
  });

  it("applies a stored context override to a built-in provider model", async () => {
    mocks.getCustomModels.mockResolvedValueOnce([{
      providerAlias: "gemini",
      id: "gemini-2.5-pro",
      type: "llm",
      caps: { contextWindow: 262144 },
    }]);

    const response = await GET();
    const model = (await response.json()).models.find((entry) => entry.fullModel === "gemini/gemini-2.5-pro");
    expect(model.caps.contextWindow).toBe(262144);
  });

  it("applies a canonical-ID override to an alias-routed provider model", async () => {
    mocks.getCustomModels.mockResolvedValueOnce([{
      providerAlias: "codex",
      id: "gpt-5.6-sol",
      type: "llm",
      caps: { contextWindow: 131072 },
    }]);

    const response = await GET();
    const model = (await response.json()).models.find((entry) => entry.fullModel === "cx/gpt-5.6-sol");
    expect(model.caps.contextWindow).toBe(131072);
  });

  it("does not apply non-LLM metadata to a provider model with the same ID", async () => {
    mocks.getCustomModels.mockResolvedValueOnce([{
      providerAlias: "gemini",
      id: "gemini-2.5-pro",
      type: "image",
      caps: { contextWindow: 1 },
    }]);

    const response = await GET();
    const model = (await response.json()).models.find((entry) => entry.fullModel === "gemini/gemini-2.5-pro");
    expect(model.caps.contextWindow).toBe(1048576);
  });
});
