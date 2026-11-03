import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createCombo: vi.fn(),
  getCustomModels: vi.fn(),
  getProviderConnections: vi.fn(),
  getComboByName: vi.fn(),
  getCombos: vi.fn(),
  getModelAliases: vi.fn(),
}));

vi.mock("@/lib/localDb", () => mocks);

const { POST } = await import("../../src/app/api/combos/route.js");

describe("POST /api/combos capability metadata", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getComboByName.mockResolvedValue(null);
    mocks.getCustomModels.mockResolvedValue([]);
    mocks.getProviderConnections.mockResolvedValue([]);
    mocks.getModelAliases.mockResolvedValue({});
    mocks.createCombo.mockImplementation(async (value) => ({ id: "combo-id", ...value }));
  });

  it("persists configured context and input capabilities", async () => {
    const caps = {
      contextWindow: 128000,
      vision: true,
      pdf: false,
      audioInput: false,
      videoInput: false,
    };
    const response = await POST(new Request("https://router.test/api/combos", {
      method: "POST",
      body: JSON.stringify({ name: "mixed", models: ["codex/gpt-5.6-sol"], caps }),
    }));

    expect(response.status).toBe(201);
    expect(mocks.createCombo).toHaveBeenCalledWith({
      name: "mixed",
      models: ["codex/gpt-5.6-sol"],
      kind: null,
      caps,
    });
  });

  it("rejects invalid capability metadata", async () => {
    const response = await POST(new Request("https://router.test/api/combos", {
      method: "POST",
      body: JSON.stringify({ name: "bad", models: ["p/model"], caps: { contextWindow: 0, vision: "yes" } }),
    }));

    expect(response.status).toBe(400);
    expect(mocks.createCombo).not.toHaveBeenCalled();
  });

  it("rejects metadata unsupported by every fallback", async () => {
    const response = await POST(new Request("https://router.test/api/combos", {
      method: "POST",
      body: JSON.stringify({
        name: "unsafe",
        models: ["codex/gpt-5.6-sol", "openai/gpt-5-codex"],
        caps: { contextWindow: 128000, vision: true },
      }),
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Vision is not supported by every fallback model" });
    expect(mocks.createCombo).not.toHaveBeenCalled();
  });

  it("uses custom-model capability overrides for safety validation", async () => {
    mocks.getCustomModels.mockResolvedValue([{
      providerAlias: "openai-compatible-chat-1",
      id: "multimodal-probe",
      caps: { contextWindow: 500000, vision: true },
    }]);
    mocks.getProviderConnections.mockResolvedValue([{
      provider: "openai-compatible-chat-1",
      providerSpecificData: { prefix: "private" },
    }]);
    const caps = { contextWindow: 300000, vision: true };
    const response = await POST(new Request("https://router.test/api/combos", {
      method: "POST",
      body: JSON.stringify({ name: "custom", models: ["private/multimodal-probe"], caps }),
    }));

    expect(response.status).toBe(201);
    expect(mocks.createCombo).toHaveBeenCalledWith(expect.objectContaining({ caps }));
  });

  it.each([null, false, 0, "", { model: "cx/gpt-5.6-sol" }])(
    "rejects malformed fallback model lists: %j",
    async (models) => {
      const response = await POST(new Request("https://router.test/api/combos", {
        method: "POST",
        body: JSON.stringify({ name: "bad-models", models }),
      }));

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "Models must be an array of non-empty strings" });
      expect(mocks.createCombo).not.toHaveBeenCalled();
    },
  );
});
