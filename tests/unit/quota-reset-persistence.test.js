import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, vi, afterEach } from "vitest";
import { runQuotaResetTick } from "@/shared/services/quotaResetNotifier.js";

const H = 3600000;
const T0 = Date.parse("2026-11-24T00:00:00Z");
const quota = (resetAt, used = 40) => ({ used, total: 100, remaining: 100 - used, resetAt: new Date(resetAt).toISOString(), unlimited: false });
const target = { id: "t1", name: "Bot", type: "generic", url: "http://bot.local/hooks/notify/X", enabled: true };
const cfg = {
  enabled: true, defaults: { fiveHour: true, weekly: true }, connections: {},
  titleTemplate: "{provider} {window}", bodyTemplate: "{account}", targets: [target],
};
const conn = { id: "c1", provider: "claude", name: "me@x.com" };

// One persistent store shared across simulated process lifetimes.
function makeStore() {
  const rows = {};
  return {
    rows,
    loadState: async () => JSON.parse(JSON.stringify(rows)),
    saveAccount: async (id, account) => { rows[id] = { windows: account.windows, hasWindows: account.hasWindows }; },
    removeAccount: async (id) => { delete rows[id]; },
  };
}

// A "process" is fresh in-memory state plus its own clock and sender.
function boot(store, { usage, conns = [conn], clock }) {
  const send = vi.fn(async () => ({ ok: true }));
  const deps = {
    ...store,
    now: () => clock.t,
    send,
    getSettings: async () => ({ quotaResetNotify: cfg }),
    getProviderConnections: async () => conns,
    fetchUsage: vi.fn(async () => usage(clock.t)),
  };
  const state = { running: false, loaded: false, accounts: {}, recent: [] };
  return { deps, state, send, tick: () => runQuotaResetTick(deps, state) };
}

describe("restart resumes the wait", () => {
  it("keeps waiting across a restart, then announces the reset once", async () => {
    const store = makeStore();
    const resetAt = T0 + 2 * H;
    const clock = { t: T0 };
    const usage = (now) => ({ quotas: { "session (5h)": now < resetAt + 1000 ? quota(resetAt, 90) : quota(now + 5 * H, 0) } });

    const first = boot(store, { usage, clock });
    await first.tick();
    expect(store.rows.c1.windows["session (5h)"].resetAt).toBe(resetAt);   // persisted

    // restart one hour in: window still open
    clock.t = T0 + H;
    const second = boot(store, { usage, clock });
    await second.tick();
    expect(second.send).not.toHaveBeenCalled();

    // restart again just after the reset
    clock.t = resetAt + 30000;
    const third = boot(store, { usage, clock });
    await third.tick();
    expect(third.send).toHaveBeenCalledTimes(1);

    // and a further restart does not repeat it
    clock.t += 60000;
    const fourth = boot(store, { usage, clock });
    await fourth.tick();
    expect(fourth.send).not.toHaveBeenCalled();
  });

  it("announces a reset that happened while the process was down", async () => {
    const store = makeStore();
    const clock = { t: T0 };
    const usage = (now) => ({ quotas: { "session (5h)": now < T0 + 2 * H ? quota(T0 + 2 * H, 80) : quota(now + 5 * H, 0) } });
    await boot(store, { usage, clock }).tick();

    clock.t = T0 + 2 * H + 10 * 60000;                     // back up 10 minutes late
    const after = boot(store, { usage, clock });
    await after.tick();
    expect(after.send).toHaveBeenCalledTimes(1);
  });

  it("does not announce a reset older than a day, but moves on to the new window", async () => {
    const store = makeStore();
    const clock = { t: T0 };
    const usage = (now) => ({ quotas: { "session (5h)": now < T0 + 2 * H ? quota(T0 + 2 * H) : quota(now + 5 * H, 0) } });
    await boot(store, { usage, clock }).tick();

    clock.t = T0 + 3 * 24 * H;
    const after = boot(store, { usage, clock });
    await after.tick();
    expect(after.send).not.toHaveBeenCalled();
    expect(store.rows.c1.windows["session (5h)"].resetAt).toBe(clock.t + 5 * H);
  });

  it("drops the saved state of an account that is gone", async () => {
    const store = makeStore();
    const clock = { t: T0 };
    const usage = () => ({ quotas: { "session (5h)": quota(T0 + 2 * H) } });
    await boot(store, { usage, clock }).tick();
    expect(store.rows.c1).toBeDefined();
    await boot(store, { usage, clock, conns: [] }).tick();
    expect(store.rows.c1).toBeUndefined();
  });
});

describe("storage failures do not stop notifications", () => {
  it("still sends when saving throws", async () => {
    const store = makeStore();
    store.saveAccount = async () => { throw new Error("disk full"); };
    const clock = { t: T0 };
    const usage = (now) => ({ quotas: { "session (5h)": now < T0 + 1000 ? quota(T0 + 1000) : quota(now + 5 * H, 0) } });
    const p = boot(store, { usage, clock });
    await p.tick();
    clock.t = T0 + 2000;
    await p.tick();
    expect(p.send).toHaveBeenCalledTimes(1);
  });

  it("falls back to learning when loading throws", async () => {
    const store = makeStore();
    store.loadState = async () => { throw new Error("db locked"); };
    const clock = { t: T0 };
    const p = boot(store, { usage: () => ({ quotas: { "session (5h)": quota(T0 + 2 * H) } }), clock });
    await p.tick();
    expect(p.send).not.toHaveBeenCalled();
    expect(p.deps.fetchUsage).toHaveBeenCalled();
  });
});

describe("quotaResetStateRepo on a real database", () => {
  let tempDir;
  const originalDataDir = process.env.DATA_DIR;

  afterEach(() => {
    try { global._dbAdapter?.instance?.close?.(); } catch {}
    delete global._dbAdapter;
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
  });

  it("survives closing and reopening the database", async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-qrs-"));
    process.env.DATA_DIR = tempDir;
    delete global._dbAdapter;
    vi.resetModules();

    let repo = await import("@/lib/db/repos/quotaResetStateRepo.js");
    const windows = { "session (5h)": { resetAt: T0 + 2 * H, usedPercent: 90, window: "fiveHour" } };
    await repo.saveQuotaResetAccount("c1", { windows, hasWindows: true });
    await repo.saveQuotaResetAccount("c2", { windows: {}, hasWindows: false });

    // "restart": drop the adapter and every cached module, reopen the same file
    try { global._dbAdapter?.instance?.close?.(); } catch {}
    delete global._dbAdapter;
    vi.resetModules();
    repo = await import("@/lib/db/repos/quotaResetStateRepo.js");

    const loaded = await repo.loadQuotaResetState();
    expect(loaded.c1).toEqual({ windows, hasWindows: true });
    expect(Object.keys(loaded).sort()).toEqual(["c1", "c2"]);

    await repo.removeQuotaResetAccount("c2");
    expect(Object.keys(await repo.loadQuotaResetState())).toEqual(["c1"]);
    await repo.clearQuotaResetState();
    expect(await repo.loadQuotaResetState()).toEqual({});
  });
});
