import { describe, expect, it } from "vitest";
import { PROVIDER_MODELS, getModelTargetFormat, getModelTransportFormat } from "../../open-sse/config/providerModels.js";
import { PROVIDERS } from "../../open-sse/config/providers.js";
import { resolveTransport } from "../../open-sse/services/provider.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { openaiToOpenAIResponsesRequest } from "../../open-sse/translator/request/openai-responses.js";

const CHAT_MODELS = [
  "glm-5.3", "glm-5.2", "glm-5.1", "kimi-k3", "kimi-k2.7-code", "kimi-k2.6",
  "longcat-2.0", "deepseek-v4-pro", "deepseek-v4-flash",
  "mimo-v2.5", "mimo-v2.5-pro", "hy3",
];
const MESSAGES_MODELS = ["minimax-m3", "minimax-m2.7", "minimax-m2.5", "qwen3.8-max", "qwen3.7-max", "qwen3.7-plus", "qwen3.6-plus"];
const RESPONSES_MODELS = ["grok-4.5", "gpt-5.6-luna"];

function pickTransport(sourceFormat, model) {
  return resolveTransport("opencode-go", sourceFormat, getModelTransportFormat("opencode-go", model));
}

describe("OpenCode Go model catalog", () => {
  it("matches the documented model IDs", () => {
    const ids = (PROVIDER_MODELS["opencode-go"] || []).map((m) => m.id);
    expect(ids).toEqual([
      ...RESPONSES_MODELS, ...CHAT_MODELS, ...MESSAGES_MODELS,
    ]);
  });
});

describe("OpenCode Go per-model canonical endpoint", () => {
  it("keeps OpenAI Chat models on /chat/completions", () => {
    for (const m of CHAT_MODELS) {
      expect(getModelTargetFormat("opencode-go", m)).toBe("openai");
      expect(getModelTransportFormat("opencode-go", m)).toBe("openai");
    }
  });

  it("routes MiniMax and Qwen models to /messages", () => {
    for (const m of MESSAGES_MODELS) {
      expect(getModelTargetFormat("opencode-go", m)).toBe("claude");
      expect(getModelTransportFormat("opencode-go", m)).toBe("claude");
    }
  });

  it("routes Grok, GPT and Muse models to /responses", () => {
    for (const m of RESPONSES_MODELS) {
      expect(getModelTargetFormat("opencode-go", m)).toBe("openai-responses");
      expect(getModelTransportFormat("opencode-go", m)).toBe("openai-responses");
    }
  });
});

describe("OpenCode Go multi-endpoint transports", () => {
  it("declares openai / claude / openai-responses transports", () => {
    const formats = (PROVIDERS["opencode-go"].transports || []).map((t) => t.format);
    expect(formats).toEqual(["openai", "claude", "openai-responses"]);
  });

  it("resolveTransport exposes all official endpoints", () => {
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

describe("OpenCode Go per-model transport selection", () => {
  it("uses the model endpoint even for an OpenAI Chat client", () => {
    for (const m of MESSAGES_MODELS) {
      expect(pickTransport("openai", m)?.baseUrl).toBe("https://opencode.ai/zen/go/v1/messages");
    }
    for (const m of RESPONSES_MODELS) {
      expect(pickTransport("openai", m)?.baseUrl).toBe("https://opencode.ai/zen/go/v1/responses");
    }
    for (const m of CHAT_MODELS) {
      expect(pickTransport("claude", m)?.baseUrl).toBe("https://opencode.ai/zen/go/v1/chat/completions");
    }
  });

  it("maps Chat max_tokens to Responses max_output_tokens", () => {
    const request = openaiToOpenAIResponsesRequest("grok-4.5", {
      messages: [{ role: "user", content: "hi" }],
      max_tokens: 1024,
    });

    expect(request.max_output_tokens).toBe(1024);
    expect(request).not.toHaveProperty("max_tokens");
  });

  it("uses nested reasoning.effort after the full Claude to Responses translation", () => {
    const request = translateRequest(
      FORMATS.CLAUDE,
      FORMATS.OPENAI_RESPONSES,
      "gpt-5.6-luna",
      {
        model: "gpt-5.6-luna",
        messages: [{ role: "user", content: "hi" }],
        output_config: { effort: "xhigh" },
        stream: true,
      },
      true,
      null,
      "opencode-go",
    );

    expect(request.reasoning).toEqual({ effort: "xhigh", summary: "auto" });
    expect(request).not.toHaveProperty("reasoning_effort");
  });

  it("normalizes legacy reasoning_effort on Responses passthrough requests", () => {
    const request = translateRequest(
      FORMATS.OPENAI_RESPONSES,
      FORMATS.OPENAI_RESPONSES,
      "gpt-5.6-luna",
      {
        model: "gpt-5.6-luna",
        input: [{ role: "user", content: [{ type: "input_text", text: "hi" }] }],
        reasoning_effort: "high",
        stream: true,
      },
      true,
      null,
      "opencode-go",
    );

    expect(request.reasoning).toEqual({ effort: "high", summary: "auto" });
    expect(request).not.toHaveProperty("reasoning_effort");
  });
});
