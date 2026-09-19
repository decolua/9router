/**
 * F23 (T1.6 M2) — launcher process ownership.
 *
 * The old matcher SIGKILLed anything whose cmdline contained "9router" plus
 * every "next-server" process on the host (i.e. every unrelated Next.js app,
 * `grep 9router`, editors, and this repo's own dev server via
 * "/9router" matching "/9router-enhanced"). These tests pin the replacement:
 * an exact-installed-path / cwd / port-LISTEN matcher over FAKE process
 * tables. Nothing here lists or signals real processes.
 */
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const cli = require("../../cli/cli.js");

const INSTALL = "/opt/npm/lib/node_modules/9router/cli";
const OPTS = {
  selfPid: 100,
  ownedPaths: [`${INSTALL}/cli.js`, `${INSTALL}/app/custom-server.js`],
  ownedDirs: [`${INSTALL}/app`, `${INSTALL}`],
  caseInsensitive: false,
  resolveCwd: null,
};

describe("isOwnAppProcess — exact-path ownership (never cmdline substrings)", () => {
  it("matches the launcher by its installed cli.js path", () => {
    const e = { pid: 11, cmd: `/usr/bin/node --dns-result-order=ipv4first ${INSTALL}/cli.js --tray --skip-update -p 20128` };
    expect(cli.isOwnAppProcess(e, OPTS)).toBe(true);
  });

  it("matches the standalone server by its exact server path", () => {
    const e = { pid: 12, cmd: `/usr/bin/node --max-old-space-size=6144 ${INSTALL}/app/custom-server.js` };
    expect(cli.isOwnAppProcess(e, OPTS)).toBe(true);
  });

  it("matches a Go tray binary living under the install tree", () => {
    const e = { pid: 13, cmd: `${INSTALL}/node_modules/systray2/traybin/tray_linux_release -u ipc://x` };
    expect(cli.isOwnAppProcess(e, OPTS)).toBe(true);
  });

  it("NEVER matches a third-party next-server (the old kill-everything branch)", () => {
    const e = { pid: 21, cmd: "next-server (v15.5.4)" };
    expect(cli.isOwnAppProcess(e, { ...OPTS, resolveCwd: () => "/home/u/some-shop" })).toBe(false);
    expect(cli.isOwnAppProcess(e, { ...OPTS, resolveCwd: null })).toBe(false);
  });

  it("matches THIS app's title-rewritten standalone server only by cwd", () => {
    const e = { pid: 22, cmd: "next-server (v15.5.4)" };
    expect(cli.isOwnAppProcess(e, { ...OPTS, resolveCwd: () => `${INSTALL}/app` })).toBe(true);
  });

  it("does NOT match this repo's own dev server (the /9router ⊂ /9router-enhanced trap)", () => {
    const e = { pid: 23, cmd: "node /home/scursel/9router-enhanced/node_modules/.bin/next dev -p 20127", cwd: "/home/scursel/9router-enhanced" };
    const opts = {
      selfPid: 100,
      ownedPaths: ["/home/scursel/9router-enhanced/cli/cli.js", "/home/scursel/9router-enhanced/cli/app/custom-server.js"],
      ownedDirs: ["/home/scursel/9router-enhanced/cli/app", "/home/scursel/9router-enhanced/cli"],
      resolveCwd: () => e.cwd,
    };
    expect(cli.isOwnAppProcess(e, opts)).toBe(false);
  });

  it("does NOT match incidental \"9router\" mentions (grep, tail, editor, user named 9router)", () => {
    for (const cmd of [
      "grep -r 9router README.md",
      `tail -f /home/9router/.9router/server.log`,
      "vim /home/u/9router-notes/todo.txt",
      "/usr/bin/node /home/u/other-app/server.js",
    ]) {
      expect(cli.isOwnAppProcess({ pid: 31, cmd }, OPTS)).toBe(false);
    }
  });

  it("refuses to match itself", () => {
    const e = { pid: 100, cmd: `node ${INSTALL}/cli.js` };
    expect(cli.isOwnAppProcess(e, OPTS)).toBe(false);
  });

  it("path-boundary: a directory needle cannot match inside a longer name", () => {
    // The install dir "<root>/cli" owns files UNDER it (that's the tray rule);
    // it must not own the sibling "<root>/clitools", where "cli" is a prefix
    // of a longer path element.
    const e = { pid: 41, cmd: `node /opt/npm/lib/node_modules/9router/clitools/index.js` };
    expect(cli.isOwnAppProcess(e, OPTS)).toBe(false);
    const e2 = { pid: 42, cmd: `node /inst/cli/app-old/server.js` };
    const opts2 = { selfPid: 100, ownedPaths: [], ownedDirs: ["/inst/cli/app"] };
    expect(cli.isOwnAppProcess(e2, opts2)).toBe(false);
  });

  it("file needle cannot match a sibling with an extension suffix (cli.js vs cli.js.map)", () => {
    // ownedDirs empty here: isolate the FILE-needle rule (a dir needle owns
    // what genuinely lives under it, including a stray .map).
    const e = { pid: 43, cmd: `node --stack-trace /opt/npm/lib/node_modules/other/cli.js.map` };
    const opts = {
      selfPid: 100,
      ownedPaths: ["/opt/npm/lib/node_modules/other/cli.js"],
      ownedDirs: [],
      caseInsensitive: false,
      resolveCwd: null,
    };
    expect(cli.isOwnAppProcess(e, opts)).toBe(false);
    expect(cli.isOwnAppProcess({ pid: 44, cmd: `/usr/bin/node /opt/npm/lib/node_modules/other/cli.js` }, opts)).toBe(true);
  });

  it("case-insensitive mode for the Windows branch", () => {
    const e = { pid: 44, cmd: "C:\\Program Files\\NODEJS\\NODE.EXE C:\\NPM\\9ROUTER\\CLI\\CLI.JS --tray" };
    const opts = {
      selfPid: 100,
      ownedPaths: ["c:\\npm\\9router\\cli\\cli.js"],
      ownedDirs: ["c:\\npm\\9router\\cli\\app"],
      caseInsensitive: true,
    };
    expect(cli.isOwnAppProcess(e, opts)).toBe(true);
  });
});

describe("process-table parsers", () => {
  it("parsePidCommand: `ps -eo pid=,command=` rows", () => {
    expect(cli.parsePidCommand("  4242 /usr/bin/node /opt/x/app/custom-server.js")).toEqual({ pid: "4242", cmd: "/usr/bin/node /opt/x/app/custom-server.js" });
    expect(cli.parsePidCommand("PID COMMAND")).toBe(null);
    expect(cli.parsePidCommand("   7 ps -eo pid=,command=")).toEqual({ pid: "7", cmd: "ps -eo pid=,command=" });
  });

  it("parseWmiCsvEntry: WMI ConvertTo-Csv rows", () => {
    expect(cli.parseWmiCsvEntry('"4242","C:\\Program Files\\nodejs\\node.exe  C:\\npm\\9router\\cli\\cli.js"')).toEqual({ pid: "4242", cmd: "C:\\Program Files\\nodejs\\node.exe  C:\\npm\\9router\\cli\\cli.js" });
    expect(cli.parseWmiCsvEntry("ProcessId,CommandLine")).toBe(null);
  });

  it("collectOwnAppPids filters a fake process table (the third-party next-server survives)", () => {
    const entries = [
      { pid: "101", cmd: `node ${INSTALL}/cli.js` },                          // old launcher — ours
      { pid: "102", cmd: `node ${INSTALL}/app/custom-server.js` },            // old server — ours
      { pid: "103", cmd: "next-server (v14.2.3)" },                           // foreign Next — NOT ours (cwd differs)
      { pid: "104", cmd: "tail -f ~/.9router/server.log" },                   // noise — NOT ours
    ];
    const cwds = { 103: "/home/u/shop/.next", 104: "/home/u" };
    const picked = cli.collectOwnAppPids(entries, { ...OPTS, resolveCwd: (pid) => cwds[pid] ?? null });
    expect(picked.map((e) => e.pid)).toEqual(["101", "102"]);
  });
});
