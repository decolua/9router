/**
 * `/api/usage/stream` subscribes two handlers to `statsEmitter` — a process-wide
 * singleton, `global._statsEmitter` with `setMaxListeners(50)` — and unsubscribed
 * them only from `ReadableStream.cancel()`.
 *
 * The sibling SSE route already records why that is not enough
 * (src/app/api/translator/console-logs/stream/route.js:22):
 *
 *     // request.signal fires reliably on client disconnect; ReadableStream.cancel()
 *     // is not always invoked in Next.js, which caused listeners to accumulate.
 *
 * `console-logs/stream` therefore takes `request` and cleans up on `request.signal`.
 * `usage/stream` was declared `export async function GET()` — no parameter at all —
 * so it had no second path off the emitter. Every dashboard tab that closed without
 * a `cancel()` left both handlers registered, and each surviving handler still ran
 * the full `getActiveRequests()` + `getUsageStats()` recalculation on every emit,
 * because its `state.closed` flag was never set.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";

const statsEmitter = new EventEmitter();

/** Per-test overrides for the two DB reads the route performs. */
const db = {
  getUsageStats: async () => ({ total: 0 }),
  getActiveRequests: async () => ({ activeRequests: [], recentRequests: [], errorProvider: null }),
};

vi.mock("@/lib/usageDb", () => ({
  statsEmitter,
  getUsageStats: (...args) => db.getUsageStats(...args),
  getActiveRequests: (...args) => db.getActiveRequests(...args),
}));

/** Listener bookkeeping is what leaks; count both events the route subscribes to. */
const subscribed = () =>
  statsEmitter.listenerCount("update") + statsEmitter.listenerCount("pending");

const settle = () => new Promise((resolve) => setImmediate(resolve));

beforeEach(() => {
  statsEmitter.removeAllListeners();
  db.getUsageStats = async () => ({ total: 0 });
  db.getActiveRequests = async () => ({ activeRequests: [], recentRequests: [], errorProvider: null });
});
afterEach(() => { statsEmitter.removeAllListeners(); });

async function callRoute() {
  const { GET } = await import("@/app/api/usage/stream/route.js");
  const controller = new AbortController();
  const response = await GET(
    new Request("http://localhost/api/usage/stream", { signal: controller.signal })
  );
  return { controller, response };
}

/** Opens the stream and reads the first `data:` frame, so the route is fully subscribed. */
async function openStream() {
  const { controller, response } = await callRoute();
  const reader = response.body.getReader();
  await reader.read();
  return { controller, reader };
}

describe("/api/usage/stream cleanup", () => {
  it("unsubscribes from statsEmitter when the client aborts", async () => {
    const { controller } = await openStream();
    expect(subscribed()).toBe(2);

    controller.abort();
    await settle();

    expect(subscribed()).toBe(0);
  });

  it("does not accumulate listeners across disconnected clients", async () => {
    for (let i = 0; i < 30; i++) {
      const { controller } = await openStream();
      controller.abort();
      await settle();
    }

    // 30 tabs x 2 handlers = 60, past the emitter's 50-listener ceiling.
    expect(subscribed()).toBe(0);
  });

  it("still cleans up when the consumer cancels the stream instead", async () => {
    const { reader } = await openStream();
    expect(subscribed()).toBe(2);

    await reader.cancel();
    await settle();

    expect(subscribed()).toBe(0);
  });

  it("does not subscribe at all when the client leaves during the first (awaited) stats read", async () => {
    let abortNow;
    const firstReadStarted = new Promise((resolve) => { abortNow = resolve; });
    let release;
    const firstReadFinishes = new Promise((resolve) => { release = resolve; });

    db.getUsageStats = async () => {
      abortNow();
      await firstReadFinishes;
      return { total: 0 };
    };

    const { controller, response } = await callRoute();
    const reader = response.body.getReader();
    const pending = reader.read();

    await firstReadStarted;
    controller.abort();   // client gone while `await getUsageStats()` is still in flight
    release();
    await pending.catch(() => {});
    await settle();

    expect(subscribed()).toBe(0);
  });
});
