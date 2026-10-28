import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startConsoleLogTransport } from "@/app/(dashboard)/dashboard/console-log/transport.js";

class FakeEventSource {
  static instances = [];

  constructor(url) {
    this.url = url;
    this.closed = false;
    FakeEventSource.instances.push(this);
  }

  close() {
    this.closed = true;
  }

  emit(data) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }

  fail() {
    return this.onerror?.(new Error("stream failed"));
  }
}

function snapshotResponse(logs, etag = 'W/"console-1"') {
  return new Response(JSON.stringify({ success: true, logs }), {
    status: 200,
    headers: { "Content-Type": "application/json", ETag: etag },
  });
}

describe("console log transport", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeEventSource.instances = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("loads REST first, then falls back to conditional polling when SSE is silent", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(snapshotResponse(["initial"]))
      .mockResolvedValueOnce(new Response(null, { status: 304 }));
    const onSnapshot = vi.fn();
    const transport = startConsoleLogTransport({
      fetchImpl,
      EventSourceImpl: FakeEventSource,
      onSnapshot,
      onEvent: vi.fn(),
      pollIntervalMs: 1000,
      streamTimeoutMs: 5000,
    });

    await transport.ready;
    expect(onSnapshot).toHaveBeenCalledWith(["initial"]);
    expect(FakeEventSource.instances).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(5000);
    await transport.ready;

    expect(FakeEventSource.instances[0].closed).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[1][1].headers).toEqual({
      "If-None-Match": 'W/"console-1"',
    });
    expect(onSnapshot).toHaveBeenCalledTimes(1);
    transport.stop();
  });

  it("keeps SSE when an init event arrives before watchdog", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(snapshotResponse([]));
    const onEvent = vi.fn();
    const transport = startConsoleLogTransport({
      fetchImpl,
      EventSourceImpl: FakeEventSource,
      onSnapshot: vi.fn(),
      onEvent,
      streamTimeoutMs: 5000,
    });

    await transport.ready;
    FakeEventSource.instances[0].emit({ type: "init", logs: [] });
    await vi.advanceTimersByTimeAsync(5000);

    expect(onEvent).toHaveBeenCalledWith({ type: "init", logs: [] });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(FakeEventSource.instances[0].closed).toBe(false);
    transport.stop();
  });

  it("switches to polling immediately on stream error", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(snapshotResponse(["initial"]))
      .mockResolvedValueOnce(snapshotResponse(["next"], 'W/"console-2"'));
    const onSnapshot = vi.fn();
    const transport = startConsoleLogTransport({
      fetchImpl,
      EventSourceImpl: FakeEventSource,
      onSnapshot,
      onEvent: vi.fn(),
    });

    await transport.ready;
    await FakeEventSource.instances[0].fail();

    expect(onSnapshot).toHaveBeenNthCalledWith(1, ["initial"]);
    expect(onSnapshot).toHaveBeenNthCalledWith(2, ["next"]);
    expect(FakeEventSource.instances[0].closed).toBe(true);
    transport.stop();
  });
});
