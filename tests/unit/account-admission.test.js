import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AccountAdmissionError,
  __resetAccountAdmissionForTests,
  getAccountInFlight,
  getAdmissionSnapshot,
  getProviderCapacityVersion,
  hasAccountCapacity,
  reserveAccountSlot,
  setProviderAdmissionConfig,
  waitForProviderCapacity,
} from "../../src/sse/services/accountAdmission.js";

afterEach(() => {
  __resetAccountAdmissionForTests();
  vi.useRealTimers();
});

describe("account admission", () => {
  it("enforces a per-account limit and releases idempotently", () => {
    const first = reserveAccountSlot("codex", "account-a", 2);
    const second = reserveAccountSlot("codex", "account-a", 2);

    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    expect(reserveAccountSlot("codex", "account-a", 2)).toBeNull();
    expect(getAccountInFlight("codex", "account-a")).toBe(2);
    expect(hasAccountCapacity("codex", "account-a", 2)).toBe(false);

    expect(first.release()).toBe(true);
    expect(first.release()).toBe(false);
    expect(getAccountInFlight("codex", "account-a")).toBe(1);
    expect(second.release()).toBe(true);
    expect(getAdmissionSnapshot()).toEqual({ providers: {} });
  });

  it("wakes provider waiters in FIFO order", async () => {
    const active = reserveAccountSlot("codex", "account-a", 1);
    const version = getProviderCapacityVersion("codex");
    const order = [];
    const firstWaiter = waitForProviderCapacity("codex", {
      afterVersion: version,
      maxQueueSize: 2,
      queueTimeoutMs: 1000,
    }).then(() => order.push("first"));
    const secondWaiter = waitForProviderCapacity("codex", {
      afterVersion: version,
      maxQueueSize: 2,
      queueTimeoutMs: 1000,
    }).then(() => order.push("second"));

    expect(getAdmissionSnapshot().providers.codex.queued).toBe(2);
    active.release();
    await firstWaiter;
    expect(order).toEqual(["first"]);
    expect(getAdmissionSnapshot().providers.codex.queued).toBe(1);

    const next = reserveAccountSlot("codex", "account-a", 1);
    next.release();
    await secondWaiter;

    expect(order).toEqual(["first", "second"]);
    expect(getAdmissionSnapshot()).toEqual({ providers: {} });
  });

  it("rejects immediately when the queue is full", async () => {
    const active = reserveAccountSlot("codex", "account-a", 1);
    const version = getProviderCapacityVersion("codex");
    const queued = waitForProviderCapacity("codex", {
      afterVersion: version,
      maxQueueSize: 1,
      queueTimeoutMs: 1000,
    });

    await expect(waitForProviderCapacity("codex", {
      afterVersion: version,
      maxQueueSize: 1,
      queueTimeoutMs: 1000,
    })).rejects.toMatchObject({
      name: "AccountAdmissionError",
      reason: "queue_full",
      retryAfterMs: 1000,
    });
    expect(getAdmissionSnapshot().providers.codex).toMatchObject({
      queued: 1,
      rejected: 1,
    });

    active.release();
    await queued;
    expect(getAdmissionSnapshot()).toEqual({ providers: {} });
  });

  it("times out and removes its timer and queue entry", async () => {
    vi.useFakeTimers();
    const active = reserveAccountSlot("codex", "account-a", 1);
    const waiting = waitForProviderCapacity("codex", {
      afterVersion: getProviderCapacityVersion("codex"),
      maxQueueSize: 1,
      queueTimeoutMs: 250,
    }).catch((error) => error);

    await vi.advanceTimersByTimeAsync(250);
    const error = await waiting;

    expect(error).toBeInstanceOf(AccountAdmissionError);
    expect(error).toMatchObject({
      reason: "queue_timeout",
      retryAfterMs: 250,
    });
    expect(getAdmissionSnapshot().providers.codex).toMatchObject({
      active: 1,
      queued: 0,
      rejected: 1,
    });

    active.release();
    expect(getAdmissionSnapshot()).toEqual({ providers: {} });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("settles once when release wins immediately before timeout", async () => {
    vi.useFakeTimers();
    const active = reserveAccountSlot("codex", "account-a", 1);
    const waiting = waitForProviderCapacity("codex", {
      afterVersion: getProviderCapacityVersion("codex"),
      maxQueueSize: 1,
      queueTimeoutMs: 250,
    });

    await vi.advanceTimersByTimeAsync(249);
    active.release();
    await expect(waiting).resolves.toMatchObject({ reason: "capacity_changed" });
    await vi.advanceTimersByTimeAsync(1);

    expect(getAdmissionSnapshot()).toEqual({ providers: {} });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("removes an aborted waiter without changing active capacity", async () => {
    const active = reserveAccountSlot("codex", "account-a", 1);
    const controller = new AbortController();
    const waiting = waitForProviderCapacity("codex", {
      afterVersion: getProviderCapacityVersion("codex"),
      maxQueueSize: 1,
      queueTimeoutMs: 1000,
      signal: controller.signal,
    }).catch((error) => error);

    controller.abort();
    const error = await waiting;

    expect(error).toMatchObject({
      name: "AccountAdmissionError",
      reason: "request_aborted",
    });
    expect(getAdmissionSnapshot().providers.codex).toMatchObject({
      active: 1,
      queued: 0,
    });

    active.release();
    expect(getAdmissionSnapshot()).toEqual({ providers: {} });
  });

  it("avoids a lost wakeup when capacity changes before queue insertion", async () => {
    const active = reserveAccountSlot("codex", "account-a", 1);
    const versionBeforeRelease = getProviderCapacityVersion("codex");
    active.release();

    await expect(waitForProviderCapacity("codex", {
      afterVersion: versionBeforeRelease,
      maxQueueSize: 1,
      queueTimeoutMs: 1000,
    })).resolves.toMatchObject({
      reason: "capacity_changed",
    });
    expect(getAdmissionSnapshot()).toEqual({ providers: {} });
  });

  it("isolates providers and reports only aggregate counts", () => {
    setProviderAdmissionConfig("codex", {
      enabled: true,
      maxInFlightPerAccount: 2,
      maxQueueSize: 10,
      queueTimeoutMs: 1000,
    });
    setProviderAdmissionConfig("github", {
      enabled: true,
      maxInFlightPerAccount: 1,
      maxQueueSize: 5,
      queueTimeoutMs: 2000,
    });
    const codexA = reserveAccountSlot("codex", "secret-account-a", 2);
    const codexB = reserveAccountSlot("codex", "secret-account-b", 2);
    const github = reserveAccountSlot("github", "secret-account-c", 1);

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
          maxQueueSize: 10,
          queueTimeoutMs: 1000,
        },
        github: {
          enabled: true,
          active: 1,
          queued: 0,
          rejected: 0,
          accountCount: 1,
          capacity: 1,
          maxInFlightPerAccount: 1,
          maxQueueSize: 5,
          queueTimeoutMs: 2000,
        },
      },
    });
    expect(JSON.stringify(snapshot)).not.toContain("secret-account");

    codexA.release();
    codexB.release();
    github.release();
    expect(getAdmissionSnapshot()).toMatchObject({
      providers: {
        codex: { active: 0, queued: 0, accountCount: 0, capacity: 0 },
        github: { active: 0, queued: 0, accountCount: 0, capacity: 0 },
      },
    });
  });
});
