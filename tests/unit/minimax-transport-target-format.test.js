/**
 * MiniMax (and other multi-transport providers) expose both OpenAI and Anthropic
 * endpoints. When the client already speaks OpenAI, we must not let per-model
 * targetFormat: "claude" override the matched transport — that sends Anthropic-shaped
 * tools to /v1/chat/completions and triggers MiniMax error 2013.
 */
import { describe, expect, it } from "vitest";
import { getModelTargetFormat } from "../../open-sse/config/providerModels.js";
import { detectFormat, getTargetFormat, resolveTransport } from "../../open-sse/services/provider.js";

function resolveTargetFormat(provider, model, body) {
  const sourceFormat = detectFormat(body);
  const modelTargetFormat = getModelTargetFormat(provider, model);
  const runtimeTransport = resolveTransport(provider, sourceFormat);
  return {
    sourceFormat,
    modelTargetFormat,
    runtimeTransportFormat: runtimeTransport?.format ?? null,
    targetFormat: runtimeTransport?.format || modelTargetFormat || getTargetFormat(provider),
  };
}

describe("multi-transport targetFormat resolution", () => {
  it("prefers matched OpenAI transport over MiniMax-M3 targetFormat: claude", () => {
    const body = {
      messages: [{ role: "user", content: "hi" }],
      tools: [{ type: "function", function: { name: "read", parameters: { type: "object", properties: {} } } }],
    };
    const out = resolveTargetFormat("minimax", "MiniMax-M3", body);
    expect(out.sourceFormat).toBe("openai");
    expect(out.modelTargetFormat).toBe("claude");
    expect(out.runtimeTransportFormat).toBe("openai");
    expect(out.targetFormat).toBe("openai");
  });

  it("uses Claude transport for Claude-shaped client requests", () => {
    const body = {
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      system: [{ type: "text", text: "sys" }],
      max_tokens: 1024,
    };
    const out = resolveTargetFormat("minimax", "MiniMax-M3", body);
    expect(out.sourceFormat).toBe("claude");
    expect(out.runtimeTransportFormat).toBe("claude");
    expect(out.targetFormat).toBe("claude");
  });
});
