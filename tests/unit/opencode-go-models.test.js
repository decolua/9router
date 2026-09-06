import { describe, expect, it } from "vitest";
import { PROVIDER_MODELS, getModelSupportedFormats, getModelTargetFormat, getModelUpstreamId } from "../../open-sse/config/providerModels.js";
import { PROVIDERS } from "../../open-sse/config/providers.js";
import { resolveTransport } from "../../open-sse/services/provider.js";
import opencodeRegistry from "../../open-sse/providers/registry/opencode.js";

// Chat-only models (no /messages, no /responses support on opencode-go)
const CHAT_ONLY = ["glm-5.2", "glm-5.1", "kimi-k2.7-code", "kimi-k2.6", "mimo-v2.5", "mimo-v2.5-pro"];
// Models that also expose the Anthropic /messages endpoint
const CLAUDE_CAPABLE = ["minimax-m3", "minimax-m2.7", "minimax-m2.5", "qwen3.7-max", "qwen3.7-plus", "qwen3.6-plus"];
// Models that also expose the OpenAI /responses endpoint
const RESPONSES_CAPABLE = ["deepseek-v4-pro", "deepseek-v4-flash"];

// Mirror of chatCore per-model guard
function pickTransport(provider, sourceFormat, alias, model) {
  const supported = getModelSupportedFormats(alias, model);
  const rt = resolveTransport(provider, sourceFormat);
  return supported?.includes(sourceFormat) ? rt : null;
}

describe("OpenCode Go model catalog", () => {
  it("matches the documented model IDs", () => {
    const ids = (PROVIDER_MODELS["opencode-go"] || []).map((m) => m.id);
    expect(ids).toEqual([
      "glm-5.3-flash", "glm-5.2", "glm-5.1", "kimi-k2.7-code", "kimi-k2.6",
      "deepseek-v4-pro", "deepseek-v4-flash", "deepseek-v4-flash-vision-exp",
      "mimo-v2.5", "mimo-v2.5-pro",
      "minimax-m3", "minimax-m2.7", "minimax-m2.5",
      "qwen3.7-max", "qwen3.7-plus", "qwen3.6-plus",
      "muse-spark-1.2-contributor", "muse-spark-1.3-contributor",
    ]);
  });
});

describe("OpenCode Go per-model supportedFormats", () => {
  it("declares Muse Spark 1.2 Contributor as Responses-only", () => {
    expect(getModelSupportedFormats("opencode-go", "muse-spark-1.2-contributor")).toEqual(["openai-responses"]);
    expect(getModelTargetFormat("opencode-go", "muse-spark-1.2-contributor")).toBe("openai-responses");
  });

  it("declares [openai, claude] for MiniMax + Qwen models", () => {
    for (const m of CLAUDE_CAPABLE) {
      expect(getModelSupportedFormats("opencode-go", m)).toEqual(["openai", "claude"]);
    }
  });

  it("declares [openai, claude, openai-responses] for DeepSeek models", () => {
    for (const m of RESPONSES_CAPABLE) {
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

  it("routes DeepSeek + responses-format client to /responses", () => {
    for (const m of RESPONSES_CAPABLE) {
      expect(pickTransport("opencode-go", "openai-responses", "opencode-go", m)?.baseUrl).toBe("https://opencode.ai/zen/go/v1/responses");
    }
  });

  it("routes Muse Spark (responses-only) to /responses, never to /messages", () => {
    for (const m of ["muse-spark-1.2-contributor", "muse-spark-1.3-contributor"]) {
      expect(getModelSupportedFormats("opencode-go", m)).toEqual(["openai-responses"]);
      expect(pickTransport("opencode-go", "openai-responses", "opencode-go", m)?.baseUrl).toBe("https://opencode.ai/zen/go/v1/responses");
      expect(pickTransport("opencode-go", "claude", "opencode-go", m)).toBeNull();
      expect(pickTransport("opencode-go", "openai", "opencode-go", m)).toBeNull();
    }
  });

  it("does NOT route MiniMax (no responses support) to /responses", () => {
    for (const m of CLAUDE_CAPABLE) {
      expect(pickTransport("opencode-go", "openai-responses", "opencode-go", m)).toBeNull();
    }
  });

  it("routes Muse Spark (Responses-only) + any responses client to /responses", () => {
    expect(pickTransport("opencode-go", "openai-responses", "opencode-go", "muse-spark-1.2-contributor")?.baseUrl).toBe("https://opencode.ai/zen/go/v1/responses");
  });

  it("does NOT route Muse Spark to /messages", () => {
    expect(pickTransport("opencode-go", "claude", "opencode-go", "muse-spark-1.2-contributor")).toBeNull();
  });
});

describe("OpenCode Go thinking-suffix metadata lookup (review: generic trailing (level) strip)", () => {
  it("resolves Responses-only metadata for muse-spark-1.2-contributor(max)", () => {
    expect(getModelSupportedFormats("opencode-go", "muse-spark-1.2-contributor(max)")).toEqual(["openai-responses"]);
    expect(getModelTargetFormat("opencode-go", "muse-spark-1.2-contributor(max)")).toBe("openai-responses");
  });

  it("resolves Responses-only metadata for muse-spark-1.2-contributor(high)", () => {
    expect(getModelSupportedFormats("opencode-go", "muse-spark-1.2-contributor(high)")).toEqual(["openai-responses"]);
    expect(getModelTargetFormat("opencode-go", "muse-spark-1.2-contributor(high)")).toBe("openai-responses");
  });

  it("keeps the suffix on the upstream id so applyThinking still sees it", () => {
    expect(getModelUpstreamId("opencode-go", "muse-spark-1.2-contributor(max)")).toBe("muse-spark-1.2-contributor(max)");
  });

  it("free variant suffix still resolves Responses-only metadata on oc alias", () => {
    expect(getModelSupportedFormats("oc", "muse-spark-1.2-contributor-free(max)")).toEqual(["openai-responses"]);
    expect(getModelTargetFormat("oc", "muse-spark-1.2-contributor-free(max)")).toBe("openai-responses");
    expect(getModelUpstreamId("oc", "muse-spark-1.2-contributor-free(high)")).toBe("muse-spark-1.2-contributor-free(high)");
  });

  it("keeps existing DeepSeek/GLM/MiniMax suffix behavior intact", () => {
    // DeepSeek: suffix resolves to the same supportedFormats as the base id
    expect(getModelSupportedFormats("opencode-go", "deepseek-v4-pro(medium)")).toEqual(["openai", "claude", "openai-responses"]);
    // Chat-only model with suffix still guarded to [openai]
    expect(getModelSupportedFormats("opencode-go", "glm-5.2(low)")).toEqual(["openai"]);
    // MiniMax with suffix keeps claude capability
    expect(getModelSupportedFormats("opencode-go", "minimax-m3(high)")).toEqual(["openai", "claude"]);
    // Upstream id preserves suffix for non-Muse models too
    expect(getModelUpstreamId("opencode-go", "glm-5.2(low)")).toBe("glm-5.2(low)");
  });
});

describe("OpenCode Free (oc) registry — Responses-only Muse Spark Free", () => {
  const FREE_ID = "muse-spark-1.2-contributor-free";

  it("declares the exact free model on the oc alias with openai-responses support", () => {
    const ids = (PROVIDER_MODELS.oc || []).map((m) => m.id);
    expect(ids).toEqual([FREE_ID]);
    expect(getModelSupportedFormats("oc", FREE_ID)).toEqual(["openai-responses"]);
    expect(getModelTargetFormat("oc", FREE_ID)).toBe("openai-responses");
  });

  it("keeps dynamic modelsFetcher + passthrough and only the Responses transport (no sibling)", () => {
    expect(opencodeRegistry.modelsFetcher?.type).toBe("opencode-free");
    expect(opencodeRegistry.passthroughModels).toBe(true);
    expect(PROVIDERS.opencode.transports).toEqual([{ format: "openai-responses", baseUrl: "https://opencode.ai/zen/v1/responses" }]);
    expect(resolveTransport("opencode", "openai-responses")?.baseUrl).toBe("https://opencode.ai/zen/v1/responses");
    expect(resolveTransport("opencode", "openai")).toBeNull();
    expect(resolveTransport("opencode", "claude")).toBeNull();
  });
});
