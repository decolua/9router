// A refusal from the Anthropic API (stop_reason "refusal", zero output tokens, no
// content blocks) must reach an OpenAI-format client as finish_reason
// "content_filter" carrying Anthropic's explanation — not as a clean, empty "stop".
// Captured live on 2026-09-20 against claude-opus-5 via a Claude Code OAuth
// connection: 9Router logged "Model succeeded · OUT 0" and the client saw nothing.
import { describe, it, expect } from "vitest";
import { claudeToOpenAIResponse } from "../../open-sse/translator/response/claude-to-openai.js";

const EXPLANATION =
  "This request was blocked as it seems to violate Anthropic's Terms of Service restrictions on reverse engineering or duplicating model outputs.";

function runStream(events) {
  const state = {};
  const out = [];
  for (const ev of events) {
    const r = claudeToOpenAIResponse(ev, state);
    if (Array.isArray(r)) out.push(...r);
    else if (r) out.push(r);
  }
  return { state, out };
}

const refusalStream = [
  {
    type: "message_start",
    message: {
      id: "msg_refusal", model: "claude-opus-5", role: "assistant", content: [],
      usage: { input_tokens: 637, cache_creation_input_tokens: 206779, cache_read_input_tokens: 0, output_tokens: 0 }
    }
  },
  {
    type: "message_delta",
    delta: {
      stop_reason: "refusal",
      stop_sequence: null,
      stop_details: { type: "refusal", category: "reasoning_extraction", explanation: EXPLANATION }
    },
    usage: { input_tokens: 637, cache_creation_input_tokens: 206779, cache_read_input_tokens: 0, output_tokens: 0 }
  },
  { type: "message_stop" }
];

describe("claude-to-openai: refusal stop_reason", () => {
  it("finishes with content_filter, not stop", () => {
    const { out } = runStream(refusalStream);
    const finishes = out.map(c => c.choices?.[0]?.finish_reason).filter(Boolean);
    expect(finishes).toEqual(["content_filter"]);
  });

  it("surfaces Anthropic's explanation as message content", () => {
    const { out } = runStream(refusalStream);
    const text = out.map(c => c.choices?.[0]?.delta?.content || "").join("");
    expect(text).toBe(EXPLANATION);
  });

  it("keeps usage on the final chunk (prompt tokens were billed)", () => {
    const { out } = runStream(refusalStream);
    const final = out.find(c => c.choices?.[0]?.finish_reason === "content_filter");
    expect(final.usage.prompt_tokens).toBe(637 + 206779);
    expect(final.usage.completion_tokens).toBe(0);
  });

  it("leaves a normal end_turn untouched", () => {
    const { out } = runStream([
      { type: "message_start", message: { id: "m", model: "claude-opus-5", role: "assistant", content: [], usage: { input_tokens: 5, output_tokens: 0 } } },
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "ok" } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null, stop_details: null }, usage: { output_tokens: 1 } },
      { type: "message_stop" }
    ]);
    const finishes = out.map(c => c.choices?.[0]?.finish_reason).filter(Boolean);
    expect(finishes).toEqual(["stop"]);
    expect(out.map(c => c.choices?.[0]?.delta?.content || "").join("")).toBe("ok");
  });
});
