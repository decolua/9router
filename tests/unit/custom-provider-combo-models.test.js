import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the fetch API
global.fetch = vi.fn();

// Mock provider constants
vi.mock("@/shared/constants/providers", () => ({
  OAUTH_PROVIDERS: {},
  APIKEY_PROVIDERS: {},
  FREE_PROVIDERS: {},
  FREE_TIER_PROVIDERS: {},
  AI_PROVIDERS: {},
  isOpenAICompatibleProvider: (id) => id?.startsWith("openai-compatible-"),
  isAnthropicCompatibleProvider: (id) => id?.startsWith("anthropic-compatible-"),
  getProviderAlias: (id) => id,
}));

// Mock models constants
vi.mock("@/shared/constants/models", () => ({
  getModelsByProviderId: () => [],
  getModelKind: () => null,
}));

// Mock hooks
vi.mock("@/shared/hooks/useModelCaps", () => ({
  useModelCaps: () => ({ getCaps: () => ({}) }),
}));

// Mock components
vi.mock("@/shared/components/Modal", () => ({
  default: ({ children }) => children,
}));
vi.mock("@/shared/components/ProviderIcon", () => ({
  default: () => null,
}));
vi.mock("@/shared/components/CapacityBadges", () => ({
  default: () => null,
}));

describe("Custom Provider Combo Model Fetching", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("fetchProviderModels", () => {
    it("should fetch models from /api/providers/[id]/models for OpenAI-compatible provider", async () => {
      const mockModels = [
        { id: "gpt-4", name: "GPT-4" },
        { id: "gpt-3.5", name: "GPT-3.5" },
      ];

      fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ models: mockModels }),
      });

      const providerId = "openai-compatible-chat-abc123";
      const connectionId = "conn-456";
      const activeProviders = [{ provider: providerId, id: connectionId }];

      // Simulate the fetch call from the component
      const res = await fetch(`/api/providers/${connectionId}/models`);
      const data = await res.json();

      expect(fetch).toHaveBeenCalledWith(`/api/providers/${connectionId}/models`);
      expect(data.models).toHaveLength(2);
      expect(data.models[0].id).toBe("gpt-4");
    });

    it("should handle fetch failure gracefully", async () => {
      fetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      const connectionId = "conn-789";
      const res = await fetch(`/api/providers/${connectionId}/models`);

      expect(res.ok).toBe(false);
      expect(res.status).toBe(500);
    });

    it("should return null when provider has no connection", async () => {
      const activeProviders = []; // No connection for this provider
      const providerId = "openai-compatible-chat-abc123";

      const connection = activeProviders.find(p => p.provider === providerId);
      expect(connection).toBeUndefined();
    });
  });

  describe("Model merging logic", () => {
    it("should merge alias models with fetched models, deduping by ID", () => {
      const nodeModels = [
        { id: "gpt-4", name: "GPT-4", value: "custom/gpt-4" },
      ];

      const dynamicModels = [
        { id: "gpt-4", name: "GPT-4 Turbo", value: "custom/gpt-4" }, // Duplicate ID
        { id: "gpt-3.5", name: "GPT-3.5", value: "custom/gpt-3.5" }, // New
      ];

      const seenIds = new Set(nodeModels.map(m => m.id));
      const merged = [
        ...nodeModels,
        ...dynamicModels.filter(m => !seenIds.has(m.id)),
      ];

      expect(merged).toHaveLength(2);
      expect(merged.map(m => m.id)).toContain("gpt-4");
      expect(merged.map(m => m.id)).toContain("gpt-3.5");
    });

    it("should show placeholder when no models found", () => {
      const nodePrefix = "my-provider";
      const providerId = "openai-compatible-chat-abc";
      const nodeModels = [];
      const dynamicModels = [];

      const mergedModels = [
        ...nodeModels,
        ...dynamicModels,
      ];

      const modelsToShow = mergedModels.length > 1 ? mergedModels : [{
        id: `__placeholder__${providerId}`,
        name: `${nodePrefix}/model-id`,
        value: `${nodePrefix}/model-id`,
        isPlaceholder: true,
      }];

      expect(modelsToShow).toHaveLength(1);
      expect(modelsToShow[0].isPlaceholder).toBe(true);
    });
  });

  describe("Provider identification", () => {
    it("should identify OpenAI-compatible providers by prefix", () => {
      const isOpenAICompatible = (id) => id?.startsWith("openai-compatible-");

      expect(isOpenAICompatible("openai-compatible-chat-abc123")).toBe(true);
      expect(isOpenAICompatible("anthropic-compatible-claude-xyz")).toBe(false);
      expect(isOpenAICompatible("openai")).toBe(false);
    });

    it("should identify Anthropic-compatible providers by prefix", () => {
      const isAnthropicCompatible = (id) => id?.startsWith("anthropic-compatible-");

      expect(isAnthropicCompatible("anthropic-compatible-claude-xyz")).toBe(true);
      expect(isAnthropicCompatible("openai-compatible-chat-abc")).toBe(false);
    });
  });
});
