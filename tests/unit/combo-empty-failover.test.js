// empty-content failover for combo streaming responses.
import { describe, it, expect, vi } from "vitest";
import {
  deltaHasClientContent,
  inspectSSELine,
  scanSSEBuffer,
  isNoRetryFinish,
  peekStreamForContent,
  reconstructStream,
} from "../../open-sse/services/emptyFailover.js";
import { NO_RETRY_EMPTY_FINISH } from "../../open-sse/translator/schema/finishReasons.js";

const enc = new TextEncoder();
const dec = new TextDecoder();

// Build a ReadableStream of encoded SSE frames. `delays[i]` (ms) optionally staggers frame i.
function sseStream(frames, delays = []) {
  let i = 0;
  return new ReadableStream({
    async pull(controller) {
      if (i >= frames.length) { controller.close(); return; }
      const d = delays[i] || 0;
      if (d) await new Promise((r) => setTimeout(r, d));
      controller.enqueue(enc.encode(frames[i]));
      i++;
    },
  });
}

const ROLE = `data: {"id":"x","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}\n\n`;
const EMPTY_STOP = `data: {"id":"x","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":30194,"completion_tokens":15}}\n\n`;
const CONTENT = `data: {"id":"x","choices":[{"index":0,"delta":{"content":"OK"},"finish_reason":null}]}\n\n`;
const DONE = `data: [DONE]\n\n`;
const FILTER_STOP = `data: {"id":"x","choices":[{"index":0,"delta":{},"finish_reason":"content_filter"}]}\n\n`;
const REASONING = `data: {"id":"x","choices":[{"index":0,"delta":{"reasoning_content":"thinking..."},"finish_reason":null}]}\n\n`;

describe("deltaHasClientContent", () => {
  it("role-only delta is NOT content", () => expect(deltaHasClientContent({ role: "assistant" })).toBe(false));
  it("empty string content is NOT content", () => expect(deltaHasClientContent({ content: "" })).toBe(false));
  it("reasoning_content is NOT content", () => expect(deltaHasClientContent({ reasoning_content: "x" })).toBe(false));
  it("non-empty string content IS content", () => expect(deltaHasClientContent({ content: "hi" })).toBe(true));
  it("content array IS content", () => expect(deltaHasClientContent({ content: [{ type: "text", text: "a" }] })).toBe(true));
  it("tool_calls IS content", () => expect(deltaHasClientContent({ tool_calls: [{ id: "1" }] })).toBe(true));
  it("null/garbage is NOT content", () => { expect(deltaHasClientContent(null)).toBe(false); expect(deltaHasClientContent("x")).toBe(false); });
});

describe("inspectSSELine", () => {
  it("[DONE] carries nothing", () => expect(inspectSSELine("data: [DONE]")).toMatchObject({ content: false, finishReason: null }));
  it("role frame: no content, no finish", () => {
    const r = inspectSSELine(ROLE.trim());
    expect(r.content).toBe(false); expect(r.finishReason).toBe(null);
  });
  it("empty stop frame: no content, finish stop", () => {
    const r = inspectSSELine(EMPTY_STOP.trim());
    expect(r.content).toBe(false); expect(r.finishReason).toBe("stop");
  });
  it("content frame: content true", () => expect(inspectSSELine(CONTENT.trim()).content).toBe(true));
  it("non-data lines are inert", () => {
    expect(inspectSSELine("event: ping").content).toBe(false);
    expect(inspectSSELine(": keep-alive").content).toBe(false);
  });
});

describe("scanSSEBuffer latches", () => {
  it("stays empty across role+stop", () => {
    const st = scanSSEBuffer(ROLE + EMPTY_STOP);
    expect(st.sawContent).toBe(false); expect(st.finishReason).toBe("stop");
  });
  it("latches content once seen", () => {
    const st = scanSSEBuffer(ROLE + CONTENT + EMPTY_STOP);
    expect(st.sawContent).toBe(true);
  });
});

describe("isNoRetryFinish", () => {
  it("content_filter → no retry", () => expect(isNoRetryFinish("content_filter")).toBe(true));
  it("stop → retry (false)", () => expect(isNoRetryFinish("stop")).toBe(false));
  it("null → false", () => expect(isNoRetryFinish(null)).toBe(false));
  it("schema set holds content_filter", () => expect(NO_RETRY_EMPTY_FINISH.has("content_filter")).toBe(true));
});

describe("peekStreamForContent", () => {
  it("MALFORMED-style empty stream → outcome empty, finish stop", async () => {
    const p = await peekStreamForContent(sseStream([ROLE, EMPTY_STOP, DONE]));
    expect(p.outcome).toBe("empty");
    expect(p.finishReason).toBe("stop");
  });

  it("content stream → outcome content", async () => {
    const p = await peekStreamForContent(sseStream([ROLE, CONTENT, EMPTY_STOP, DONE]));
    expect(p.outcome).toBe("content");
  });

  it("reasoning-only then abort → still empty (reasoning is not content)", async () => {
    const p = await peekStreamForContent(sseStream([ROLE, REASONING, EMPTY_STOP, DONE]));
    expect(p.outcome).toBe("empty");
  });

  it("content-filter empty → empty with content_filter reason (caller won't retry)", async () => {
    const p = await peekStreamForContent(sseStream([ROLE, FILTER_STOP, DONE]));
    expect(p.outcome).toBe("empty");
    expect(isNoRetryFinish(p.finishReason)).toBe(true);
  });

  it("deadline fail-open: slow first content → committed as content", async () => {
    // content frame delayed 200ms, deadline 30ms → must commit (not falsely fall through)
    const p = await peekStreamForContent(sseStream([ROLE, CONTENT, DONE], [0, 200]), { deadlineMs: 30 });
    expect(p.outcome).toBe("content");
    expect(p.timedOut).toBe(true);
  });

  // Regression for C1: the deadline must NOT drop the in-flight chunk. Reconstruct + drain and
  // assert the delayed content actually reaches the client (previously it was silently lost).
  it("deadline hand-off preserves the delayed content frame end-to-end", async () => {
    const frames = [ROLE, CONTENT, EMPTY_STOP, DONE];
    const p = await peekStreamForContent(sseStream(frames, [0, 200]), { deadlineMs: 30 });
    expect(p.outcome).toBe("content");
    expect(p.timedOut).toBe(true);
    const rebuilt = reconstructStream(p.head, p.reader, p.pendingRead);
    const rd = rebuilt.getReader(); let out = "";
    while (true) { const { done, value } = await rd.read(); if (done) break; out += dec.decode(value); }
    expect(out).toBe(frames.join(""));           // no loss, no reorder
    expect(out).toContain('"content":"OK"');      // the slow frame survived
  });

  // Regression for M1: a zero/NaN deadline must NOT disable the timeout (no infinite hang).
  it("deadline=0 is clamped (does not hang on a normal stream)", async () => {
    const p = await peekStreamForContent(sseStream([ROLE, EMPTY_STOP, DONE]), { deadlineMs: 0 });
    expect(p.outcome).toBe("empty");
  });
  it("deadline=NaN is clamped", async () => {
    const p = await peekStreamForContent(sseStream([ROLE, CONTENT, DONE]), { deadlineMs: NaN });
    expect(p.outcome).toBe("content");
  });
});

describe("partial lines", () => {
  it("never parses an incomplete trailing line (no parse warnings at chunk boundaries)", () => {
    const warn = vi.spyOn(console, "log").mockImplementation(() => {});
    const half = CONTENT.slice(0, 30); // a data: line cut mid-JSON
    const st = scanSSEBuffer(ROLE + half);
    expect(st.sawContent).toBe(false);
    expect(st.pending).toBe(half);
    expect(warn).not.toHaveBeenCalled();
    scanSSEBuffer(st.pending + CONTENT.slice(30), st); // completed by the next chunk
    expect(st.sawContent).toBe(true);
    warn.mockRestore();
  });

  it("detects content on a final line that has no trailing newline", async () => {
    const p = await peekStreamForContent(sseStream([ROLE, CONTENT.trim()]));
    expect(p.outcome).toBe("content");
  });
});

describe("reconstructStream is byte-faithful", () => {
  async function drain(stream) {
    const rd = stream.getReader(); let out = "";
    while (true) { const { done, value } = await rd.read(); if (done) break; out += dec.decode(value); }
    return out;
  }

  it("content case replays head + remaining identically", async () => {
    const frames = [ROLE, CONTENT, EMPTY_STOP, DONE];
    const p = await peekStreamForContent(sseStream(frames));
    const rebuilt = reconstructStream(p.head, p.reader);
    expect(await drain(rebuilt)).toBe(frames.join(""));
  });

  it("empty case (fully buffered) replays identically", async () => {
    const frames = [ROLE, EMPTY_STOP, DONE];
    const p = await peekStreamForContent(sseStream(frames));
    const rebuilt = reconstructStream(p.head, p.reader);
    expect(await drain(rebuilt)).toBe(frames.join(""));
  });
});
