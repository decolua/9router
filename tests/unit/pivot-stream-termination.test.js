// Regression: the pivot route (non-OpenAI provider -> Claude client, e.g.
// Antigravity/Gemini) must synthesize a terminal on upstream truncation.
//
// The first audit added a null-flush contract to openaiToClaudeResponse, but it
// only fired on the DIRECT route. On a pivot, the intermediate (gemini->openai)
// translator returns null for the flush chunk, so the second-hop loop had an
// empty `results` and never invoked openaiToClaudeResponse(null) — the Claude
// stream ended with content blocks and no message_stop.
import { describe, expect, it } from "vitest";
import { initState, translateResponse } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const feed = (state, chunk) =>
  translateResponse(FORMATS.ANTIGRAVITY, FORMATS.CLAUDE, chunk, state);

describe("pivot route stream termination", () => {
  it("synthesizes message_stop when an Antigravity stream truncates", () => {
    const state = initState(FORMATS.CLAUDE);
    const out = [];
    // A normal content chunk from the Gemini-family provider.
    for (const r of feed(state, { candidates: [{ content: { parts: [{ text: "hi" }] } }] })) out.push(r);
    // Upstream disconnects: pivot flush with null.
    for (const r of feed(state, null)) out.push(r);

    const types = out.map((r) => r?.type);
    expect(types).toContain("message_start");
    expect(types).toContain("message_delta");
    expect(types).toContain("message_stop");
  });
});
