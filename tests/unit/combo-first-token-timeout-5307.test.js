// First-token timeout failover for combo streaming responses (#5307)
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  peekStreamForContent,
  EMPTY_PEEK_DEADLINE_MS,
} from "../../open-sse/services/emptyFailover.js";

vi.mock("@/lib/usageDb.js", () => ({
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
  appendRequestLog: vi.fn(async () => {}),
  trackPendingRequest: vi.fn(),
}));

const enc = new TextEncoder();

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
const CONTENT = `data: {"id":"x","choices":[{"index":0,"delta":{"content":"OK"},"finish_reason":null}]}\n\n`;
const EMPTY_STOP = `data: {"id":"x","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":30194,"completion_tokens":15}}\n\n`;
const DONE = `data: [DONE]\n\n`;

describe("peekStreamForContent — first-token timeout failover (#5307)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("timeout without content → outcome empty with timedOut=true (failover mode)", async () => {
    // Content arrives at 200ms, deadline is 30ms → should time out
    // This is the FAILOVER behavior: return "empty" with timedOut=true so combo can fall through
    // (different from the current fail-open behavior which returns "content")
    const p = await peekStreamForContent(
      sseStream([ROLE, CONTENT, EMPTY_STOP, DONE], [0, 200]),
      { deadlineMs: 30, failover: true }
    );
    expect(p.outcome).toBe("empty");
    expect(p.timedOut).toBe(true);
    expect(p.finishReason).toBeNull();
  });

  it("content arrives before deadline → outcome content", async () => {
    const p = await peekStreamForContent(
      sseStream([ROLE, CONTENT, EMPTY_STOP, DONE], [0, 10]),
      { deadlineMs: 30, failover: true }
    );
    expect(p.outcome).toBe("content");
    expect(p.timedOut).toBe(false);
  });

  it("empty stream without content → outcome empty (not timed out)", async () => {
    const p = await peekStreamForContent(
      sseStream([ROLE, EMPTY_STOP, DONE]),
      { deadlineMs: 30, failover: true }
    );
    expect(p.outcome).toBe("empty");
    expect(p.timedOut).toBe(false);
    expect(p.finishReason).toBe("stop");
  });

  it("failover=false (legacy) → fail-open: timeout with content → outcome content", async () => {
    // Legacy behavior: fail-open, don't fall through
    const p = await peekStreamForContent(
      sseStream([ROLE, CONTENT, EMPTY_STOP, DONE], [0, 200]),
      { deadlineMs: 30, failover: false }
    );
    expect(p.outcome).toBe("content");
    expect(p.timedOut).toBe(true);
  });

  it("failover undefined (default) → fail-open for backward compat", async () => {
    const p = await peekStreamForContent(
      sseStream([ROLE, CONTENT, EMPTY_STOP, DONE], [0, 200]),
      { deadlineMs: 30 }
    );
    expect(p.outcome).toBe("content");
    expect(p.timedOut).toBe(true);
  });
});
