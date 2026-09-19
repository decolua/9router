// F27 / RM8 — the OpenAI SSE sentinel `data: [DONE]` must terminate every
// translated stream exactly once.
//
// Findings docs/orchestration/findings/T1.1.md §M8 (+ live re-read of stream.js):
//  * Translate mode NEVER emits the sentinel for non-Responses clients: the
//    upstream sentinel is swallowed at the `parsed.done` branch (which even
//    sets streamDoneSent=true without sending anything to the client), and
//    flush()'s emit is gated on keepsOpenAIResponsesFormat. No translator
//    response file emits done:true, so formatSSE never converts one.
//    → an OpenAI client on /v1/chat/completions backed by claude/gemini/kiro
//      gets an SSE stream that "simply ends" (per the passthrough comment in
//      stream.js: clients hang until timeout and trigger failover).
//  * Passthrough mode has the opposite bug: an upstream `data: [DONE]` is
//      forwarded, streamDoneSent is NOT set, and flush() appends a SECOND one.
//
// Fix contract: exactly one [DONE] at the terminal of every path (translated
// complete, translated truncated at EOF, flush-error), and never for clients
// whose format does not use the sentinel (claude/gemini family).

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
}));

const { createSSETransformStreamWithLogger, createPassthroughStreamWithLogger } = await import(
  "../../open-sse/utils/stream.js"
);
const { FORMATS } = await import("../../open-sse/translator/formats.js");

async function drain(stream) {
  const readable = stream.readable ?? stream;
  const reader = readable.getReader();
  const decoder = new TextDecoder();
  let out = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  return out + decoder.decode();
}

function feed(sseText, transform) {
  const input = new Blob([sseText]).stream();
  return drain(input.pipeThrough(transform));
}

const countDone = (text) => (text.match(/data:\s*\[DONE\]/g) || []).length;

const ev = (type, data) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
const claudeMessageStart = ev("message_start", { type: "message_start", message: { id: "msg_1", role: "assistant", model: "claude-x" } });
const claudeDelta = (text) =>
  ev("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } });
const claudeMessageStop = ev("message_stop", { type: "message_stop" });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("A — translate mode: OpenAI-format client always gets exactly one [DONE]", () => {
  it("claude provider → OpenAI client, normal completion: [DONE] present once, at the end", async () => {
    const upstream =
      ev("message_start", { type: "message_start", message: { id: "msg_1", role: "assistant", model: "claude-x" } }) +
      ev("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }) +
      claudeDelta("Hel") +
      claudeDelta("lo") +
      ev("content_block_stop", { type: "content_block_stop", index: 0 }) +
      ev("message_delta", { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 5 } }) +
      claudeMessageStop;

    const out = await feed(
      upstream,
      createSSETransformStreamWithLogger(FORMATS.CLAUDE, FORMATS.OPENAI, "claude", null, null, "claude-x", "c1")
    );

    // RED: today the translated stream simply ends — zero sentinels.
    expect(countDone(out)).toBe(1);
    expect(out.trimEnd().endsWith("data: [DONE]")).toBe(true);
    // content made it through (split deltas — check the first fragment)
    expect(out).toContain("Hel");
  });

  it("truncated translated stream (upstream EOF without message_stop): [DONE] still terminates it", async () => {
    // The socket closed cleanly after some deltas — no terminal event upstream.
    const upstream = claudeMessageStart + claudeDelta("partial ");

    const out = await feed(
      upstream,
      createSSETransformStreamWithLogger(FORMATS.CLAUDE, FORMATS.OPENAI, "claude", null, null, "claude-x", "c1")
    );

    expect(countDone(out)).toBe(1); // RED: 0 — client hangs on EOF
  });

  it("upstream also sent a raw sentinel after the terminal: latch keeps exactly one [DONE] out", async () => {
    // `data: [DONE]` is a framing marker any upstream may tack on; the swallow
    // branch must not both (a) leak zero sentinels to an OpenAI client and
    // (b) later double-send via flush.
    const upstream = claudeMessageStart + claudeDelta("x") + claudeMessageStop + "data: [DONE]\n\n";

    const out = await feed(
      upstream,
      createSSETransformStreamWithLogger(FORMATS.CLAUDE, FORMATS.OPENAI, "claude", null, null, "claude-x", "c1")
    );
    expect(countDone(out)).toBe(1);
  });
});

describe("B — passthrough mode: exactly one [DONE] even when upstream sent one", () => {
  it("upstream [DONE] is forwarded and flush does NOT append a second one", async () => {
    const upstream =
      'data: {"choices":[{"index":0,"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n\n';
    const out = await feed(
      upstream,
      createPassthroughStreamWithLogger("openai", null, "gpt-4o", "c1")
    );
    // RED: today BOTH the forwarded sentinel and flush's synthetic one appear → 2.
    expect(countDone(out)).toBe(1);
  });

  it("upstream WITHOUT a sentinel: flush appends exactly one", async () => {
    const upstream = 'data: {"choices":[{"index":0,"delta":{"content":"hi"},"finish_reason":"stop"}]}\n\n';
    const out = await feed(
      upstream,
      createPassthroughStreamWithLogger("openai", null, "gpt-4o", "c1")
    );
    expect(countDone(out)).toBe(1); // already true — pin against regressions
  });
});

describe("C — clients that do not use the sentinel must not receive one", () => {
  it("openai provider → Claude client: upstream [DONE] stays swallowed, no [DONE] emitted", async () => {
    const upstream =
      'data: {"choices":[{"index":0,"delta":{"content":"hi"}}]}\n\n' +
      'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n' +
      "data: [DONE]\n\n";
    const out = await feed(
      upstream,
      createSSETransformStreamWithLogger(FORMATS.OPENAI, FORMATS.CLAUDE, "openai", null, null, "gpt-4o", "c1")
    );
    expect(countDone(out)).toBe(0);
    expect(out).toContain("message_stop"); // claude terminal came from the translator
  });

  it("gemini-family passthrough keeps rejecting the sentinel", async () => {
    const upstream = 'data: {"candidates":[{"content":{"parts":[{"text":"hi"}]}}]}\n\n';
    const out = await feed(upstream, createPassthroughStreamWithLogger("antigravity", null, "gemini-x", "c1"));
    expect(countDone(out)).toBe(0); // existing isGeminiFamily gate — pin it
  });
});
