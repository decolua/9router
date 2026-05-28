import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const statsEmitter = new EventEmitter();
const getActiveRequestsMock = vi.fn(async () => ({
  activeRequests: [],
  recentRequests: [],
  errorProvider: null,
}));
const getUsageStatsMock = vi.fn();

vi.mock("@/lib/usageDb", () => ({
  statsEmitter,
  getActiveRequests: (...args) => getActiveRequestsMock(...args),
  getUsageStats: (...args) => getUsageStatsMock(...args),
}));

function deferredStats(label) {
  let resolve;
  const promise = new Promise((r) => {
    resolve = () => r({ label, activeRequests: [], recentRequests: [] });
  });
  return { promise, resolve };
}

describe("usage stream coalescing", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    statsEmitter.removeAllListeners();
  });

  it("does not overlap full stats recalculation for rapid updates", async () => {
    const first = deferredStats("first");
    const second = deferredStats("second");
    const initial = deferredStats("initial");
    getUsageStatsMock
      .mockReturnValueOnce(initial.promise)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    const { GET } = await import("../../src/app/api/usage/stream/route.js");
    const response = await GET();
    const reader = response.body.getReader();

    initial.resolve();
    await reader.read();
    await vi.waitFor(() => {
      expect(statsEmitter.listenerCount("update")).toBe(1);
    });

    statsEmitter.emit("update");
    statsEmitter.emit("update");
    await Promise.resolve();

    expect(getUsageStatsMock).toHaveBeenCalledTimes(2);

    first.resolve();
    await reader.read();
    await vi.waitFor(() => {
      expect(getUsageStatsMock).toHaveBeenCalledTimes(3);
    });

    second.resolve();
    await reader.read();
    await reader.cancel();
  });
});
