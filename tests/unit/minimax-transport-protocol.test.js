import { describe, expect, it } from "vitest";

import { getModelTargetFormat } from "../../open-sse/config/providerModels.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { resolveRequestTransport } from "../../open-sse/services/provider.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

describe("MiniMax transport selection", () => {
  it("pairs MiniMax-M3's Claude body with the Anthropic transport", () => {
    const modelTarget = getModelTargetFormat("minimax", "MiniMax-M3");
    expect(modelTarget).toBe(FORMATS.CLAUDE);

    const { runtimeTransport, targetFormat } = resolveRequestTransport(
      "minimax",
      FORMATS.OPENAI,
      modelTarget,
    );

    expect(targetFormat).toBe(FORMATS.CLAUDE);
    expect(runtimeTransport).toMatchObject({
      format: FORMATS.CLAUDE,
      baseUrl: "https://api.minimax.io/anthropic/v1/messages",
    });
  });

  it("keeps MiniMax-M2.7 on the OpenAI transport for Chat Completions clients", () => {
    const { runtimeTransport, targetFormat } = resolveRequestTransport(
      "minimax",
      FORMATS.OPENAI,
      getModelTargetFormat("minimax", "MiniMax-M2.7"),
    );

    expect(targetFormat).toBe(FORMATS.OPENAI);
    expect(runtimeTransport?.format).toBe(FORMATS.OPENAI);
  });

  it("keeps Claude-native clients on the Anthropic transport", () => {
    const { runtimeTransport, targetFormat } = resolveRequestTransport(
      "minimax",
      FORMATS.CLAUDE,
      getModelTargetFormat("minimax", "MiniMax-M3"),
    );

    expect(targetFormat).toBe(FORMATS.CLAUDE);
    expect(runtimeTransport).toMatchObject({
      format: FORMATS.CLAUDE,
      baseUrl: "https://api.minimax.io/anthropic/v1/messages",
      urlSuffix: "?beta=true",
      auth: { header: "x-api-key", scheme: "raw" },
    });
  });

  it("uses the China Anthropic host for minimax-cn", () => {
    const { runtimeTransport, targetFormat } = resolveRequestTransport(
      "minimax-cn",
      FORMATS.CLAUDE,
      getModelTargetFormat("minimax-cn", "MiniMax-M3"),
    );

    expect(targetFormat).toBe(FORMATS.CLAUDE);
    expect(runtimeTransport).toMatchObject({
      baseUrl: "https://api.minimaxi.com/anthropic/v1/messages",
      auth: { header: "x-api-key", scheme: "raw" },
    });
  });
});

describe("MiniMax Anthropic multi-turn normalization", () => {
  it("does not inject OpenAI reasoning_content into the Anthropic transport", () => {
    const executor = new DefaultExecutor("minimax");
    const body = {
      model: "MiniMax-M3",
      messages: [
        { role: "user", content: [{ type: "text", text: "Inspect files" }] },
        {
          role: "assistant",
          content: [{ type: "tool_use", id: "call_probe", name: "list_dir", input: {} }],
        },
      ],
    };

    const result = executor.transformRequest("MiniMax-M3", structuredClone(body), true, {
      runtimeTransport: { format: FORMATS.CLAUDE },
    });
    expect(result.messages[1].reasoning_content).toBeUndefined();
  });

  it("keeps reasoning_content injection on MiniMax's OpenAI transport", () => {
    const executor = new DefaultExecutor("minimax");
    const body = {
      model: "MiniMax-M2.7",
      messages: [
        { role: "user", content: "Inspect files" },
        { role: "assistant", content: "", tool_calls: [{ id: "call_probe", type: "function", function: { name: "list_dir", arguments: "{}" } }] },
      ],
    };

    const result = executor.transformRequest("MiniMax-M2.7", structuredClone(body), true, {
      runtimeTransport: { format: FORMATS.OPENAI },
    });
    expect(result.messages[1].reasoning_content).toBe(" ");
  });
});
