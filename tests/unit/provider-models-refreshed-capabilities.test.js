import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnectionById: vi.fn(),
  checkAndRefreshToken: vi.fn(),
  resolveKiroModels: vi.fn(),
  getCapabilitiesForModel: vi.fn(),
  getThinkingLevels: vi.fn(),
}));

vi.mock("@/models", () => ({ getProviderConnectionById: mocks.getProviderConnectionById }));
vi.mock("@/sse/services/tokenRefresh", () => ({
  checkAndRefreshToken: mocks.checkAndRefreshToken,
  refreshGoogleToken: vi.fn(),
  refreshCodexToken: vi.fn(),
  updateProviderCredentials: vi.fn(),
}));
vi.mock("open-sse/services/kiroModels.js", () => ({ resolveKiroModels: mocks.resolveKiroModels }));
vi.mock("open-sse/providers/capabilities.js", () => ({ getCapabilitiesForModel: mocks.getCapabilitiesForModel }));
vi.mock("open-sse/providers/thinkingLevels.js", () => ({ getThinkingLevels: mocks.getThinkingLevels }));

const { GET } = await import("@/app/api/providers/[id]/models/route.js");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.checkAndRefreshToken.mockResolvedValue({ apiKey: "refreshed-secret", accessToken: "refreshed-token" });
  mocks.getCapabilitiesForModel.mockReturnValue({ contextWindow: 200000, vision: true, reasoning: true });
  mocks.getThinkingLevels.mockReturnValue(["low", "high"]);
});

describe("provider models preserve token refresh and capability enrichment after merging", () => {
  it.each([
    ["openai-compatible-test", "Authorization", "Bearer refreshed-secret"],
    ["anthropic-compatible-test", "x-api-key", "refreshed-secret"],
    ["deepseek", "Authorization", "Bearer refreshed-token"],
    ["kiro", null, null],
  ])("enriches the %s response without exposing refreshed credentials", async (provider, authHeader, authValue) => {
    mocks.getProviderConnectionById.mockResolvedValue({
      id: "connection-1", provider, apiKey: "old-secret", accessToken: "old-token",
      providerSpecificData: { baseUrl: "https://models.example.test/v1" },
    });
    const model = { id: "test-model", name: "Test Model", contextLength: 64000, isVL: false };
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ data: [model] }));
    mocks.resolveKiroModels.mockResolvedValue({ models: [model] });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const response = await GET(new Request("http://localhost/api/providers/connection-1/models"), {
        params: Promise.resolve({ id: "connection-1" }),
      });
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.provider).toBe(provider);
      expect(body.connectionId).toBe("connection-1");
      expect(body.models[0]).toMatchObject({
        id: "test-model", contextLength: 64000, isReasoning: true, thinking_levels: ["low", "high"],
      });
      // Generic and compatible responses retain explicit upstream flags.
      // The Kiro adapter emits its own normalized shape before enrichment.
      expect(body.models[0].isVL).toBe(provider === "kiro");
      expect(mocks.getCapabilitiesForModel).toHaveBeenCalledWith(provider, "test-model");
      expect(JSON.stringify(body)).not.toMatch(/old-secret|old-token|refreshed-secret|refreshed-token/);
      if (authHeader) {
        expect(fetchMock.mock.calls[0][1].headers[authHeader]).toBe(authValue);
      } else {
        expect(mocks.resolveKiroModels.mock.calls[0][0].accessToken).toBe("refreshed-token");
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
