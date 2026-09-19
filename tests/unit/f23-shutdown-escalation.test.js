/**
 * F23 (T1.6 M1/M5) — ask-shutdown-then-kill escalation + port-LISTEN scoping.
 *
 * The CHANGELOG (v0.5.75-enhanced.1) promises "the launcher asks the server to
 * stop and waits up to 8s before escalating to SIGKILL" — but the restart path
 * (running `9router` again) still did `kill -9` on sight. These tests drive
 * the escalation engine with fake clocks and fake process/port tables; no
 * real process is ever listed, signalled, or killed.
 */
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const cli = require("../../cli/cli.js");

function fakeClock(start = 1000) {
  let t = start;
  return {
    now: () => t,
    sleep: async (ms) => { t += ms; },
    elapsedFrom: (from) => t - from,
  };
}

function harness({ aliveSet } = {}) {
  const signals = [];
  const alive = new Set(aliveSet || []);
  return {
    signals,
    alive,
    deps: {
      signal: (pid, sig) => {
        signals.push({ pid: String(pid), sig });
        if (sig === "SIGKILL" || sig === "SIGTERM") alive.delete(String(pid));
      },
      isAlive: (pid) => alive.has(String(pid)),
    },
  };
}

describe("terminatePidsGracefully", () => {
  it("asks with SIGTERM and does NOT SIGKILL processes that drain in time", async () => {
    const h = harness({ aliveSet: [] }); // SIGTERM "kills" them (drain + exit)
    const clock = fakeClock();
    const res = await cli.terminatePidsGracefully(["11", "12"], {
      ...h.deps, platform: "linux", graceMs: 8000, pollMs: 100, ...clock,
    });
    expect(h.signals.map((s) => `${s.pid}:${s.sig}`)).toEqual(["11:SIGTERM", "12:SIGTERM"]);
    expect(res.killed).toEqual([]);
    expect(res.exited.sort()).toEqual(["11", "12"]);
    expect(clock.elapsedFrom(1000)).toBeLessThan(400); // resolved without waiting the full grace
  });

  it("waits the FULL grace window, then escalates only the survivor", async () => {
    const alive = new Set(["12"]); // ignores SIGTERM forever until SIGKILL
    const signals = [];
    const clock = fakeClock();
    const res = await cli.terminatePidsGracefully(["11", "12"], {
      platform: "linux",
      graceMs: 8000,
      pollMs: 100,
      signal: (pid, sig) => {
        signals.push({ pid: String(pid), sig });
        if (String(pid) === "11") alive.delete("11"); // drains
        if (sig === "SIGKILL") alive.delete(String(pid));
      },
      isAlive: (pid) => alive.has(String(pid)),
      ...clock,
    });
    const term12 = signals.filter((s) => s.pid === "12" && s.sig === "SIGTERM").length;
    const kill12 = signals.filter((s) => s.pid === "12" && s.sig === "SIGKILL").length;
    expect(term12).toBe(1);
    expect(kill12).toBe(1);
    expect(res.killed).toEqual(["12"]);
    expect(res.exited).toEqual(["11"]);
    // The documented timeout is honored, and the wait is bounded by it:
    const killAt = signals.findIndex((s) => s.pid === "12" && s.sig === "SIGKILL");
    void killAt;
    const waited = clock.elapsedFrom(1000);
    expect(waited).toBeGreaterThanOrEqual(8000);
    expect(waited).toBeLessThanOrEqual(8000 + 8000 + 500); // grace + bounded post-kill settle
  });

  it("dedupes pids, ignores garbage, and self-signal is impossible by input contract", async () => {
    const h = harness();
    const clock = fakeClock();
    const res = await cli.terminatePidsGracefully(["7", 7, "", "NaN-ish", null, undefined, "8"], {
      ...h.deps, platform: "linux", graceMs: 50, pollMs: 10, ...clock,
    });
    expect(h.signals.map((s) => s.pid)).toEqual(["7", "8"]); // "7" once — deduped
    expect(res.asked.sort()).toEqual(["7", "8"]);
  });

  it("empty input resolves immediately with nothing signalled", async () => {
    const h = harness();
    const res = await cli.terminatePidsGracefully([], h.deps);
    expect(h.signals).toEqual([]);
    expect(res).toEqual({ asked: [], exited: [], killed: [] });
  });
});

describe("killAllAppProcesses — restart path (fake process table)", () => {
  const INSTALL = "/opt/npm/lib/node_modules/9router/cli";
  const ENTRIES = [
    { pid: "201", cmd: `node ${INSTALL}/cli.js` },                      // old launcher — ours
    { pid: "202", cmd: `node ${INSTALL}/app/custom-server.js` },        // old server — ours
    { pid: "203", cmd: "next-server (v14.2.3)" },                       // FOREIGN Next app
    { pid: "204", cmd: "grep -rn 9router ." },                          // noise
    { pid: "205", cmd: `tail -f /home/u/.9router/server.log` },         // noise
  ];

  it("asks (SIGTERM) exactly the owned processes — a third-party next-server is never touched", async () => {
    const h = harness({ aliveSet: [] });
    const clock = fakeClock();
    const res = await cli.killAllAppProcesses(20128, {
      platform: "linux",
      selfPid: 900,
      readProcessListImpl: () => ENTRIES,
      resolveCwd: (pid) => (pid === "203" ? "/home/u/shop" : pid === "204" ? "/home/u/repo" : null),
      ownedPaths: [`${INSTALL}/cli.js`, `${INSTALL}/app/custom-server.js`],
      ownedDirs: [`${INSTALL}/app`, INSTALL],
      backgroundCleanup: () => {}, // never touch real PID files from a test
      graceMs: 200,
      pollMs: 20,
      ...h.deps,
      ...clock,
    });
    const signalled = [...new Set(h.signals.map((s) => s.pid))].sort();
    expect(signalled).toEqual(["201", "202"]);
    expect(h.signals.every((s) => s.sig === "SIGTERM")).toBe(true); // drainable → no escalation
    expect(res.asked.sort()).toEqual(["201", "202"]);
  });

  it("the old SIGKILL-on-sight is gone: escalation to KILL only after the grace window", async () => {
    const alive = new Set(["202"]); // wedged server ignores SIGTERM
    const signals = [];
    const clock = fakeClock();
    await cli.killAllAppProcesses(20128, {
      platform: "linux",
      selfPid: 900,
      readProcessListImpl: () => ENTRIES,
      resolveCwd: () => null,
      ownedPaths: [`${INSTALL}/cli.js`, `${INSTALL}/app/custom-server.js`],
      ownedDirs: [`${INSTALL}/app`, INSTALL],
      backgroundCleanup: () => {},
      graceMs: 8000, // the documented budget
      pollMs: 100,
      signal: (pid, sig) => { signals.push({ pid: String(pid), sig }); if (sig === "SIGKILL") alive.delete(String(pid)); },
      isAlive: (pid) => alive.has(String(pid)),
      ...clock,
    });
    const first202 = signals.findIndex((s) => s.pid === "202");
    const kill202 = signals.findIndex((s) => s.pid === "202" && s.sig === "SIGKILL");
    expect(signals[first202].sig).toBe("SIGTERM"); // ask first
    expect(kill202).toBeGreaterThan(first202);     // escalate later, never first
    expect(clock.elapsedFrom(1000)).toBeGreaterThanOrEqual(8000); // waited the full grace
    expect(signals.filter((s) => s.pid === "203" || s.pid === "204" || s.pid === "205")).toEqual([]);
  });
});

describe("killProcessOnPort — LISTEN-owner scoping", () => {
  it("parses lsof -sTCP:LISTEN output into pids only", () => {
    expect(cli.parseLsofListenerPids("4242\n4300\n\n")).toEqual(["4242", "4300"]);
    expect(cli.parseLsofListenerPids("")).toEqual([]);
    expect(cli.parseLsofListenerPids("lsof: no process matched")).toEqual([]);
  });

  it("netstat parser keeps only LISTENING rows whose LOCAL address owns the port (no ESTABLISHED clients)", () => {
    const out = [
      "  TCP    0.0.0.0:20128          0.0.0.0:0              LISTENING       4242",
      "  TCP    127.0.0.1:20128        127.0.0.1:52110        ESTABLISHED     4242",
      "  TCP    127.0.0.1:52110        127.0.0.1:20128        ESTABLISHED     9999", // client!
      "  TCP    [::]:20128             [::]:0                 LISTENING       4242",
    ].join("\n");
    expect(cli.parseNetstatListenerPids(out, 20128)).toEqual(["4242"]);
    expect(cli.parseNetstatListenerPids(out, 52110)).toEqual([]); // 52110 is only ESTABLISHED
  });

  it("asks the listener first and polls until the port is actually free", async () => {
    const h = harness({ aliveSet: [] });
    const clock = fakeClock();
    let listeners = ["4242"];
    const res = await cli.killProcessOnPort(20128, {
      platform: "linux",
      selfPid: 900,
      readListeners: () => listeners,
      graceMs: 200,
      pollMs: 20,
      ...h.deps,
      ...clock,
    });
    expect(h.signals).toEqual([{ pid: "4242", sig: "SIGTERM" }]);
    expect(res.exited).toEqual(["4242"]);
    // (fake signal drops it from `alive`; readListeners still holds the stale
    // entry here, so also prove the poll path drains when listeners clear:
    const h2 = harness({ aliveSet: ["777"] });
    const clock2 = fakeClock();
    let calls = 0;
    const res2 = await cli.killProcessOnPort(20128, {
      platform: "linux",
      selfPid: 900,
      readListeners: () => (++calls < 3 ? ["777"] : []), // clears while we poll
      graceMs: 300,
      pollMs: 50,
      signal: (pid, sig) => { h2.signals.push({ pid, sig }); if (sig === "SIGKILL") h2.alive.delete(String(pid)); },
      isAlive: (pid) => h2.alive.has(String(pid)),
      ...clock2,
    });
    expect(res2.killed).toEqual(["777"]); // ignored the ask → escalated within grace
    expect(clock2.elapsedFrom(1000)).toBeLessThanOrEqual(300 + 2000 + 100); // bounded overall
  });

  it("never signals its own pid", async () => {
    const h = harness({ aliveSet: [] });
    const clock = fakeClock();
    await cli.killProcessOnPort(20128, {
      platform: "linux", selfPid: 900,
      readListeners: () => ["900"], graceMs: 50, pollMs: 10,
      ...h.deps, ...clock,
    });
    expect(h.signals).toEqual([]);
  });
});

describe("settleWithBound (M5 tray-await bound)", () => {
  it("resolves true when the promise settles inside the bound", async () => {
    expect(await cli.settleWithBound(Promise.resolve(), 1000)).toBe(true);
    expect(await cli.settleWithBound(Promise.reject(new Error("gone")), 1000)).toBe(true); // never rejects
  });

  it("resolves false when the promise wedges past the bound", async () => {
    const start = Date.now();
    const settled = await cli.settleWithBound(new Promise(() => {}), 50);
    expect(settled).toBe(false);
    expect(Date.now() - start).toBeGreaterThanOrEqual(40);
    expect(Date.now() - start).toBeLessThan(2000);
  });
});

describe("SHUTDOWN_GRACE_MS contract", () => {
  it("is the documented 8 s budget", () => {
    expect(cli.SHUTDOWN_GRACE_MS).toBe(8000);
  });
});
