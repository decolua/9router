// T1.5 B1 — GET /api/usage/stream: when the SSE socket dies via the keepalive
// enqueue (the path that never runs cancel()), the catch only sets
// state.closed + clearInterval. statsEmitter.off("update"/"pending") is NOT
// called, so every orphaned client leaves 2 listeners + a closure holding
// cachedStats on the process-wide emitter, forever.
//
// Seam: the route wires a ReadableStream source onto the global statsEmitter.
// We capture the stream source so start(controller) runs against a controller
// we can "break" (enqueue throws, like a closed socket), and count real
// listener registrations on a real EventEmitter before/after the keepalive
// failure — no cancel() involved.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/usageDb", async () => {
  const { EventEmitter } = await import("node:events");
  return {
    statsEmitter: new EventEmitter(),
    getUsageStats: vi.fn(async () => ({ totalRequests: 7, totalTokens: 100 })),
    getActiveRequests: vi.fn(async () => ({ activeRequests: [], recentRequests: [], errorProvider: null })),
  };
});

const usageDb = await import("@/lib/usageDb");
const { GET } = await import("@/app/api/usage/stream/route.js");

const OriginalReadableStream = globalThis.ReadableStream;
const OriginalResponse = globalThis.Response;

let source; // { start, cancel } captured from the route's ReadableStream
let broken; // when true, controller.enqueue throws (dead socket)

beforeEach(() => {
  broken = false;
  source = null;
  class CapturingReadableStream {
    constructor(src) { source = src; }
  }
  class FakeResponse {
    constructor(body, init) { this.body = body; this.init = init; }
  }
  globalThis.ReadableStream = CapturingReadableStream;
  globalThis.Response = FakeResponse;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  globalThis.ReadableStream = OriginalReadableStream;
  globalThis.Response = OriginalResponse;
});

function makeController() {
  return {
    enqueue() {
      if (broken) throw new TypeError("enqueue after close: socket gone");
    },
    close() {},
    error() {},
  };
}

async function openStream() {
  await GET();
  const controller = makeController();
  await source.start(controller);
  return controller;
}

describe("GET /api/usage/stream — keepalive failure must unregister statsEmitter listeners (B1)", () => {
  it("removes update+pending listeners when the keepalive enqueue throws (no cancel)", async () => {
    const before = {
      update: usageDb.statsEmitter.listenerCount("update"),
      pending: usageDb.statsEmitter.listenerCount("pending"),
    };
    await openStream();
    expect(usageDb.statsEmitter.listenerCount("update")).toBe(before.update + 1);
    expect(usageDb.statsEmitter.listenerCount("pending")).toBe(before.pending + 1);

    // Socket dies: next keepalive enqueue throws. cancel() is NEVER called here.
    broken = true;
    vi.advanceTimersByTime(25000);

    expect(usageDb.statsEmitter.listenerCount("update")).toBe(before.update);
    expect(usageDb.statsEmitter.listenerCount("pending")).toBe(before.pending);
  });

  it("two orphaned clients leave zero listeners behind", async () => {
    const before = {
      update: usageDb.statsEmitter.listenerCount("update"),
      pending: usageDb.statsEmitter.listenerCount("pending"),
    };
    await openStream();
    await openStream();
    broken = true;
    vi.advanceTimersByTime(25000);
    expect(usageDb.statsEmitter.listenerCount("update")).toBe(before.update);
    expect(usageDb.statsEmitter.listenerCount("pending")).toBe(before.pending);
  });

  it("cleanup on the keepalive path is idempotent (later cancel() is safe)", async () => {
    const before = usageDb.statsEmitter.listenerCount("update");
    await openStream();
    broken = true;
    vi.advanceTimersByTime(25000);
    source.cancel(); // stream machinery may still call cancel afterwards
    expect(usageDb.statsEmitter.listenerCount("update")).toBe(before);
  });

  it("the normal cancel() path still unregisters listeners", async () => {
    const before = {
      update: usageDb.statsEmitter.listenerCount("update"),
      pending: usageDb.statsEmitter.listenerCount("pending"),
    };
    await openStream();
    source.cancel();
    expect(usageDb.statsEmitter.listenerCount("update")).toBe(before.update);
    expect(usageDb.statsEmitter.listenerCount("pending")).toBe(before.pending);
  });
});
