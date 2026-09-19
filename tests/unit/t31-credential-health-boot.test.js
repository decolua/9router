/**
 * T3.1 — credential health scheduler boot guards (spec OMNIROUTE-DIFF T-A).
 * Kill switch CREDENTIAL_HEALTH=off, Next build-phase guard, idempotent start.
 */

import { describe, it, expect, vi, afterEach } from "vitest";

async function fresh() {
  vi.resetModules();
  return import("../../src/lib/credentialHealth/scheduler.js");
}

describe("credential health boot guards", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  async function startWith(env) {
    vi.useFakeTimers();
    for (const [key, value] of Object.entries(env)) {
      if (value === null) continue;
      vi.stubEnv(key, value);
    }
    const mod = await fresh();
    const started = mod.startCredentialHealth();
    return { mod, started, timers: vi.getTimerCount() };
  }

  it("schedules on a normal server boot and is idempotent", async () => {
    const { mod, started, timers } = await startWith({});
    expect(started).toBe(true);
    expect(timers).toBe(2); // startup timeout + interval, both unref'd
    expect(mod.startCredentialHealth()).toBe(false);
    expect(vi.getTimerCount()).toBe(2);
    mod.stopCredentialHealth();
    expect(vi.getTimerCount()).toBe(0);
    expect(mod.startCredentialHealth()).toBe(true);
  });

  it("schedules when NEXT_PHASE is a server phase", async () => {
    const { mod, started, timers } = await startWith({ NEXT_PHASE: "phase-production-server" });
    expect(started).toBe(true);
    expect(timers).toBe(2);
    mod.stopCredentialHealth();
  });

  it("does not schedule when CREDENTIAL_HEALTH=off", async () => {
    const { started, timers } = await startWith({ CREDENTIAL_HEALTH: "off" });
    expect(started).toBe(false);
    expect(timers).toBe(0);
  });

  it("kill switch matches case-insensitively", async () => {
    const { started, timers } = await startWith({ CREDENTIAL_HEALTH: "OFF" });
    expect(started).toBe(false);
    expect(timers).toBe(0);
  });

  it("does not schedule on NEXT_PHASE=production-build", async () => {
    const { started, timers } = await startWith({ NEXT_PHASE: "production-build" });
    expect(started).toBe(false);
    expect(timers).toBe(0);
  });

  it("does not schedule on the canonical build phases", async () => {
    for (const phase of ["phase-production-build", "phase-export", "phase-static"]) {
      vi.unstubAllEnvs();
      const { mod, started, timers } = await startWith({ NEXT_PHASE: phase });
      expect(started, phase).toBe(false);
      expect(timers, phase).toBe(0);
      mod.stopCredentialHealth();
    }
  });

  it("does not schedule in a browser-like context", async () => {
    vi.stubGlobal("window", {});
    const { mod, started, timers } = await startWith({});
    expect(started).toBe(false);
    expect(timers).toBe(0);
    vi.unstubAllGlobals();
    mod.stopCredentialHealth();
  });
});
