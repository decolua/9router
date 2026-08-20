import { describe, expect, it } from "vitest";
import { PROVIDER_MODELS, getModelSupportedFormats, getModelTargetFormat } from "../../open-sse/config/providerModels.js";
import { PROVIDERS } from "../../open-sse/config/providers.js";
import { resolveTransport } from "../../open-sse/services/provider.js";
import opencodeRegistry from "../../open-sse/providers/registry/opencode.js";

// Chat-only models (no /messages, no /responses support on opencode-go)
const CHAT_ONLY = [
  "glm-5.2", "glm-5.1", "kimi-k2.7-code", "kimi-k2.6",
  "mimo-v2.5", "mimo-v2.5-pro",
];
// Models that also expose the Anthropic /messages endpoint
const CLAUDE_CAPABLE = ["minimax-m3", "minimax-m2.7", "minimax-m2.5", "qwen3.7-max", "qwen3.7-plus", "qwen3.6-plus"];
// Official OpenCode Go docs expose DeepSeek only through /chat/completions.
const DEEPSEEK_CHAT_ONLY = ["deepseek-v4-pro", "deepseek-v4-flash"];

// Mirror of chatCore's per-model transport guard: use the sourceFormat-matched
// transport only when the model declares support for that sourceFormat.
// Undeclared models (null) keep the transport — same as chatCore.js.
function pickTransport(provider, sourceFormat, alias, model) {
  const supported = getModelSupportedFormats(alias, model);
  const rt = resolveTransport(provider, sourceFormat);
  return (!supported || supported.includes(sourceFormat)) ? rt : null;
}

describe("OpenCode Go model catalog", () => {
  it("matches the documented model IDs", () => {
    const ids = (PROVIDER_MODELS["opencode-go"] || []).map((m) => m.id);
    expect(ids).toEqual([
      "grok-4.5", "gpt-5.6-luna", "glm-5.3", "glm-5.2", "glm-5.1",
      "kimi-k3", "kimi-k2.7-code", "kimi-k2.6",
      "deepseek-v4-pro", "deepseek-v4-flash",
      "mimo-v2.5", "mimo-v2.5-pro",
      "minimax-m3", "minimax-m2.7", "minimax-m2.5",
      "muse-spark-1.2-contributor",
      "qwen3.8-max", "qwen3.7-max", "qwen3.7-plus", "qwen3.6-plus",
      "hy3",
    ]);
  });
});

describe("OpenCode Go per-model supportedFormats", () => {
  it("declares Muse Spark 1.2 Contributor as Responses-only", () => {
    const ids = (PROVIDER_MODELS["opencode-go"] || []).map((m) => m.id);
    expect(ids).toContain("muse-spark-1.2-contributor");
    expect(ids).not.toContain("muse-spark-1.2");
    expect(getModelSupportedFormats("opencode-go", "muse-spark-1.2-contributor")).toEqual(["openai-responses"]);
    expect(getModelTargetFormat("opencode-go", "muse-spark-1.2-contributor")).toBe("openai-responses");
  });

  it("declares [openai, claude] for MiniMax + Qwen models", () => {
    for (const m of CLAUDE_CAPABLE) {
      expect(getModelSupportedFormats("opencode-go", m)).toEqual(["openai", "claude"]);
    }
  });

  it("declares [openai] only for chat-only models (GLM/Kimi/MiMo)", () => {
    for (const m of CHAT_ONLY) {
      expect(getModelSupportedFormats("opencode-go", m)).toEqual(["openai"]);
    }
  });

  it("declares [openai] only for DeepSeek until other endpoints are officially supported", () => {
    for (const m of DEEPSEEK_CHAT_ONLY) {
      expect(getModelSupportedFormats("opencode-go", m)).toEqual(["openai"]);
    }
  });

  it("treats thinking suffix (max) as the same model for metadata lookup", () => {
    expect(getModelSupportedFormats("opencode-go", "deepseek-v4-flash(max)")).toEqual(["openai"]);
    expect(getModelSupportedFormats("opencode-go", "glm-5.2(max)")).toEqual(["openai"]);
    expect(getModelSupportedFormats("opencode-go", "minimax-m3(max)")).toEqual(["openai", "claude"]);
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

  it("does NOT route DeepSeek to /messages or /responses", () => {
    for (const m of DEEPSEEK_CHAT_ONLY) {
      expect(pickTransport("opencode-go", "claude", "opencode-go", m)).toBeNull();
      expect(pickTransport("opencode-go", "openai-responses", "opencode-go", m)).toBeNull();
    }
  });

  it("does NOT route DeepSeek(max) to /messages or /responses", () => {
    expect(pickTransport("opencode-go", "claude", "opencode-go", "deepseek-v4-flash(max)")).toBeNull();
    expect(pickTransport("opencode-go", "openai-responses", "opencode-go", "deepseek-v4-flash(max)")).toBeNull();
  });

  it("does NOT route GLM(max) to /messages on a claude-format request", () => {
    expect(pickTransport("opencode-go", "claude", "opencode-go", "glm-5.2(max)")).toBeNull();
  });

  it("still routes MiniMax(max) + claude-format client to /messages", () => {
    expect(pickTransport("opencode-go", "claude", "opencode-go", "minimax-m3(max)")?.baseUrl)
      .toBe("https://opencode.ai/zen/go/v1/messages");
  });

  it("does NOT route GLM/Kimi/MiniMax to /responses", () => {
    for (const m of [...CHAT_ONLY, ...CLAUDE_CAPABLE]) {
      expect(pickTransport("opencode-go", "openai-responses", "opencode-go", m)).toBeNull();
    }
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
    // single Responses transport; openai/claude formats resolve to no transport
    expect(PROVIDERS.opencode.transports).toEqual([{ format: "openai-responses", baseUrl: "https://opencode.ai/zen/v1/responses" }]);
    expect(resolveTransport("opencode", "openai-responses")?.baseUrl).toBe("https://opencode.ai/zen/v1/responses");
    expect(resolveTransport("opencode", "openai")).toBeNull();
    expect(resolveTransport("opencode", "claude")).toBeNull();
  });
});
