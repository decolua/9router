// Regression test for #1245 — /api/usage/stream did not clean up statsEmitter
// listeners on client disconnect, causing leaked closures (each holding the
// full cachedStats object) to accumulate over days of dashboard use.
import { describe, it, expect, beforeEach, vi } from "vitest";

// Stub out the heavy stats path before importing the route.
vi.mock("@/lib/usageDb", () => {
  const { EventEmitter } = require("events");
  const statsEmitter = new EventEmitter();
  statsEmitter.setMaxListeners(200);
  return {
    statsEmitter,
    getUsageStats: vi.fn(async () => ({ totalRequests: 0, byProvider: {}, byModel: {} })),
    getActiveRequests: vi.fn(async () => ({ activeRequests: [], recentRequests: [], errorProvider: "" })),
  };
});

function makeAbortableRequest() {
  const ctrl = new AbortController();
  return {
    signal: ctrl.signal,
    abort: () => ctrl.abort(),
  };
}

describe("/api/usage/stream listener cleanup (#1245)", () => {
  let route;
  let statsEmitter;

  beforeEach(async () => {
    vi.resetModules();
    route = await import("@/app/api/usage/stream/route.js");
    ({ statsEmitter } = await import("@/lib/usageDb"));
    statsEmitter.removeAllListeners();
  });

  it("removes statsEmitter listeners on request.signal abort", async () => {
    const req = makeAbortableRequest();
    const response = await route.GET(req);
    // Wait one microtask tick so the start() callback registers listeners.
    const reader = response.body.getReader();
    // Pull one chunk to ensure start() ran fully.
    await reader.read();

    expect(statsEmitter.listenerCount("update")).toBe(1);
    expect(statsEmitter.listenerCount("pending")).toBe(1);

    req.abort();
    // Yield so the abort handler runs.
    await new Promise((r) => setImmediate(r));

    expect(statsEmitter.listenerCount("update")).toBe(0);
    expect(statsEmitter.listenerCount("pending")).toBe(0);

    try { reader.cancel(); } catch {}
  });

  it("does not accumulate listeners across many short-lived connections", async () => {
    const N = 25;
    for (let i = 0; i < N; i++) {
      const req = makeAbortableRequest();
      const response = await route.GET(req);
      const reader = response.body.getReader();
      await reader.read();
      req.abort();
      await new Promise((r) => setImmediate(r));
      try { reader.cancel(); } catch {}
    }
    expect(statsEmitter.listenerCount("update")).toBe(0);
    expect(statsEmitter.listenerCount("pending")).toBe(0);
  });

  it("cleanup is idempotent (abort + cancel both safe)", async () => {
    const req = makeAbortableRequest();
    const response = await route.GET(req);
    const reader = response.body.getReader();
    await reader.read();

    req.abort();
    await new Promise((r) => setImmediate(r));
    // Also trigger cancel() — must not throw, must keep listener count at 0.
    try { await reader.cancel(); } catch {}
    expect(statsEmitter.listenerCount("update")).toBe(0);
    expect(statsEmitter.listenerCount("pending")).toBe(0);
  });
});
