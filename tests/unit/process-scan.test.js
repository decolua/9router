// Regression tests for the process sweep that used to kill unrelated processes.
//
// The old code scanned `ps aux` line by line and took the second whitespace
// token as the pid. `ps` wraps long command lines, and a wrapped continuation
// still contains the strings the sweep matches on ("9router", "next-server", …),
// so the "pid" was often just a number from the command text — and `kill -9` then
// hit whatever process owned it. A supervisor that had started the CLI was killed
// this way. These tests pin the parsing, the verification and the ancestor rule.
import { describe, expect, it } from "vitest";
import processScan from "../../cli/src/lib/processScan.js";

const {
  collectAppPids,
  isAppProcess,
  ownProcessChain,
  portOccupantToKill,
  parseProcessTable,
  parseWindowsProcessTable,
  maxAncestors,
} = processScan;

describe("parseProcessTable — a pid only ever comes from the pid column", () => {
  it("reads pid and command from `ps -eo pid=,command=`", () => {
    const output = [
      "    1 /sbin/init",
      "  421 node /usr/lib/9router/cli.js -p 4000 -H 0.0.0.0",
      "  512 next-server (v16.3.4)",
    ].join("\n");
    expect(parseProcessTable(output)).toEqual([
      { pid: 421, command: "node /usr/lib/9router/cli.js -p 4000 -H 0.0.0.0" },
      { pid: 512, command: "next-server (v16.3.4)" },
    ]);
  });

  it("does not wrap: continuation text never reaches the table", () => {
    // `ps` is invoked with -ww and a wide COLUMNS, so a long `node -e` command
    // stays on one line. A wrapped fragment (which could start with a number, as
    // the old `ps aux` scan happily accepted) must not appear as its own row.
    const oneLine = [
      "  707 node -e require('9router/hooks/sqliteRuntime').ensureSqliteRuntime({}); require('9router/hooks/trayRuntime').ensureTrayRuntime({})",
      "  710 node /usr/lib/9router/cli.js -p 4000",
    ].join("\n");
    expect(parseProcessTable(oneLine).map((row) => row.pid)).toEqual([707, 710]);
  });

  it("drops headers, blank lines and pid 1", () => {
    const output = ["  PID COMMAND", "", "  1 init", `  ${process.pid} node test.js`].join("\n");
    // Our own pid is parsed here and excluded later, by collectAppPids.
    expect(parseProcessTable(output).map((row) => row.pid)).toEqual([process.pid]);
  });

  it("reads the Windows process table shape", () => {
    const json = JSON.stringify([
      { ProcessId: 42, CommandLine: "C:\\app\\9router\\tray_windows_release.exe" },
      { ProcessId: 43, CommandLine: null },
    ]);
    expect(parseWindowsProcessTable(json)).toEqual([
      { pid: 42, command: "C:\\app\\9router\\tray_windows_release.exe" },
    ]);
  });
});

describe("collectAppPids — verified candidates only", () => {
  const rows = [
    { pid: 100, command: "node /app/9router/cli.js" },
    { pid: 200, command: "next-server (v16.3.4)" },
    { pid: 300, command: "vim /home/me/notes.txt" },
    { pid: 400, command: "node /app/9router/cli.js" },
  ];
  // 400 looks like one of ours in the table but the pid now runs something else.
  const live = (pid) => {
    if (pid === 400) return "vim /tmp/notes.txt";
    return rows.find((row) => row.pid === pid)?.command ?? null;
  };

  it("matches our processes and skips everything else", () => {
    expect(collectAppPids({ processes: rows, readCommand: live, exclude: new Set() })).toEqual([100, 200]);
  });

  it("never kills a number that only looked like a pid", () => {
    // The regression case: a wrapped line contributed 4096, and 4096 is a real
    // process — but not one of ours, so verification rejects it.
    const processes = [
      { pid: 100, command: "node /app/9router/cli.js" },
      { pid: 4096, command: "/home/me/app/node_modules/9router/hooks/trayRuntime.js" },
    ];
    const readCommand = (pid) => (pid === 4096 ? "postgres -D /var/lib/postgres" : "node /app/9router/cli.js");
    expect(collectAppPids({ processes, readCommand, exclude: new Set() })).toEqual([100]);
  });

  it("skips a recycled pid that no longer matches", () => {
    expect(collectAppPids({ processes: rows, readCommand: (pid) => (pid === 100 ? null : live(pid)), exclude: new Set() }))
      .toEqual([200]);
  });

  it("never targets our own process or any ancestor", () => {
    const chain = ownProcessChain(30, (pid) => (pid === 30 ? 20 : pid === 20 ? 10 : null));
    expect([...chain].sort((a, b) => a - b)).toEqual([10, 20, 30]);

    const all = [10, 20, 30].map((pid) => ({ pid, command: "node /app/9router/cli.js" }));
    const pids = collectAppPids({
      processes: all,
      readCommand: () => "node /app/9router/cli.js",
      exclude: chain,
    });
    // The supervisor (10, 20) started us; killing it would take down the thing
    // that keeps us running.
    expect(pids).toEqual([]);
  });

  it("bounds the ancestor walk", () => {
    expect(ownProcessChain(2, (pid) => pid + 1).size).toBe(maxAncestors);
  });

  it("survives a failing process listing", () => {
    expect(collectAppPids({ processes: [], readCommand: () => null, exclude: new Set() })).toEqual([]);
  });
});

describe("portOccupantToKill — who may be killed to free a port", () => {
  const chain = new Set([2, 10, 20, 30]);

  it("returns a listener that is not ours", () => {
    expect(portOccupantToKill(4242, chain)).toEqual({ pid: 4242, reason: "ok" });
  });

  it("refuses our own process tree, which is what a health-probe client looks like", () => {
    // `lsof -ti:<port>` lists clients too, and a supervisor health-checking the
    // port is the process that started us: killing it takes down the supervisor.
    expect(portOccupantToKill(20, chain)).toEqual({ pid: null, reason: "own-process-tree" });
  });

  it("ignores junk, pid 1 and missing output", () => {
    for (const candidate of [undefined, null, "", "abc", 0, 1, -5]) {
      expect(portOccupantToKill(candidate, chain)).toEqual({ pid: null, reason: "none" });
    }
  });
});

describe("isAppProcess", () => {
  it("accepts our own processes", () => {
    for (const command of [
      "node /usr/lib/node_modules/9router/cli.js",
      "next-server (v16.3.4)",
      "/usr/local/bin/cloudflared tunnel --url http://127.0.0.1:20128",
      "/home/me/.9router/runtime/tray_linux",
    ]) {
      expect(isAppProcess(command)).toBe(true);
    }
  });

  it("rejects lookalikes", () => {
    for (const command of [
      "vim /home/me/notes/9router.md",
      "grep -r 9router /var/log",
      // A shell whose command line mentions the package is not one of our
      // processes — it used to be killed by the loose substring match.
      "/bin/bash -c node --check /usr/lib/node_modules/9router/cli.js",
      "sh -c 'ps aux | grep 9router'",
      "node /home/me/scripts/other.js",
      // The updater and the npm install it runs must survive the sweep: they are
      // what is replacing the app. The old substring match killed them.
      "node /home/me/.9router/runtime/updater/updater.js",
      "npm i -g 9router@latest --prefer-online",
      "",
    ]) {
      expect(isAppProcess(command)).toBe(false);
    }
  });
});
