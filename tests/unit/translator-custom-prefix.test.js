import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock getModelInfo to simulate custom provider prefix resolution
vi.mock("@/sse/services/model.js", () => ({
  getModelInfo: vi.fn(async (modelId) => {
    // Simulate prefix resolution for custom providers
    if (modelId.startsWith("my-prefix/")) {
      return {
        provider: "openai-compatible-chat-abc123",
        model: modelId.replace("my-prefix/", "")
      };
    }
    if (modelId.startsWith("acme/")) {
      return {
        provider: "anthropic-compatible-claude-xyz",
        model: modelId.replace("acme/", "")
      };
    }
    // Default: no prefix
    return {
      provider: modelId.split("/")[1] || "unknown",
      model: modelId.split("/")[1] || modelId
    };
  })
}));

describe("Translator custom provider prefix resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should resolve OpenAI-compatible provider prefix via getModelInfo", async () => {
    const { getModelInfo } = await import("@/sse/services/model.js");
    const result = await getModelInfo("my-prefix/gpt-4");

    expect(result.provider).toBe("openai-compatible-chat-abc123");
    expect(result.model).toBe("gpt-4");
  });

  it("should resolve Anthropic-compatible provider prefix via getModelInfo", async () => {
    const { getModelInfo } = await import("@/sse/services/model.js");
    const result = await getModelInfo("acme/claude-3");

    expect(result.provider).toBe("anthropic-compatible-claude-xyz");
    expect(result.model).toBe("claude-3");
  });

  it("should handle model ID without prefix", async () => {
    const { getModelInfo } = await import("@/sse/services/model.js");
    const result = await getModelInfo("openai/gpt-4");

    expect(result.provider).toBeDefined();
    expect(result.model).toBe("gpt-4");
  });
});
