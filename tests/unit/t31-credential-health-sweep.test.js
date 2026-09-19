/**
 * T3.1 — credential health sweep logic (spec OMNIROUTE-DIFF T-A).
 *
 * Drives runCredentialHealthTick with injected deps (connections, tester,
 * persister, clock). testStatus persistence is testSingleConnection's own job;
 * the sweep adds lastTested + per-connection backoff scheduling.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const NOW = Date.parse("2026-09-19T00:00:00.000Z");
const MIN = 60_000;

function conn(overrides = {}) {
  return {
    id: "c1",
    provider: "openrouter",
    authType: "apikey",
    isActive: true,
    testStatus: "unknown",
    ...overrides,
  };
}

function makeClock(start = NOW) {
  const clock = { at: start };
  return {
    now: () => clock.at,
    advance: (ms) => { clock.at += ms; },
  };
}

async function load() {
  return import("../../src/lib/credentialHealth/scheduler.js");
}

describe("credential health sweep tick", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("backs off 5→10→30→120min across consecutive errors and clamps", async () => {
    const { runCredentialHealthTick } = await load();
    const clock = makeClock();
    const testConnection = vi.fn(async () => ({ valid: false, error: "boom" }));
    const tick = () => runCredentialHealthTick({
      now: clock.now,
      loadConnections: async () => [conn()],
      testConnection,
      persistLastTested: async () => {},
    });

    await tick();
    expect(testConnection).toHaveBeenCalledTimes(1); // next at +5min

    clock.advance(5 * MIN);
    await tick();
    expect(testConnection).toHaveBeenCalledTimes(2); // next at +10min

    clock.advance(9 * MIN);
    await tick();
    expect(testConnection).toHaveBeenCalledTimes(2); // not due yet (+14min)

    clock.advance(1 * MIN);
    await tick();
    expect(testConnection).toHaveBeenCalledTimes(3); // next at +30min

    clock.advance(29 * MIN);
    await tick();
    expect(testConnection).toHaveBeenCalledTimes(3);

    clock.advance(1 * MIN);
    await tick();
    expect(testConnection).toHaveBeenCalledTimes(4); // next at +120min

    clock.advance(119 * MIN);
    await tick();
    expect(testConnection).toHaveBeenCalledTimes(4);

    clock.advance(1 * MIN);
    await tick();
    expect(testConnection).toHaveBeenCalledTimes(5); // clamped at +120min

    clock.advance(119 * MIN);
    await tick();
    expect(testConnection).toHaveBeenCalledTimes(5);
  });

  it("success resets the backoff ladder to the default 60min interval", async () => {
    const { runCredentialHealthTick } = await load();
    const clock = makeClock();
    let fail = true;
    const testConnection = vi.fn(async () => (fail ? { valid: false, error: "boom" } : { valid: true }));
    const tick = () => runCredentialHealthTick({
      now: clock.now,
      loadConnections: async () => [conn()],
      testConnection,
      persistLastTested: async () => {},
    });

    await tick(); // error → +5min
    clock.advance(5 * MIN);
    fail = false;
    await tick(); // success at NOW+5 → next NOW+5+60
    expect(testConnection).toHaveBeenCalledTimes(2);

    clock.advance(54 * MIN); // NOW+59 → not due
    await tick();
    expect(testConnection).toHaveBeenCalledTimes(2);

    clock.advance(6 * MIN); // NOW+65 = due (success at NOW+5 + 60min)
    await tick();
    expect(testConnection).toHaveBeenCalledTimes(3);

    // ladder restarted: next error must wait only 5min, not 10min
    fail = true;
    clock.advance(60 * MIN);
    await tick(); // error at NOW+125 → +5min
    expect(testConnection).toHaveBeenCalledTimes(4);
    clock.advance(5 * MIN);
    await tick();
    expect(testConnection).toHaveBeenCalledTimes(5);
  });

  it("providerSpecificData.healthCheckInterval 0 means never", async () => {
    const { runCredentialHealthTick } = await load();
    const testConnection = vi.fn(async () => ({ valid: true }));
    await runCredentialHealthTick({
      now: () => NOW,
      loadConnections: async () => [conn({ providerSpecificData: { healthCheckInterval: 0 } }), conn({ id: "c2" })],
      testConnection,
      persistLastTested: async () => {},
    });
    expect(testConnection).toHaveBeenCalledTimes(1);
    expect(testConnection.mock.calls[0][0]).toBe("c2");
  });

  it("honors a custom per-connection interval", async () => {
    const { runCredentialHealthTick } = await load();
    const clock = makeClock();
    const testConnection = vi.fn(async () => ({ valid: true }));
    const tick = () => runCredentialHealthTick({
      now: clock.now,
      loadConnections: async () => [conn({ providerSpecificData: { healthCheckInterval: 15 } })],
      testConnection,
      persistLastTested: async () => {},
    });

    await tick();
    clock.advance(14 * MIN);
    await tick();
    expect(testConnection).toHaveBeenCalledTimes(1);
    clock.advance(1 * MIN);
    await tick();
    expect(testConnection).toHaveBeenCalledTimes(2);
  });

  it("inconclusive probe (valid with warning/error) rechecks no sooner than 30min", async () => {
    const { runCredentialHealthTick } = await load();
    const clock = makeClock();
    const testConnection = vi.fn(async () => ({ valid: true, error: "account out of credits" }));
    const tick = () => runCredentialHealthTick({
      now: clock.now,
      loadConnections: async () => [conn({ providerSpecificData: { healthCheckInterval: 10 } })],
      testConnection,
      persistLastTested: async () => {},
    });

    await tick(); // next = max(10, 30) = +30min
    clock.advance(20 * MIN);
    await tick();
    expect(testConnection).toHaveBeenCalledTimes(1);
    clock.advance(10 * MIN);
    await tick();
    expect(testConnection).toHaveBeenCalledTimes(2);
  });

  it("uses persisted lastTested for the due check when no in-memory state exists", async () => {
    const { runCredentialHealthTick } = await load();
    const fresh = vi.fn(async () => ({ valid: true }));
    await runCredentialHealthTick({
      now: () => NOW,
      loadConnections: async () => [
        conn({ id: "recent", lastTested: new Date(NOW - 10 * MIN).toISOString() }),
        conn({ id: "old", lastTested: new Date(NOW - 90 * MIN).toISOString() }),
        conn({ id: "never" }),
      ],
      testConnection: fresh,
      persistLastTested: async () => {},
    });
    const tested = fresh.mock.calls.map((c) => c[0]).sort();
    expect(tested).toEqual(["never", "old"]);
  });

  it("writes lastTested after each attempt but leaves testStatus to the tester", async () => {
    const { runCredentialHealthTick, DEFAULT_INTERVAL_MS } = await load();
    expect(DEFAULT_INTERVAL_MS).toBe(60 * MIN);
    const persistLastTested = vi.fn(async () => {});
    await runCredentialHealthTick({
      now: () => NOW,
      loadConnections: async () => [conn()],
      testConnection: async () => ({ valid: false, error: "boom" }),
      persistLastTested,
    });
    expect(persistLastTested).toHaveBeenCalledWith("c1", new Date(NOW).toISOString());
  });

  it("drops a disappeared connection without persisting or scheduling it", async () => {
    const { runCredentialHealthTick } = await load();
    const persistLastTested = vi.fn(async () => {});
    const clock = makeClock();
    const testConnection = vi.fn(async () => ({ valid: false, error: "Connection not found" }));
    const tick = () => runCredentialHealthTick({
      now: clock.now,
      loadConnections: async () => [conn()],
      testConnection,
      persistLastTested,
    });
    await tick();
    clock.advance(MIN);
    await tick();
    expect(persistLastTested).not.toHaveBeenCalled();
  });

  it("caps concurrent tests at 5 while covering every due connection", async () => {
    const { runCredentialHealthTick, CONCURRENCY } = await load();
    expect(CONCURRENCY).toBe(5);
    const connections = Array.from({ length: 13 }, (_, i) => conn({ id: `c${i}` }));
    let inflight = 0;
    let maxInflight = 0;
    const testConnection = vi.fn(async () => {
      inflight += 1;
      maxInflight = Math.max(maxInflight, inflight);
      await new Promise((r) => setTimeout(r, 5));
      inflight -= 1;
      return { valid: true };
    });
    await runCredentialHealthTick({
      now: () => NOW,
      loadConnections: async () => connections,
      testConnection,
      persistLastTested: async () => {},
    });
    expect(testConnection).toHaveBeenCalledTimes(13);
    expect(maxInflight).toBeLessThanOrEqual(5);
  });

  it("is fail-open: loader, tester and persister rejections never throw out of the tick", async () => {
    const { runCredentialHealthTick } = await load();
    await expect(runCredentialHealthTick({
      loadConnections: async () => { throw new Error("db down"); },
    })).resolves.toBeDefined();

    const testConnection = vi.fn(async () => { throw new Error("probe exploded"); });
    await expect(runCredentialHealthTick({
      now: () => NOW,
      loadConnections: async () => [conn()],
      testConnection,
      persistLastTested: async () => {},
    })).resolves.toBeDefined();
    expect(testConnection).toHaveBeenCalledTimes(1);

    await expect(runCredentialHealthTick({
      now: () => NOW + 61 * MIN,
      loadConnections: async () => [conn()],
      testConnection,
      persistLastTested: async () => { throw new Error("write failed"); },
    })).resolves.toBeDefined();

    // a second tick cannot run while one is in flight
    let release;
    const gate = new Promise((r) => { release = r; });
    const slowTick = runCredentialHealthTick({
      loadConnections: async () => { await gate; return [conn()]; },
    });
    const concurrent = await runCredentialHealthTick({ loadConnections: async () => [conn()] });
    expect(concurrent.skipped).toBe(true);
    release();
    await slowTick;
  });

  it("logs carry no credential material", async () => {
    const { runCredentialHealthTick } = await load();
    const lines = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...args) => { lines.push(args.join(" ")); });
    await runCredentialHealthTick({
      now: () => NOW,
      loadConnections: async () => [conn({ apiKey: "sk-super-secret", accessToken: "tok-secret", providerSpecificData: { baseUrl: "https://x/v1?key=sk-super-secret" } })],
      testConnection: async () => ({ valid: false, error: "https://x/v1?key=sk-super-secret refused" }),
      persistLastTested: async () => {},
    });
    expect(spy).toHaveBeenCalled();
    const all = lines.join("\n");
    expect(all).not.toContain("sk-super-secret");
    expect(all).not.toContain("tok-secret");
  });
});
