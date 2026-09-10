import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(async () => {}),
  trackPendingRequest: vi.fn(),
}));

const { pipeWithDisconnect } = await import("../../open-sse/utils/streamHandler.js");

const encoder = new TextEncoder();

function passthroughTransform() {
  return new TransformStream({
    transform(chunk, controller) { controller.enqueue(chunk); },
  });
}

function controller() {
  let connected = true;
  const ctl = {
    signal: new AbortController().signal,
    startTime: Date.now(),
    isConnected: () => connected,
    handleComplete: vi.fn(() => { connected = false; }),
    handleError: vi.fn(() => { connected = false; }),
    handleDisconnect: vi.fn(() => { connected = false; }),
    abort: vi.fn(() => { connected = false; }),
  };
  return ctl;
}

afterEach(() => vi.useRealTimers());

describe("stream timeout phases", () => {
  it("uses first-chunk timeout before any upstream byte", async () => {
    vi.useFakeTimers();
    const ctl = controller();
    const upstream = new Response(new ReadableStream({ start() {} }));
    const output = pipeWithDisconnect(upstream, passthroughTransform(), ctl, null, {
      firstChunkTimeoutMs: 50,
      stallTimeoutMs: 500,
    });
    const reader = output.getReader();
    const pending = reader.read();

    await vi.advanceTimersByTimeAsync(60);
    await Promise.resolve();

    expect(ctl.handleError).toHaveBeenCalledWith(expect.objectContaining({
      message: "stream first chunk timeout",
    }));
    expect(ctl.abort).toHaveBeenCalledTimes(1);
    reader.cancel().catch(() => {});
    pending.catch(() => {});
  });

  it("clears first-chunk timeout after first byte and uses stall timeout", async () => {
    vi.useFakeTimers();
    const ctl = controller();
    let upstreamController;
    const upstream = new Response(new ReadableStream({
      start(controller) { upstreamController = controller; },
    }));
    const output = pipeWithDisconnect(upstream, passthroughTransform(), ctl, null, {
      firstChunkTimeoutMs: 50,
      stallTimeoutMs: 100,
    });
    const reader = output.getReader();
    const firstRead = reader.read();
    upstreamController.enqueue(encoder.encode("first"));
    await expect(firstRead).resolves.toEqual(expect.objectContaining({ done: false }));

    await vi.advanceTimersByTimeAsync(60);
    expect(ctl.handleError).not.toHaveBeenCalled();

    const pending = reader.read();
    await vi.advanceTimersByTimeAsync(50);
    await Promise.resolve();
    expect(ctl.handleError).toHaveBeenCalledWith(expect.objectContaining({
      message: "stream stall timeout",
    }));
    expect(ctl.abort).toHaveBeenCalledTimes(1);
    reader.cancel().catch(() => {});
    pending.catch(() => {});
  });
});
