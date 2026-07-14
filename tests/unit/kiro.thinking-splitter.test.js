// Unit tests for the inline-thinking splitter used by KiroExecutor.
//
// Claude on Kiro emits its reasoning **inline** as `<thinking>…</thinking>`
// blocks inside `assistantResponseEvent.content` rather than as separate
// `reasoningContentEvent` frames. The splitter must:
//   1. Route text inside `<thinking>` tags to the reasoning channel.
//   2. Route everything else to the content channel.
//   3. Survive tags split across SSE chunks (e.g. `…</think` + `ing>foo`).
//   4. Survive the stream ending mid-tag and not lose those trailing chars.
//   5. Be idempotent on tag-less input (regular non-thinking responses).

import { describe, it, expect } from "vitest";
import {
  splitInlineThinking,
  flushPendingThinking,
} from "../../open-sse/executors/kiroThinking.js";

/** Build a fresh state + recorders for each test. */
function makeHarness() {
  const state = { thinkingMode: false, pendingTag: "" };
  const content = [];
  const reasoning = [];
  const onContent = (s) => content.push(s);
  const onReasoning = (s) => reasoning.push(s);
  /** Feed one slice. */
  const feed = (raw) => splitInlineThinking(state, raw, onContent, onReasoning);
  /** Drain at end-of-stream. */
  const flush = () => flushPendingThinking(state, onContent, onReasoning);
  return {
    state,
    feed,
    flush,
    get content() { return content.join(""); },
    get reasoning() { return reasoning.join(""); },
  };
}

describe("splitInlineThinking", () => {
  it("passes through plain content with no tags", () => {
    const h = makeHarness();
    h.feed("Bonjour, this is just an answer.");
    h.flush();
    expect(h.content).toBe("Bonjour, this is just an answer.");
    expect(h.reasoning).toBe("");
    expect(h.state.thinkingMode).toBe(false);
    expect(h.state.pendingTag).toBe("");
  });

  it("splits a single-shot input with one full block", () => {
    const h = makeHarness();
    h.feed("Hello <thinking>secret thoughts</thinking> world");
    h.flush();
    expect(h.content).toBe("Hello  world");
    expect(h.reasoning).toBe("secret thoughts");
    expect(h.state.thinkingMode).toBe(false);
  });

  it("handles a tag split across two slices (open tag)", () => {
    // The opening `<thinking>` arrives across two reads.
    const h = makeHarness();
    h.feed("Hi <thi");
    expect(h.content).toBe("Hi "); // only the safe prefix is flushed
    expect(h.state.pendingTag).toBe("<thi");

    h.feed("nking>thoughts</thinking> bye");
    h.flush();
    expect(h.content).toBe("Hi  bye");
    expect(h.reasoning).toBe("thoughts");
    expect(h.state.pendingTag).toBe("");
  });

  it("handles a tag split across two slices (close tag)", () => {
    const h = makeHarness();
    h.feed("<thinking>step 1</thi");
    expect(h.reasoning).toBe("step 1");
    expect(h.state.thinkingMode).toBe(true);
    expect(h.state.pendingTag).toBe("</thi");

    h.feed("nking>final answer");
    h.flush();
    expect(h.content).toBe("final answer");
    expect(h.reasoning).toBe("step 1");
    expect(h.state.thinkingMode).toBe(false);
  });

  it("handles a tag split character-by-character", () => {
    const h = makeHarness();
    const stream = "before <thinking>hidden</thinking>after";
    for (const ch of stream) h.feed(ch);
    h.flush();
    expect(h.content).toBe("before after");
    expect(h.reasoning).toBe("hidden");
    expect(h.state.thinkingMode).toBe(false);
    expect(h.state.pendingTag).toBe("");
  });

  it("handles multiple thinking blocks in sequence", () => {
    const h = makeHarness();
    h.feed("<thinking>plan A</thinking>step1<thinking>plan B</thinking>step2");
    h.flush();
    expect(h.content).toBe("step1step2");
    expect(h.reasoning).toBe("plan Aplan B");
    expect(h.state.thinkingMode).toBe(false);
  });

  it("emits leftover content when the stream ends mid-tag", () => {
    // Stream truncated inside a partial open tag — must not silently drop.
    const h = makeHarness();
    h.feed("ok <thi");
    expect(h.state.pendingTag).toBe("<thi");
    h.flush();
    // We are not in thinking mode, so the leftover goes to content.
    expect(h.content).toBe("ok <thi");
    expect(h.reasoning).toBe("");
  });

  it("emits leftover reasoning when the stream ends mid-close-tag", () => {
    // We are inside <thinking> and the stream ends mid `</thi`.
    const h = makeHarness();
    h.feed("<thinking>partial</thi");
    expect(h.state.thinkingMode).toBe(true);
    expect(h.state.pendingTag).toBe("</thi");
    h.flush();
    // Leftover stays in the reasoning channel because we never saw the close.
    expect(h.reasoning).toBe("partial</thi");
    expect(h.content).toBe("");
  });

  it("does not consume tag-shaped content that isn't a real tag boundary", () => {
    // A `<` followed by something that doesn't match `<thinking>` should
    // eventually flow through as content.
    const h = makeHarness();
    h.feed("a<b>c</b>d");
    h.flush();
    expect(h.content).toBe("a<b>c</b>d");
    expect(h.reasoning).toBe("");
  });

  it("only holds back trailing characters that look like a partial OPEN tag (outside thinking mode)", () => {
    // Outside thinking mode the splitter only watches for `<thinking>`. A
    // partial `<think` at the end must be held; everything before it flushes.
    const h = makeHarness();
    h.feed("answer text <think");
    expect(h.content).toBe("answer text "); // safe prefix flushed eagerly
    expect(h.state.pendingTag).toBe("<think");

    h.feed("ing>secret</thinking>tail");
    h.flush();
    expect(h.content).toBe("answer text tail");
    expect(h.reasoning).toBe("secret");
  });

  it("does not hold back partial CLOSE tag while outside thinking mode", () => {
    // Outside thinking mode `</thinking>` is irrelevant — a stray `</think`
    // is just normal content and flushes immediately on the next slice.
    const h = makeHarness();
    h.feed("answer text </think");
    h.feed(" something else");
    h.flush();
    expect(h.content).toBe("answer text </think something else");
    expect(h.reasoning).toBe("");
  });

  it("survives empty / null slices", () => {
    const h = makeHarness();
    h.feed("");
    h.feed(undefined);
    h.feed(null);
    h.feed("hello");
    h.flush();
    expect(h.content).toBe("hello");
    expect(h.reasoning).toBe("");
  });

  it("flushPendingThinking is a no-op when nothing is pending", () => {
    const h = makeHarness();
    h.feed("just content");
    h.flush();
    h.flush();
    expect(h.content).toBe("just content");
    expect(h.reasoning).toBe("");
  });
});
