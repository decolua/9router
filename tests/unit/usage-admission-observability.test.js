import { afterEach, describe, expect, it, vi } from "vitest";

const usageMocks = vi.hoisted(() => {
  const listeners = new Map();
  const statsEmitter = {
    on: vi.fn((event, listener) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(listener);
    }),
    off: vi.fn((event, listener) => {
      listeners.get(event)?.delete(listener);
    }),
  };

  return {
    listeners,
    statsEmitter,
    getUsageStats: vi.fn(async () => ({
      totalRequests: 9,
      byProvider: {},
    })),
    getActiveRequests: vi.fn(async () => ({
      activeRequests: [],
      recentRequests: [],
      errorProvider: null,
    })),
  };
});

const admissionSubscription = vi.hoisted(() => ({
  unsubscribes: [],
}));

vi.mock("@/lib/usageDb", () => ({
  getUsageStats: usageMocks.getUsageStats,
  getActiveRequests: usageMocks.getActiveRequests,
  statsEmitter: usageMocks.statsEmitter,
}));

vi.mock("@/sse/services/accountAdmission.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    subscribeAdmissionChanges: vi.fn((listener) => {
      const unsubscribe = actual.subscribeAdmissionChanges(listener);
      const tracked = vi.fn(unsubscribe);
      admissionSubscription.unsubscribes.push(tracked);
      return tracked;
    }),
  };
});

const { GET } = await import("../../src/app/api/usage/stream/route.js");
const {
  __resetAccountAdmissionForTests,
  getAdmissionSnapshot,
  reserveAccountSlot,
  setProviderAdmissionConfig,
  subscribeAdmissionChanges,
  waitForProviderCapacity,
} = await import("../../src/sse/services/accountAdmission.js");

function parseSsePayload(value) {
  const text = new TextDecoder().decode(value);
  const dataLine = text.split("\n").find((line) => line.startsWith("data: "));
  return JSON.parse(dataLine.slice(6));
}

afterEach(() => {
  __resetAccountAdmissionForTests();
  admissionSubscription.unsubscribes.length = 0;
  usageMocks.statsEmitter.on.mockClear();
  usageMocks.statsEmitter.off.mockClear();
  usageMocks.getUsageStats.mockClear();
  usageMocks.getActiveRequests.mockClear();
});

describe("usage admission observability", () => {
  it("serializes stable aggregate metrics without account identities", () => {
    setProviderAdmissionConfig("codex", {
      enabled: true,
      maxInFlightPerAccount: 2,
      maxQueueSize: 20,
      queueTimeoutMs: 5000,
    });
    const first = reserveAccountSlot("codex", "private-account-alpha", 2);
    const second = reserveAccountSlot("codex", "private-account-beta", 2);

    const snapshot = getAdmissionSnapshot();

    expect(snapshot).toEqual({
      providers: {
        codex: {
          enabled: true,
          active: 2,
          queued: 0,
          rejected: 0,
          accountCount: 2,
          capacity: 4,
          maxInFlightPerAccount: 2,
          maxQueueSize: 20,
          queueTimeoutMs: 5000,
        },
      },
    });
    expect(JSON.stringify(snapshot)).not.toMatch(
      /private-account|token|email|prompt|schema/i,
    );

    first.release();
    second.release();
  });

  it("notifies subscribers and removes them idempotently", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeAdmissionChanges(listener);

    setProviderAdmissionConfig("codex", {
      enabled: true,
      maxInFlightPerAccount: 1,
      maxQueueSize: 10,
      queueTimeoutMs: 1000,
    });
    expect(listener).toHaveBeenCalledTimes(1);

    expect(unsubscribe()).toBe(true);
    expect(unsubscribe()).toBe(false);
    reserveAccountSlot("codex", "private-account", 1);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("adds admission to full and lightweight stream payloads and unsubscribes on cancel", async () => {
    setProviderAdmissionConfig("codex", {
      enabled: true,
      maxInFlightPerAccount: 1,
      maxQueueSize: 1,
      queueTimeoutMs: 1000,
    });
    const lease = reserveAccountSlot("codex", "private-account", 1);
    const waiting = waitForProviderCapacity("codex", {
      afterVersion: 0,
      maxQueueSize: 1,
      queueTimeoutMs: 1000,
    });

    const response = await GET();
    const reader = response.body.getReader();

    try {
      const full = parseSsePayload((await reader.read()).value);
      expect(full).toMatchObject({
        totalRequests: 9,
        admission: {
          providers: {
            codex: {
              enabled: true,
              active: 1,
              queued: 1,
              accountCount: 1,
              capacity: 1,
            },
          },
        },
      });

      lease.release();
      await waiting;

      const lightweight = parseSsePayload((await reader.read()).value);
      expect(lightweight).toMatchObject({
        totalRequests: 9,
        activeRequests: [],
        recentRequests: [],
        admission: {
          providers: {
            codex: {
              enabled: true,
              active: 0,
              queued: 0,
              accountCount: 0,
              capacity: 0,
            },
          },
        },
      });
    } finally {
      await reader.cancel();
    }

    expect(admissionSubscription.unsubscribes).toHaveLength(1);
    expect(admissionSubscription.unsubscribes[0]).toHaveBeenCalledTimes(1);
    expect(usageMocks.statsEmitter.off).toHaveBeenCalledWith(
      "update",
      expect.any(Function),
    );
    expect(usageMocks.statsEmitter.off).toHaveBeenCalledWith(
      "pending",
      expect.any(Function),
    );
    expect(usageMocks.listeners.get("update")?.size || 0).toBe(0);
    expect(usageMocks.listeners.get("pending")?.size || 0).toBe(0);
  });
});
