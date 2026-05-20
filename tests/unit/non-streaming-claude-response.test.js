import { describe, expect, it } from "vitest";
import { FORMATS } from "../../open-sse/translator/formats.js";
import {
  openAIChatCompletionToClaudeMessage,
  translateNonStreamingResponse,
} from "../../open-sse/handlers/chatCore/nonStreamingHandler.js";

describe("non-streaming Claude response formatting", () => {
  it("converts OpenAI chat completions to Anthropic Messages shape", () => {
    const result = openAIChatCompletionToClaudeMessage({
      id: "chatcmpl-test",
      model: "gemini-3.5-flash-low",
      choices: [{
        message: { role: "assistant", content: "ok" },
        finish_reason: "stop",
      }],
      usage: {
        prompt_tokens: 12,
        completion_tokens: 3,
        prompt_tokens_details: { cached_tokens: 2 },
      },
    });

    expect(result).toMatchObject({
      id: "msg_test",
      type: "message",
      role: "assistant",
      model: "gemini-3.5-flash-low",
      content: [{ type: "text", text: "ok" }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: {
        input_tokens: 10,
        output_tokens: 3,
        cache_read_input_tokens: 2,
      },
    });
    expect(result.object).toBeUndefined();
    expect(result.choices).toBeUndefined();
  });

  it("converts Antigravity non-streaming responses to Anthropic Messages shape for /v1/messages", () => {
    const result = translateNonStreamingResponse({
      response: {
        responseId: "ag-response",
        modelVersion: "gemini-3-flash-b",
        candidates: [{
          finishReason: "STOP",
          content: { parts: [{ text: "ok" }] },
        }],
        usageMetadata: {
          promptTokenCount: 5,
          candidatesTokenCount: 2,
          totalTokenCount: 7,
        },
      },
    }, FORMATS.ANTIGRAVITY, FORMATS.CLAUDE);

    expect(result).toMatchObject({
      id: "msg_ag-response",
      type: "message",
      role: "assistant",
      model: "gemini-3-flash-b",
      content: [{ type: "text", text: "ok" }],
      stop_reason: "end_turn",
      usage: {
        input_tokens: 5,
        output_tokens: 2,
      },
    });
    expect(result.object).toBeUndefined();
    expect(result.choices).toBeUndefined();
  });
});
