import { describe, expect, it, vi } from "vitest";

import { openaiToOpenAIResponsesRequest } from "../../open-sse/translator/request/openai-responses.js";
import { handleNonStreamingResponse, translateNonStreamingResponse } from "../../open-sse/handlers/chatCore/nonStreamingHandler.js";
import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
}));

// A chat-format client talking to a Responses-wire provider (azure apiType:"responses",
// openai-compatible-responses nodes) used to get `content: ""` back: the request
// translator forced stream:true, so the JSON path parsed an SSE body with a parser
// that only understands chat.completion chunks.
describe("openai ↔ openai-responses non-streaming round trip", () => {
  // Trimmed from a live Azure gpt-6-luna /openai/v1/responses answer.
  const azureBody = {
    id: "resp_0765d547ab5f3599006ab60dc6f39c81968e8048c6a81ac96b",
    object: "response",
    created_at: 1790315974,
    status: "completed",
    incomplete_details: null,
    model: "gpt-6-luna",
    output: [
      {
        id: "msg_0765d547ab5f3599006ab60dc7b48481968ffe31c813726d23",
        type: "message",
        status: "completed",
        role: "assistant",
        phase: "final_answer",
        content: [{ type: "output_text", annotations: [], logprobs: [], text: "OK" }],
      },
    ],
    usage: {
      input_tokens: 2823,
      output_tokens: 5,
      input_tokens_details: { cache_write_tokens: 0, cached_tokens: 12 },
      output_tokens_details: { reasoning_tokens: 0 },
    },
  };

  async function emitNonStreamingChat(responseBody) {
    const result = await handleNonStreamingResponse({
      providerResponse: new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
      provider: "azure",
      model: "gpt-6-luna",
      sourceFormat: "openai",
      targetFormat: "openai-responses",
      body: { stream: false },
      stream: false,
      requestStartTime: Date.now(),
      reqLogger: { logProviderResponse() {}, logConvertedResponse() {} },
      trackDone() {},
      appendLog() {},
    });
    expect(result.success).toBe(true);
    return result.response.json();
  }

  describe("request", () => {
    it("honors a non-streaming caller", () => {
      const body = { messages: [{ role: "user", content: "hi" }], stream: false };
      expect(openaiToOpenAIResponsesRequest("gpt-6-luna", body, false).stream).toBe(false);
      expect(openaiToOpenAIResponsesRequest("gpt-6-luna", body, true).stream).toBe(true);
      // Undeclared stream keeps the streaming default.
      expect(openaiToOpenAIResponsesRequest("gpt-6-luna", body, undefined).stream).toBe(true);
    });

    it("honors it on the input[] passthrough branch too", () => {
      const body = { input: [{ role: "user", content: "hi" }] };
      expect(openaiToOpenAIResponsesRequest("gpt-6-luna", body, false).stream).toBe(false);
      expect(openaiToOpenAIResponsesRequest("gpt-6-luna", body, true).stream).toBe(true);
    });
  });

  describe("response", () => {
    it("folds output[] into choices[] for a chat client", () => {
      const out = translateNonStreamingResponse(azureBody, "openai-responses", "openai");
      expect(out.object).toBe("chat.completion");
      expect(out.id).toBe(azureBody.id);
      expect(out.model).toBe("gpt-6-luna");
      expect(out.choices[0].message).toEqual({ role: "assistant", content: "OK" });
      expect(out.choices[0].finish_reason).toBe("stop");
      expect(out.usage).toEqual({
        prompt_tokens: 2823,
        completion_tokens: 5,
        total_tokens: 2828,
        prompt_tokens_details: { cached_tokens: 12 },
      });
    });

    it("keeps the last non-empty message and carries reasoning summaries", () => {
      const out = translateNonStreamingResponse({
        ...azureBody,
        output: [
          { type: "message", content: [{ type: "output_text", text: "" }] },
          { type: "reasoning", summary: [{ type: "summary_text", text: "thought" }] },
          { type: "message", content: [{ type: "output_text", text: "final" }] },
        ],
      }, "openai-responses", "openai");
      expect(out.choices[0].message.content).toBe("final");
      expect(out.choices[0].message.reasoning_content).toBe("thought");
    });

    it("maps function_call and custom_tool_call to tool_calls", () => {
      const out = translateNonStreamingResponse({
        ...azureBody,
        output: [
          { type: "function_call", call_id: "call_1", name: "shell", arguments: "{\"command\":\"ls\"}" },
          { type: "custom_tool_call", call_id: "call_2", name: "patch", input: "*** Begin Patch" },
        ],
      }, "openai-responses", "openai");
      expect(out.choices[0].finish_reason).toBe("tool_calls");
      expect(out.choices[0].message.content).toBeNull();
      expect(out.choices[0].message.tool_calls).toEqual([
        { id: "call_1", type: "function", function: { name: "shell", arguments: "{\"command\":\"ls\"}" } },
        { id: "call_2", type: "function", function: { name: "patch", arguments: "*** Begin Patch" } },
      ]);
    });

    it("reports a truncated answer as finish_reason length", () => {
      const out = translateNonStreamingResponse({
        ...azureBody,
        status: "incomplete",
        incomplete_details: { reason: "max_output_tokens" },
      }, "openai-responses", "openai");
      expect(out.choices[0].finish_reason).toBe("length");
    });

    it.each([
      ["max_output_tokens", "length"],
      ["content_filter", "content_filter"],
    ])("does not expose an incomplete %s function call as executable", async (reason, finishReason) => {
      const out = await emitNonStreamingChat({
        ...azureBody,
        status: "incomplete",
        incomplete_details: { reason },
        output: [{
          type: "function_call",
          call_id: "call_partial",
          name: "shell",
          arguments: "{\"command\":\"rm",
        }],
      });
      expect(out.choices[0].finish_reason).toBe(finishReason);
      expect(out.choices[0].message.tool_calls).toBeUndefined();
    });

    it("treats an incomplete response without details as truncated", () => {
      const out = translateNonStreamingResponse({
        ...azureBody,
        status: "incomplete",
        incomplete_details: null,
      }, "openai-responses", "openai");
      expect(out.choices[0].finish_reason).toBe("length");
    });

    // The chat fold-in runs first so claude/gemini/ollama clients convert from one shape only.
    it("reaches a claude client through the chat-shaped branch", () => {
      const out = translateNonStreamingResponse(azureBody, "openai-responses", "claude");
      expect(out.type).toBe("message");
      expect(out.content).toEqual([{ type: "text", text: "OK" }]);
      expect(out.usage).toEqual({ input_tokens: 2823, output_tokens: 5 });
    });

    it("leaves an already chat-shaped body alone", () => {
      const chatBody = { object: "chat.completion", choices: [{ index: 0, message: { role: "assistant", content: "hi" } }] };
      expect(translateNonStreamingResponse(chatBody, "openai-responses", "openai")).toBe(chatBody);
    });
  });

  // The Responses wire rejects top-level reasoning_effort ("this parameter has moved to
  // reasoning.effort"), and caps.thinkingFormat is "openai" for these models — so the
  // declared format has to be upgraded to the wire that carries it.
  describe("thinking", () => {
    it("nests effort under reasoning on the responses wire", () => {
      const body = applyThinking("openai-responses", "gpt-6-luna", { reasoning_effort: "high" }, "azure");
      expect(body.reasoning).toEqual({ effort: "high" });
      expect(body.reasoning_effort).toBeUndefined();
    });

    it("preserves the client's reasoning.summary", () => {
      const body = applyThinking("openai-responses", "gpt-6-luna", { reasoning: { effort: "low", summary: "detailed" } }, "azure");
      expect(body.reasoning).toEqual({ effort: "low", summary: "detailed" });
    });

    it("still uses reasoning_effort on the chat wire", () => {
      const body = applyThinking("openai", "gpt-6-luna", { reasoning_effort: "high" }, "azure");
      expect(body.reasoning_effort).toBe("high");
      expect(body.reasoning).toBeUndefined();
    });
  });
});
