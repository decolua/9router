// Test: inline <think>…</think> reasoning handling across all response translators.
// Bug context: Many OpenAI-compatible upstreams (R1 mirrors, GLM via third-party
// proxies, free pools) inline reasoning as <think>…</think> inside `content` instead
// of a separate `reasoning_content` field. Before the fix, openai-to-claude.js only
// read the separate field → reasoning leaked as ordinary text → Claude thinking blocks
// were empty/garbled → "the model gets dumber" (user's exact wording for Grok CLI).

import { describe, it, expect } from "vitest";
import { translateResponse, initState } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import "../../open-sse/translator/registerAll.js";

// Helper: run events through translateResponse, flatten results.
// Convention (tests/translator/AGENTS.md): response flows provider -> openai ->
// client, so translateResponse(providerFmt, clientFmt, chunk, state) and
// initState(clientFmt). `providerFmt` is the wire format of the chunks.
function runStream(providerFmt, clientFmt, events) {
  const state = initState(clientFmt);
  const out = [];
  for (const ev of events) {
    const res = translateResponse(providerFmt, clientFmt, ev, state);
    if (Array.isArray(res)) out.push(...res);
    else if (res) out.push(res);
  }
  return out;
}

describe("Inline <think> reasoning handling", () => {
  it("openai→claude: <think> inline becomes thinking block", () => {
    const events = [
      { id: "chatcmpl-1", model: "glm-3", choices: [{ index: 0, delta: { role: "assistant" } }] },
      { id: "chatcmpl-1", choices: [{ index: 0, delta: { content: "<think>Let me reason" } }] },
      { id: "chatcmpl-1", choices: [{ index: 0, delta: { content: " step by step</think>The answer is 42." } }] },
      { id: "chatcmpl-1", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
    ];
    const out = runStream(FORMATS.OPENAI, FORMATS.CLAUDE, events);

    // Should emit: message_start, thinking_block_start, thinking_delta × 2,
    // thinking_block_stop, text_block_start, text_delta, text_block_stop,
    // message_delta (stop), message_stop.
    const thinkingStart = out.find(e => e.type === "content_block_start" && e.content_block?.type === "thinking");
    expect(thinkingStart).toBeTruthy();
    const thinkingDeltas = out.filter(e => e.type === "content_block_delta" && e.delta?.type === "thinking_delta");
    const fullThinking = thinkingDeltas.map(d => d.delta.thinking).join("");
    expect(fullThinking).toBe("Let me reason step by step");

    const textDeltas = out.filter(e => e.type === "content_block_delta" && e.delta?.type === "text_delta");
    const fullText = textDeltas.map(d => d.delta.text).join("");
    expect(fullText).toBe("The answer is 42.");
  });

  it("openai→claude: <think> split across chunks (streaming-safe)", () => {
    const events = [
      { id: "chatcmpl-2", model: "r1", choices: [{ index: 0, delta: { role: "assistant" } }] },
      { id: "chatcmpl-2", choices: [{ index: 0, delta: { content: "Before<thi" } }] },
      { id: "chatcmpl-2", choices: [{ index: 0, delta: { content: "nk>inside</th" } }] },
      { id: "chatcmpl-2", choices: [{ index: 0, delta: { content: "ink>after" } }] },
      { id: "chatcmpl-2", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
    ];
    const out = runStream(FORMATS.OPENAI, FORMATS.CLAUDE, events);

    const thinkingDeltas = out.filter(e => e.delta?.type === "thinking_delta");
    const fullThinking = thinkingDeltas.map(d => d.delta.thinking).join("");
    expect(fullThinking).toBe("inside");

    const textDeltas = out.filter(e => e.delta?.type === "text_delta");
    const fullText = textDeltas.map(d => d.delta.text).join("");
    expect(fullText).toBe("Beforeafter");
  });

  it("openai→claude: reasoning_content + inline <think> coexist", () => {
    // Some providers send both shapes in one response (rare but valid).
    const events = [
      { id: "chatcmpl-3", model: "hybrid", choices: [{ index: 0, delta: { role: "assistant" } }] },
      { id: "chatcmpl-3", choices: [{ index: 0, delta: { reasoning_content: "Field reasoning. " } }] },
      { id: "chatcmpl-3", choices: [{ index: 0, delta: { content: "<think>Tag reasoning.</think>Final text." } }] },
      { id: "chatcmpl-3", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
    ];
    const out = runStream(FORMATS.OPENAI, FORMATS.CLAUDE, events);

    const thinkingDeltas = out.filter(e => e.delta?.type === "thinking_delta");
    const fullThinking = thinkingDeltas.map(d => d.delta.thinking).join("");
    // Both sources should land in the same thinking block.
    expect(fullThinking).toBe("Field reasoning. Tag reasoning.");

    const textDeltas = out.filter(e => e.delta?.type === "text_delta");
    const fullText = textDeltas.map(d => d.delta.text).join("");
    expect(fullText).toBe("Final text.");
  });

  it("claude→openai: thinking block becomes reasoning_content (not <think> tag)", () => {
    const events = [
      { type: "message_start", message: { id: "msg_1", model: "[REDACTED]", role: "assistant", content: [] } },
      { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "Claude reasons here" } },
      { type: "content_block_stop", index: 0 },
      { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "Claude's answer" } },
      { type: "content_block_stop", index: 1 },
      { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { input_tokens: 100, output_tokens: 50 } },
      { type: "message_stop" },
    ];
    const out = runStream(FORMATS.CLAUDE, FORMATS.OPENAI, events);

    // Should emit reasoning_content chunk (NOT <think> tag).
    const reasoningChunk = out.find(c => c.choices?.[0]?.delta?.reasoning_content);
    expect(reasoningChunk).toBeTruthy();
    expect(reasoningChunk.choices[0].delta.reasoning_content).toBe("Claude reasons here");

    // Should NOT contain <think> or </think> in content.
    const allContent = out
      .filter(c => c.choices?.[0]?.delta?.content)
      .map(c => c.choices[0].delta.content)
      .join("");
    expect(allContent).not.toContain("<think>");
    expect(allContent).not.toContain("</think>");
    expect(allContent).toBe("Claude's answer");
  });

  it("openai-responses→openai: response.reasoning_text.delta (Grok CLI full reasoning)", () => {
    // Bug 3: Grok CLI streams response.reasoning_text.delta (full reasoning),
    // NOT just reasoning_summary_text.delta. The old parser only handled summary
    // → full reasoning was dropped → "the model gets dumber."
    const events = [
      { event: "response.created", data: { type: "response.created", response: { id: "resp_grok", status: "in_progress" }, sequence_number: 1 } },
      { event: "response.output_item.added", data: { type: "response.output_item.added", output_index: 0, item: { type: "message", role: "assistant" }, sequence_number: 2 } },
      { event: "response.reasoning_text.delta", data: { type: "response.reasoning_text.delta", delta: "Step 1: analyze", sequence_number: 3 } },
      { event: "response.reasoning_text.delta", data: { type: "response.reasoning_text.delta", delta: " the problem.", sequence_number: 4 } },
      { event: "response.output_text.delta", data: { type: "response.output_text.delta", delta: "Grok's final answer.", sequence_number: 5 } },
      { event: "response.done", data: { type: "response.done", response: { id: "resp_grok", status: "completed" }, sequence_number: 6 } },
    ];
    const out = runStream(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI, events);

    // Should emit reasoning_content chunks for the full reasoning.
    const reasoningChunks = out.filter(c => c.choices?.[0]?.delta?.reasoning_content);
    expect(reasoningChunks.length).toBeGreaterThan(0);
    const fullReasoning = reasoningChunks.map(c => c.choices[0].delta.reasoning_content).join("");
    expect(fullReasoning).toBe("Step 1: analyze the problem.");

    // Content should be separate.
    const contentChunks = out.filter(c => c.choices?.[0]?.delta?.content);
    const fullContent = contentChunks.map(c => c.choices[0].delta.content).join("");
    expect(fullContent).toBe("Grok's final answer.");
  });
});
