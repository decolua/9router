/**
 * Anthropic reports thinking tokens as usage.output_tokens_details.thinking_tokens on
 * message_delta. For Copilot's 4.7+ Claude shims — which return a signed but EMPTY
 * thinking block — that count is the only signal that reasoning happened at all, so it
 * has to survive all the way to the client.
 *
 * It nearly didn't: claude-to-openai writes its own usage object into the shared stream
 * state, and stream.js filters that object with OpenAI field names before emitting it.
 * output_tokens_details is a Claude name, so the count was dropped on the way out.
 */
import { describe, it, expect } from "vitest";
import "../translator/registerAll.js";
import { createSSETransformStreamWithLogger } from "../../open-sse/utils/stream.js";
import { filterUsageForFormat } from "../../open-sse/utils/usageTracking.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const EVENTS = [
  { type: "message_start", message: { id: "msg_1", model: "claude-sonnet-4.6", usage: { input_tokens: 22, output_tokens: 1 } } },
  { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } },
  { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "reasoning…" } },
  { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "Esig" } },
  { type: "content_block_stop", index: 0 },
  { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } },
  { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "answer" } },
  { type: "content_block_stop", index: 1 },
  { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { input_tokens: 22, output_tokens: 267, output_tokens_details: { thinking_tokens: 85 } } },
  { type: "message_stop" },
];

async function runStream(events) {
  const sse = events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
  const ts = createSSETransformStreamWithLogger(
    FORMATS.CLAUDE, FORMATS.OPENAI, "github", null, null, "claude-sonnet-4.6", null, { messages: [] });
  const rs = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(sse)); c.close(); } });
  const reader = rs.pipeThrough(ts).getReader();
  const parts = [];
  for (;;) { const { done, value } = await reader.read(); if (done) break; parts.push(new TextDecoder().decode(value)); }
  return parts.join("").split("\n")
    .filter((l) => l.startsWith("data:"))
    .map((l) => l.slice(5).trim())
    .filter((p) => p && p !== "[DONE]")
    .map((p) => JSON.parse(p));
}

describe("claude -> openai streaming exposes thinking tokens", () => {
  it("puts the count in the client-facing usage", async () => {
    const chunks = await runStream(EVENTS);
    const usage = chunks.filter((c) => c.usage).at(-1)?.usage;
    expect(usage).toBeDefined();
    expect(usage.reasoning_tokens).toBe(85);
    expect(usage.completion_tokens_details?.reasoning_tokens).toBe(85);
  });

  it("still streams the thinking text as reasoning_content", async () => {
    const chunks = await runStream(EVENTS);
    const reasoning = chunks.map((c) => c.choices?.[0]?.delta?.reasoning_content || "").join("");
    expect(reasoning).toBe("reasoning…");
  });

  // The 4.7+ Copilot case: signed thinking block, no text — the count is all we get.
  it("reports the count even when upstream withholds the thinking text", async () => {
    const withheld = EVENTS.map((e) =>
      e.type === "content_block_delta" && e.delta?.type === "thinking_delta"
        ? { ...e, delta: { ...e.delta, thinking: "" } }
        : e);
    const chunks = await runStream(withheld);
    const reasoning = chunks.map((c) => c.choices?.[0]?.delta?.reasoning_content || "").join("");
    expect(reasoning).toBe("");
    expect(chunks.filter((c) => c.usage).at(-1).usage.reasoning_tokens).toBe(85);
  });

  it("keeps output_tokens_details for Claude-format clients", () => {
    const out = filterUsageForFormat(
      { input_tokens: 22, output_tokens: 267, output_tokens_details: { thinking_tokens: 85 } },
      FORMATS.CLAUDE);
    expect(out.output_tokens_details).toEqual({ thinking_tokens: 85 });
  });
});
