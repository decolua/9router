// Thinking/answer boundaries across the OpenAI pivot.
//
// claude-to-openai used to mark a Claude thinking block with literal "<think>" /
// "</think>" chunks in delta.content while the thinking text itself went out in
// reasoning_content. The pair always arrived empty and adjacent, so OpenAI-format
// clients (opencode, DeepSeek Harness, ...) rendered a bare "<think></think>" above
// every answer (#3399, #4199).
//
// The Responses translators leaned on that "</think>" marker as their only signal
// to close the reasoning item before the answer. Dropping the marker therefore
// requires closing reasoning when the first message text or tool call arrives —
// which also fixes item ordering for every reasoning_content provider (DeepSeek,
// GLM, Qwen, Kimi), not just Claude.
import { describe, it, expect } from "vitest";
import { claudeToOpenAIResponse } from "../../open-sse/translator/response/claude-to-openai.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { createSSETransformStreamWithLogger } from "../../open-sse/utils/stream.js";
import { createResponsesApiTransformStream } from "../../open-sse/transformer/responsesTransformer.js";

const THINKING = "391 factors as 17 times 23, so it's not prime.";
const ANSWER = "No — 391 = 17 × 23.";

function claudeThinkingStream({ thinkingText = THINKING, answer = ANSWER } = {}) {
  const thinkingDeltas = thinkingText
    ? [{ type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: thinkingText } }]
    : [];
  return [
    { type: "message_start", message: { id: "msg_1", model: "claude-opus-5", role: "assistant", content: [], usage: { input_tokens: 10, output_tokens: 0 } } },
    { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "", signature: "" } },
    ...thinkingDeltas,
    { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "sig_abc" } },
    { type: "content_block_stop", index: 0 },
    { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: answer } },
    { type: "content_block_stop", index: 1 },
    { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 20 } },
    { type: "message_stop" },
  ];
}

function runClaudeToOpenAI(events) {
  const state = {};
  const out = [];
  for (const ev of events) {
    const r = claudeToOpenAIResponse(ev, state);
    if (Array.isArray(r)) out.push(...r);
    else if (r) out.push(r);
  }
  const deltas = out.map((c) => c.choices?.[0]?.delta || {});
  return {
    content: deltas.map((d) => d.content || "").join(""),
    reasoning: deltas.map((d) => d.reasoning_content || "").join(""),
    contentChunks: deltas.map((d) => d.content).filter((c) => c != null),
  };
}

async function drain(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    text += typeof value === "string" ? value : decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

function sseStream(chunks) {
  const encoder = new TextEncoder();
  const body = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n";
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(body));
      controller.close();
    },
  });
}

// Upstream speaks `upstream`, client speaks the Responses API.
async function viaResponsesTranslator(chunks, upstream, provider, model) {
  const out = sseStream(chunks).pipeThrough(
    createSSETransformStreamWithLogger(upstream, FORMATS.OPENAI_RESPONSES, provider, null, null, model),
  );
  return parseEvents(await drain(out));
}

async function viaResponsesTransformer(chunks) {
  return parseEvents(await drain(sseStream(chunks).pipeThrough(createResponsesApiTransformStream(null))));
}

function parseEvents(text) {
  return text
    .split("\n")
    .filter((l) => l.startsWith("data: ") && l.slice(6).trim() !== "[DONE]")
    .map((l) => {
      try { return JSON.parse(l.slice(6)); } catch { return null; }
    })
    .filter(Boolean);
}

// Index of the event announcing/finishing an output item of the given type.
function itemEventIndex(events, eventType, itemType) {
  return events.findIndex((e) => e.type === eventType && e.item?.type === itemType);
}

function expectReasoningClosedBefore(events, nextItemType) {
  const reasoningDone = itemEventIndex(events, "response.output_item.done", "reasoning");
  const nextAdded = itemEventIndex(events, "response.output_item.added", nextItemType);
  expect(reasoningDone).toBeGreaterThanOrEqual(0);
  expect(nextAdded).toBeGreaterThanOrEqual(0);
  expect(reasoningDone).toBeLessThan(nextAdded);
}

describe("claude-to-openai: thinking never leaks markers into content", () => {
  it("summarized thinking goes to reasoning_content, answer to content, no <think> text", () => {
    const { content, reasoning, contentChunks } = runClaudeToOpenAI(claudeThinkingStream());
    expect(reasoning).toBe(THINKING);
    expect(content).toBe(ANSWER);
    expect(contentChunks.some((c) => c.includes("<think>") || c.includes("</think>"))).toBe(false);
  });

  it("signature-only (redacted) thinking yields no stray markers", () => {
    const { content, reasoning } = runClaudeToOpenAI(claudeThinkingStream({ thinkingText: "" }));
    expect(reasoning).toBe("");
    expect(content).toBe(ANSWER);
  });
});

describe("Responses translator: reasoning closes before the answer", () => {
  it("Claude upstream: reasoning item is done before the message item opens", async () => {
    const events = await viaResponsesTranslator(claudeThinkingStream(), FORMATS.CLAUDE, "claude", "claude-opus-5");
    expectReasoningClosedBefore(events, "message");
    const summary = events.find((e) => e.type === "response.reasoning_summary_text.done");
    expect(summary?.text).toBe(THINKING);
  });

  it("reasoning_content upstream: reasoning item is done before the message item opens", async () => {
    const events = await viaResponsesTranslator([
      { id: "c1", choices: [{ index: 0, delta: { role: "assistant", reasoning_content: THINKING } }] },
      { id: "c1", choices: [{ index: 0, delta: { content: ANSWER } }] },
      { id: "c1", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
    ], FORMATS.OPENAI, "deepseek", "deepseek-flash");
    expectReasoningClosedBefore(events, "message");
  });

  it("reasoning_content upstream: reasoning item is done before a tool call opens", async () => {
    const events = await viaResponsesTranslator([
      { id: "c2", choices: [{ index: 0, delta: { role: "assistant", reasoning_content: THINKING } }] },
      { id: "c2", choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "lookup", arguments: "{}" } }] } }] },
      { id: "c2", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
    ], FORMATS.OPENAI, "deepseek", "deepseek-flash");
    expectReasoningClosedBefore(events, "function_call");
  });
});

describe("responsesTransformer (/v1/responses handler): reasoning closes before the answer", () => {
  it("reasoning item is done before the message item opens", async () => {
    const events = await viaResponsesTransformer([
      { id: "c3", choices: [{ index: 0, delta: { role: "assistant", reasoning_content: THINKING } }] },
      { id: "c3", choices: [{ index: 0, delta: { content: ANSWER } }] },
      { id: "c3", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
    ]);
    expectReasoningClosedBefore(events, "message");
  });

  it("reasoning item is done before a tool call opens", async () => {
    const events = await viaResponsesTransformer([
      { id: "c4", choices: [{ index: 0, delta: { role: "assistant", reasoning_content: THINKING } }] },
      { id: "c4", choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_2", type: "function", function: { name: "lookup", arguments: "{}" } }] } }] },
      { id: "c4", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
    ]);
    expectReasoningClosedBefore(events, "function_call");
  });
});
