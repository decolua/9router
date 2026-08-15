import { describe, expect, it } from "vitest";
import { PROVIDER_MODELS, getModelSupportedFormats } from "../../open-sse/config/providerModels.js";
import { PROVIDERS } from "../../open-sse/config/providers.js";
import { resolveTransport } from "../../open-sse/services/provider.js";

// Chat-only models (no /messages, no /responses support on opencode-go)
const CHAT_ONLY = ["glm-5.2", "glm-5.1", "kimi-k2.7-code", "kimi-k2.6", "mimo-v2.5", "mimo-v2.5-pro"];
// Models that also expose the Anthropic /messages endpoint
const CLAUDE_CAPABLE = ["minimax-m3", "minimax-m2.7", "minimax-m2.5", "qwen3.7-max", "qwen3.7-plus", "qwen3.6-plus"];
// DeepSeek endpoints verified live; duplicate-name normalization is handled in #3333.
const DEEPSEEK_CAPABLE = ["deepseek-v4-pro", "deepseek-v4-flash"];

// Mirror of chatCore's per-model transport guard: use the sourceFormat-matched
// transport only when the model declares support for that sourceFormat.
function pickTransport(provider, sourceFormat, alias, model) {
  const supported = getModelSupportedFormats(alias, model);
  const rt = resolveTransport(provider, sourceFormat);
  return supported?.includes(sourceFormat) ? rt : null;
}

describe("OpenCode Go model catalog", () => {
  it("matches the documented model IDs", () => {
    const ids = (PROVIDER_MODELS["opencode-go"] || []).map((m) => m.id);
    expect(ids).toEqual([
      "glm-5.2", "glm-5.1", "kimi-k2.7-code", "kimi-k2.6",
      "deepseek-v4-pro", "deepseek-v4-flash",
      "mimo-v2.5", "mimo-v2.5-pro",
      "minimax-m3", "minimax-m2.7", "minimax-m2.5",
      "qwen3.7-max", "qwen3.7-plus", "qwen3.6-plus",
    ]);
  });
});

describe("OpenCode Go per-model supportedFormats", () => {
  it("declares [openai, claude] for MiniMax + Qwen models", () => {
    for (const m of CLAUDE_CAPABLE) {
      expect(getModelSupportedFormats("opencode-go", m)).toEqual(["openai", "claude"]);
    }
  });

  it("preserves all live-verified DeepSeek formats", () => {
    for (const m of DEEPSEEK_CAPABLE) {
      expect(getModelSupportedFormats("opencode-go", m)).toEqual(["openai", "claude", "openai-responses"]);
    }
  });

  it("declares [openai] only for chat-only models (GLM/Kimi/MiMo) → guards /messages routing", () => {
    for (const m of CHAT_ONLY) {
      expect(getModelSupportedFormats("opencode-go", m)).toEqual(["openai"]);
    }
  });
});

describe("OpenCode Go multi-endpoint transports", () => {
  it("declares openai / claude / openai-responses transports", () => {
    const formats = (PROVIDERS["opencode-go"].transports || []).map((t) => t.format);
    expect(formats).toEqual(["openai", "claude", "openai-responses"]);
  });

  it("resolveTransport picks the endpoint matching the client sourceFormat", () => {
    expect(resolveTransport("opencode-go", "claude").baseUrl).toBe("https://opencode.ai/zen/go/v1/messages");
    expect(resolveTransport("opencode-go", "openai-responses").baseUrl).toBe("https://opencode.ai/zen/go/v1/responses");
    expect(resolveTransport("opencode-go", "openai").baseUrl).toBe("https://opencode.ai/zen/go/v1/chat/completions");
  });

  it("uses x-api-key + anthropicVersion on the claude transport", () => {
    const t = resolveTransport("opencode-go", "claude");
    expect(t.auth.header).toBe("x-api-key");
    expect(t.auth.anthropicVersion).toBe(true);
  });
});

describe("OpenCode Go per-model transport guard (chatCore logic)", () => {
  it("routes MiniMax/Qwen + claude-format client to /messages", () => {
    for (const m of CLAUDE_CAPABLE) {
      expect(pickTransport("opencode-go", "claude", "opencode-go", m)?.baseUrl).toBe("https://opencode.ai/zen/go/v1/messages");
    }
  });

  it("does NOT route chat-only models to /messages on a claude-format request", () => {
    for (const m of CHAT_ONLY) {
      expect(pickTransport("opencode-go", "claude", "opencode-go", m)).toBeNull();
    }
  });

  it("routes DeepSeek to /responses for a responses-format request", () => {
    for (const m of DEEPSEEK_CAPABLE) {
      expect(pickTransport("opencode-go", "openai-responses", "opencode-go", m)?.baseUrl)
        .toBe("https://opencode.ai/zen/go/v1/responses");
    }
  });

  it("routes DeepSeek to /messages for a claude-format request", () => {
    for (const m of DEEPSEEK_CAPABLE) {
      expect(pickTransport("opencode-go", "claude", "opencode-go", m)?.baseUrl)
        .toBe("https://opencode.ai/zen/go/v1/messages");
    }
  });

  it("treats (max) suffix as the same model for metadata lookup", () => {
    expect(getModelSupportedFormats("opencode-go", "deepseek-v4-flash(max)"))
      .toEqual(["openai", "claude", "openai-responses"]);
    expect(getModelSupportedFormats("opencode-go", "glm-5.2(max)")).toEqual(["openai"]);
    expect(getModelSupportedFormats("opencode-go", "minimax-m3(max)")).toEqual(["openai", "claude"]);
  });

  it("routes DeepSeek(max), but not GLM(max), to /messages", () => {
    expect(pickTransport("opencode-go", "claude", "opencode-go", "deepseek-v4-flash(max)")?.baseUrl)
      .toBe("https://opencode.ai/zen/go/v1/messages");
    expect(pickTransport("opencode-go", "claude", "opencode-go", "glm-5.2(max)")).toBeNull();
  });

  it("does NOT route MiniMax (no responses support) to /responses", () => {
    for (const m of CLAUDE_CAPABLE) {
      expect(pickTransport("opencode-go", "openai-responses", "opencode-go", m)).toBeNull();
    }
  });
});
