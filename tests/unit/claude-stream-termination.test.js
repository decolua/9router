// Regression: an upstream that disconnects (or simply stops) before sending a
// finish_reason must not leave the translated Claude stream unterminated.
//
// openaiToClaudeResponse emits its terminal pair only inside the finish_reason
// branch, and stream.js's flush delegates to the translator. Before this fix a
// truncated stream produced content blocks with no message_delta/message_stop,
// so Claude Code's agent loop blocked until timeout. The flush contract
// (null chunk -> synthesize a terminal) mirrors openaiResponsesToOpenAIResponse.
import { describe, expect, it } from "vitest";
import { initState, translateResponse } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const feed = (state, chunk) =>
  translateResponse(FORMATS.OPENAI, FORMATS.CLAUDE, chunk, state);

describe("translated Claude stream termination", () => {
  it("synthesizes message_delta + message_stop when the upstream truncates", () => {
    const state = initState(FORMATS.CLAUDE);
    const out = [];
    // Content arrives, but no finish_reason before the stream ends.
    for (const r of feed(state, { id: "c", model: "m", choices: [{ delta: { content: "hi" } }] })) out.push(r);
    // Upstream disconnects: flush with null.
    for (const r of feed(state, null)) out.push(r);

    const types = out.map((r) => r?.type);
    expect(types).toContain("message_delta");
    expect(types).toContain("message_stop");
    // The stop_reason is present and valid.
    const delta = out.find((r) => r?.type === "message_delta");
    expect(delta.delta.stop_reason).toBeTruthy();
  });

  it("does not emit a terminal on flush before any message started", () => {
    const state = initState(FORMATS.CLAUDE);
    const out = feed(state, null);
    expect(out ?? []).toEqual([]);
  });

  it("does not double-emit the terminal when a finish_reason already arrived", () => {
    const state = initState(FORMATS.CLAUDE);
    feed(state, { id: "c", model: "m", choices: [{ delta: { content: "hi" } }] });
    const finished = feed(state, { id: "c", model: "m", choices: [{ delta: {}, finish_reason: "stop" }] });
    expect(finished.filter((r) => r?.type === "message_stop")).toHaveLength(1);
    // A later flush must be a no-op (empty, not another terminal).
    const flushed = feed(state, null);
    expect(flushed ?? []).toEqual([]);
  });
});
