import { describe, it, expect } from "vitest";
import {
  acquire,
  markBlocked,
  isSemaphoreCapacityError,
  buildAccountSemaphoreKey,
  resolveAccountSemaphoreKey,
  resolveAccountSemaphoreMaxConcurrency,
  SemaphoreCapacityError,
} from "../../open-sse/services/accountSemaphore.js";

describe("AccountSemaphore", () => {
  it("buildAccountSemaphoreKey is provider:connectionId", () => {
    expect(buildAccountSemaphoreKey({ provider: "glm", connectionId: "acc-1" })).toBe("glm:acc-1");
  });

  it("releases immediately under the cap", async () => {
    const key = buildAccountSemaphoreKey({ provider: "sem-1", connectionId: "a" });
    const release = await acquire(key, { maxConcurrency: 3 });
    expect(typeof release).toBe("function");
    release();
  });

  it("times out the extra acquire on the same account", async () => {
    const key = buildAccountSemaphoreKey({ provider: "sem-2", connectionId: "a" });
    const r1 = await acquire(key, { maxConcurrency: 1 });
    try {
      await expect(acquire(key, { maxConcurrency: 1, timeoutMs: 40 })).rejects.toThrow(SemaphoreCapacityError);
    } finally {
      r1();
    }
  });

  it("does not block a different account", async () => {
    const keyA = buildAccountSemaphoreKey({ provider: "sem-3", connectionId: "a" });
    const keyB = buildAccountSemaphoreKey({ provider: "sem-3", connectionId: "b" });
    const rA = await acquire(keyA, { maxConcurrency: 1 });
    const rB = await acquire(keyB, { maxConcurrency: 1, timeoutMs: 40 });
    rA();
    rB();
  });

  it("bypasses when maxConcurrency is 0 or null", async () => {
    const key = buildAccountSemaphoreKey({ provider: "sem-4", connectionId: "a" });
    (await acquire(key, { maxConcurrency: 0 }))();
    (await acquire(key, { maxConcurrency: null }))();
  });

  it("maxConcurrency is opt-in: bypassed unless the connection sets a positive cap", () => {
    // Upstream has no cap. A default one throttled ordinary parallel traffic.
    expect(resolveAccountSemaphoreMaxConcurrency({})).toBe(null);
    expect(resolveAccountSemaphoreMaxConcurrency(null)).toBe(null);
    expect(resolveAccountSemaphoreMaxConcurrency({ providerSpecificData: { maxConcurrency: 0 } })).toBe(null);
    expect(resolveAccountSemaphoreMaxConcurrency({ providerSpecificData: { maxConcurrency: null } })).toBe(null);
    expect(resolveAccountSemaphoreMaxConcurrency({ providerSpecificData: { maxConcurrency: 8 } })).toBe(8);
  });

  it("resolveAccountSemaphoreKey needs provider and connectionId", () => {
    expect(resolveAccountSemaphoreKey({ provider: "glm", connectionId: "x" })).toBe("glm:x");
    expect(resolveAccountSemaphoreKey({ provider: "glm" })).toBe(null);
  });

  it("isSemaphoreCapacityError detects the class", async () => {
    const key = buildAccountSemaphoreKey({ provider: "sem-5", connectionId: "a" });
    const r1 = await acquire(key, { maxConcurrency: 1 });
    try {
      await acquire(key, { maxConcurrency: 1, timeoutMs: 20 });
      throw new Error("should have thrown");
    } catch (e) {
      expect(isSemaphoreCapacityError(e)).toBe(true);
    } finally {
      r1();
    }
  });

  it("rejects immediately when signal is already aborted", async () => {
    const key = buildAccountSemaphoreKey({ provider: "sem-abort", connectionId: "a" });
    const controller = new AbortController();
    controller.abort();
    await expect(
      acquire(key, { maxConcurrency: 1, signal: controller.signal }),
    ).rejects.toThrow();
  });

  it("aborts a queued waiter when signal aborts", async () => {
    const key = buildAccountSemaphoreKey({ provider: "sem-abort2", connectionId: "a" });
    const r1 = await acquire(key, { maxConcurrency: 1 });
    const controller = new AbortController();
    try {
      const pending = acquire(key, {
        maxConcurrency: 1,
        timeoutMs: 5_000,
        signal: controller.signal,
      });
      await Promise.resolve();
      controller.abort();
      await expect(pending).rejects.toThrow();
    } finally {
      r1();
    }
  });

  it("wakes queued waiters when markBlocked expires with running===0", async () => {
    const key = buildAccountSemaphoreKey({ provider: "sem-block", connectionId: "a" });
    const r1 = await acquire(key, { maxConcurrency: 1 });
    const start = Date.now();
    const waiter = acquire(key, { maxConcurrency: 1, timeoutMs: 400 });
    markBlocked(key, 40);
    r1();
    const release = await waiter;
    expect(Date.now() - start).toBeLessThan(250);
    release();
  });

  it("new acquires after block expiry do not jump ahead of queued waiters", async () => {
    const key = buildAccountSemaphoreKey({ provider: "sem-fifo", connectionId: "a" });
    const order = [];
    const r1 = await acquire(key, { maxConcurrency: 1 });
    const waiter = acquire(key, { maxConcurrency: 1, timeoutMs: 1_000 }).then((release) => {
      order.push("waiter");
      release();
    });
    markBlocked(key, 30);
    r1();
    await new Promise((r) => setTimeout(r, 50));
    const newbie = acquire(key, { maxConcurrency: 1, timeoutMs: 1_000 }).then((release) => {
      order.push("newbie");
      release();
    });
    await Promise.all([waiter, newbie]);
    expect(order[0]).toBe("waiter");
  });

  it("acquire on idle blocked gate schedules unblock (not full timeoutMs)", async () => {
    // Stuck sequence: markBlocked while running → release to idle (queue empty, no timer)
    // → new acquire while still blocked must wake near blockedUntil, not timeoutMs.
    const key = buildAccountSemaphoreKey({ provider: "sem-idle-block", connectionId: "a" });
    const r1 = await acquire(key, { maxConcurrency: 1 });
    markBlocked(key, 80);
    r1();
    const start = Date.now();
    const release = await acquire(key, { maxConcurrency: 1, timeoutMs: 2_000 });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(500);
    expect(elapsed).toBeGreaterThanOrEqual(40);
    release();
  });
});
