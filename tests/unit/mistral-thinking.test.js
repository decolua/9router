import { describe, it, expect } from "vitest";
import { createPassthroughStreamWithLogger, createSSETransformStreamWithLogger } from "../../open-sse/utils/stream.js";
import { parseSSEToOpenAIResponse } from "../../open-sse/handlers/chatCore/sseToJsonHandler.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { translateNonStreamingResponse, handleNonStreamingResponse } from "../../open-sse/handlers/chatCore/nonStreamingHandler.js";
import { normalizeMistralContent } from "../../open-sse/translator/concerns/reasoning.js";
import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import "../translator/registerAll.js";

const delta = { content: [{ type: "thinking", thinking: [{ type: "text", text: "think" }], closed: true }, { type: "text", text: "answer" }] };
const chunk = { id: "chatcmpl-12345678", object: "chat.completion.chunk", model: "deepseek", choices: [{ index: 0, delta, finish_reason: null }] };
const end = { ...chunk, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] };
const sse = [chunk, end].map(c => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n";
async function render(transform, data = sse) {
  const input = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(data)); c.close(); } });
  return await new Response(input.pipeThrough(transform)).text();
}

describe("Mistral reasoning response", () => {
  it("strips unsupported reasoning history only for strict providers", () => {
    const model = "deepseek-v4-1-flash-1017";
    const messages = [{ role: "assistant", content: "hello" }, { role: "assistant", content: "answer", reasoning_content: "prior thought" }];
    const mistral = new DefaultExecutor("mistral").transformRequest(model, { model, messages: structuredClone(messages) });
    expect(mistral.messages).toEqual([{ role: "assistant", content: "hello" }, { role: "assistant", content: "answer" }]);
    const go = new DefaultExecutor("opencode-go").transformRequest(model, { model, messages: [messages[0]] });
    expect(go.messages[0].reasoning_content).toBe(" ");
  });
  it("sends reasoning effort without DeepSeek's unsupported thinking field", () => {
    const body = { reasoning_effort: "high" };
    applyThinking(FORMATS.OPENAI, "deepseek-v4-1-flash-1017", body, "mistral");
    expect(body).toEqual({ reasoning_effort: "high" });
  });
  it("streams thinking and text to Claude", async () => {
    const out = await render(createSSETransformStreamWithLogger(FORMATS.OPENAI, FORMATS.CLAUDE, "mistral"));
    expect(out).toContain('"thinking":"think"');
    expect(out).toContain('"text":"answer"');
  });
  it("streams reasoning_content and text to OpenAI clients", async () => {
    const out = await render(createPassthroughStreamWithLogger("mistral"));
    expect(out).toContain('"reasoning_content":"think"');
    expect(out).toContain('"content":"answer"');
  });
  it("normalizes a final SSE chunk without a newline", async () => {
    const tail = `data: ${JSON.stringify(chunk)}`;
    const openai = await render(createPassthroughStreamWithLogger("mistral"), tail);
    const claude = await render(createSSETransformStreamWithLogger(FORMATS.OPENAI, FORMATS.CLAUDE, "mistral"), tail);
    expect(openai).toContain('"reasoning_content":"think"');
    expect(claude).toContain('"thinking":"think"');
    expect(claude).toContain('"text":"answer"');
  });
  it("aggregates forced SSE with reasoning and text", () => {
    const result = parseSSEToOpenAIResponse(sse, "deepseek", "mistral");
    expect(result.choices[0].message).toMatchObject({ content: "answer", reasoning_content: "think" });
  });
  it("preserves reasoning alongside text in non-stream OpenAI responses", async () => {
    const providerResponse = new Response(JSON.stringify({ choices: [{ message: { role: "assistant", ...delta }, finish_reason: "stop" }] }), { headers: { "Content-Type": "application/json" } });
    const result = await handleNonStreamingResponse({ providerResponse, provider: "mistral", model: "deepseek", sourceFormat: FORMATS.OPENAI, targetFormat: FORMATS.OPENAI, body: {}, requestStartTime: Date.now(), reqLogger: { logProviderResponse() {}, logConvertedResponse() {} }, trackDone() {}, appendLog() {} });
    const out = await result.response.json();
    expect(out.choices[0].message).toMatchObject({ content: "answer", reasoning_content: "think" });
  });
  it("translates normalized non-stream messages to Claude", () => {
    const message = normalizeMistralContent({ role: "assistant", ...delta });
    const result = translateNonStreamingResponse({ model: "deepseek", choices: [{ message, finish_reason: "stop" }] }, FORMATS.OPENAI, FORMATS.CLAUDE);
    expect(result.content).toEqual(expect.arrayContaining([expect.objectContaining({ type: "thinking", thinking: "think" }), expect.objectContaining({ type: "text", text: "answer" })]));
  });
});
