import { describe, expect, it } from "vitest";
import { PROVIDER_MODELS, getModelSupportedFormats } from "../../open-sse/config/providerModels.js";
import { PROVIDERS } from "../../open-sse/config/providers.js";
import { resolveTransport } from "../../open-sse/services/provider.js";

// Chat-only models (no /messages, no /responses support on opencode-zen)
const CHAT_ONLY = ["deepseek-v4-pro", "deepseek-v4-flash", "deepseek-v4-flash-vision-exp",
  "glm-5.3-flash", "glm-5.3", "glm-5.2", "glm-5.1", "glm-5",
  "minimax-m3", "minimax-m2.7", "minimax-m2.5",
  "kimi-k3", "kimi-k2.7-code", "kimi-k2.6", "kimi-k2.5",
  "big-pickle", "deepseek-v4-flash-free",
  "mimo-v2.6-flash-free", "mimo-v2.5-free", "ling-3.0-flash-fin-free", "nemotron-3-ultra-free", "nemotron-3.5-lightning-free"];
// Models that also expose the Anthropic /messages endpoint
const CLAUDE_CAPABLE = ["claude-fable-5", "claude-fable-5-1", "claude-opus-5",
  "claude-opus-4-8", "claude-opus-4-7", "claude-opus-4-6", "claude-opus-4-5",
  "claude-sonnet-5", "claude-sonnet-4-6", "claude-sonnet-4-5", "claude-sonnet-4",
  "claude-haiku-4-5", "qwen3.6-plus", "qwen3.5-plus", "union-alpha"];
// Models that also expose the OpenAI /responses endpoint
const RESPONSES_CAPABLE = ["gpt-6-astra",
  "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna",
  "gpt-5.5", "gpt-5.5-pro",
  "gpt-5.4", "gpt-5.4-pro", "gpt-5.4-mini", "gpt-5.4-nano",
  "gpt-5.3-codex-spark", "gpt-5.3-codex",
  "gpt-5.2", "gpt-5.2-codex",
  "gpt-5.1", "gpt-5.1-codex-max", "gpt-5.1-codex", "gpt-5.1-codex-mini",
  "gpt-5", "gpt-5-codex", "gpt-5-nano",
  "grok-build-0.1", "grok-4.6", "grok-4.5",
  "muse-spark-1.3", "muse-spark-1.2",
  "muse-spark-1.3-contributor-free", "muse-spark-1.2-contributor-free"];

// Mirror of chatCore's per-model transport guard: use the sourceFormat-matched
// transport only when the model declares support for that sourceFormat.
function pickTransport(provider, sourceFormat, alias, model) {
  const supported = getModelSupportedFormats(alias, model);
  const rt = resolveTransport(provider, sourceFormat);
  return supported?.includes(sourceFormat) ? rt : null;
}

describe("OpenCode Zen model catalog", () => {
  it("matches the documented model IDs", () => {
    const ids = (PROVIDER_MODELS["ocz"] || []).map((m) => m.id);
    expect(ids).toContain("muse-spark-1.3-contributor-free");
    expect(ids).toContain("gpt-5.5");
    expect(ids).toContain("claude-opus-5");
    expect(ids).toContain("kimi-k3");
    expect(ids).toContain("deepseek-v4-pro");
    expect(ids.length).toBeGreaterThan(60);
  });
});

describe("OpenCode Zen per-model supportedFormats", () => {
  it("declares [claude] for Claude + Qwen + union-alpha models", () => {
    for (const m of CLAUDE_CAPABLE) {
      expect(getModelSupportedFormats("ocz", m)).toEqual(["claude"]);
    }
  });

  it("declares [openai-responses] for GPT/Grok/Spark responses models", () => {
    for (const m of RESPONSES_CAPABLE) {
      expect(getModelSupportedFormats("ocz", m)).toEqual(["openai-responses"]);
    }
  });

  it("declares [openai] only for chat-only models (GLM/Kimi/MiMo) → guards /messages routing", () => {
    for (const m of CHAT_ONLY) {
      expect(getModelSupportedFormats("ocz", m)).toEqual(["openai"]);
    }
  });
});

describe("OpenCode Zen multi-endpoint transports", () => {
  it("declares openai / claude / openai-responses transports", () => {
    const formats = (PROVIDERS["opencode-zen"].transports || []).map((t) => t.format);
    expect(formats).toEqual(["openai", "claude", "openai-responses"]);
  });

  it("resolveTransport picks the endpoint matching the client sourceFormat", () => {
    expect(resolveTransport("opencode-zen", "claude").baseUrl).toBe("https://opencode.ai/zen/v1/messages");
    expect(resolveTransport("opencode-zen", "openai-responses").baseUrl).toBe("https://opencode.ai/zen/v1/responses");
    expect(resolveTransport("opencode-zen", "openai").baseUrl).toBe("https://opencode.ai/zen/v1/chat/completions");
  });

  it("uses x-api-key + anthropicVersion on the claude transport", () => {
    const t = resolveTransport("opencode-zen", "claude");
    expect(t.auth.header).toBe("x-api-key");
    expect(t.auth.anthropicVersion).toBe(true);
  });
});

describe("OpenCode Zen per-model transport guard (chatCore logic)", () => {
  it("routes MiniMax/Qwen + claude-format client to /messages", () => {
    for (const m of CLAUDE_CAPABLE) {
      expect(pickTransport("opencode-zen", "claude", "ocz", m)?.baseUrl).toBe("https://opencode.ai/zen/v1/messages");
    }
  });

  it("does NOT route chat-only models to /messages on a claude-format request", () => {
    for (const m of CHAT_ONLY) {
      expect(pickTransport("opencode-zen", "claude", "ocz", m)).toBeNull();
    }
  });

  it("routes DeepSeek + responses-format client to /responses", () => {
    for (const m of RESPONSES_CAPABLE) {
      expect(pickTransport("opencode-zen", "openai-responses", "ocz", m)?.baseUrl).toBe("https://opencode.ai/zen/v1/responses");
    }
  });

  it("routes Muse Spark (responses-only) to /responses, never to /messages", () => {
    for (const m of ["muse-spark-1.2", "muse-spark-1.3", "muse-spark-1.2-contributor-free", "muse-spark-1.3-contributor-free", "grok-4.6", "gpt-5.6-luna"]) {
      expect(getModelSupportedFormats("ocz", m)).toEqual(["openai-responses"]);
      expect(pickTransport("opencode-zen", "openai-responses", "ocz", m)?.baseUrl).toBe("https://opencode.ai/zen/v1/responses");
      expect(pickTransport("opencode-zen", "claude", "ocz", m)).toBeNull();
      expect(pickTransport("opencode-zen", "openai", "ocz", m)).toBeNull();
    }
  });

  it("does NOT route MiniMax (no responses support) to /responses", () => {
    for (const m of CLAUDE_CAPABLE) {
      expect(pickTransport("opencode-zen", "openai-responses", "ocz", m)).toBeNull();
    }
  });
});
