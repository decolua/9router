import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
}));

import { initState, translateResponse } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { detectFormat } from "../../open-sse/services/provider.js";
import { handleStreamingResponse } from "../../open-sse/handlers/chatCore/streamingHandler.js";
import { createStreamController } from "../../open-sse/utils/streamHandler.js";

const clients = [FORMATS.GEMINI, FORMATS.GEMINI_CLI, FORMATS.VERTEX];
const chunk = (delta, finish_reason = null, usage) => ({
  id: "chatcmpl-fixture", object: "chat.completion.chunk", model: "gpt-test",
  choices: [{ index: 0, delta, finish_reason }], ...(usage ? { usage } : {}),
});

describe("Gemini-family response registration (#2398)", () => {
  it.each(clients)("projects text and reasoning for %s instead of leaking OpenAI chunks", (client) => {
    const output = translateResponse(FORMATS.OPENAI, client,
      chunk({ content: "Hello", reasoning_content: "Plan" }), initState(client));
    expect(output).toEqual([{ response: {
      candidates: [{ content: { role: "model", parts: [{ thought: true, text: "Plan" }, { text: "Hello" }] } }],
      modelVersion: "gpt-test", responseId: "chatcmpl-fixture",
    } }]);
  });

  it.each(clients)("joins tool argument fragments and retains terminal usage for %s", (client) => {
    const state = initState(client);
    expect(translateResponse(FORMATS.OPENAI, client, chunk({ tool_calls: [
      { index: 0, id: "call_read", type: "function", function: { name: "read", arguments: '{"path":' } },
    ] }), state)).toEqual([]);
    expect(translateResponse(FORMATS.OPENAI, client, chunk({ tool_calls: [
      { index: 0, function: { arguments: '"note.md"}' } },
    ] }), state)).toEqual([]);
    const output = translateResponse(FORMATS.OPENAI, client, chunk({}, "tool_calls", {
      prompt_tokens: 12, completion_tokens: 8, total_tokens: 20,
      prompt_tokens_details: { cached_tokens: 6 }, completion_tokens_details: { reasoning_tokens: 3 },
    }), state);
    expect(output[0].response.candidates).toEqual([{
      content: { role: "model", parts: [{ functionCall: { name: "read", args: { path: "note.md" } } }] },
      finishReason: "STOP",
    }]);
    expect(output[0].response.usageMetadata).toEqual({
      promptTokenCount: 12, candidatesTokenCount: 8, totalTokenCount: 20,
      thoughtsTokenCount: 3, cachedContentTokenCount: 6,
    });
  });

  it("projects a detected Gemini request through the real streaming response handler", async () => {
    const body = { contents: [{ role: "user", parts: [{ text: "Hi" }] }] };
    const sourceFormat = detectFormat(body);
    expect(sourceFormat).toBe(FORMATS.GEMINI);
    const upstream = [chunk({ content: "Hello" }), chunk({}, "stop")]
      .map(value => `data: ${JSON.stringify(value)}\n\n`).join("") + "data: [DONE]\n\n";
    const result = await handleStreamingResponse({
      providerResponse: new Response(upstream, { headers: { "content-type": "text/event-stream" } }),
      provider: "openai", model: "gpt-test", sourceFormat, targetFormat: FORMATS.OPENAI,
      body, stream: true, requestStartTime: Date.now(),
      streamController: createStreamController(),
    });
    expect(result.success).toBe(true);
    const wire = await result.response.text();
    const frames = wire.split("\n").filter(line => line.startsWith("data: {")).map(line => JSON.parse(line.slice(6)));
    expect(frames.some(frame => frame.choices)).toBe(false);
    expect(frames.flatMap(frame => frame.response?.candidates || []).map(candidate => candidate.content.parts).flat())
      .toContainEqual({ text: "Hello" });
    expect(frames.some(frame => frame.response?.candidates?.[0]?.finishReason === "STOP")).toBe(true);
  });

  it("keeps existing Antigravity projection", () => {
    const output = translateResponse(FORMATS.OPENAI, FORMATS.ANTIGRAVITY, chunk({ content: "Hello" }), initState(FORMATS.ANTIGRAVITY));
    expect(output[0].response.candidates[0].content.parts).toEqual([{ text: "Hello" }]);
  });

  it("keeps OpenAI clients in their native format", () => {
    const input = chunk({ content: "Hello" });
    expect(translateResponse(FORMATS.OPENAI, FORMATS.OPENAI, input, initState(FORMATS.OPENAI))).toEqual([input]);
  });
});
