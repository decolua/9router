/**
 * F23 (T1.6 M2) — server-side process matching (src/lib/appUpdater.js).
 *
 * killAppProcesses() used to accept ANY process whose line contained
 * "9router", "next-server", "cloudflared" or "cli.js" and SIGKILL it — so a
 * `tail -f ~/.9router/server.log`, an unrelated Next.js dev server, or the
 * user's own cloudflared tunnel to another app died when someone clicked
 * "update" in the dashboard.
 *
 * Same rules as the launcher's matcher, and the SAME shared case matrix runs
 * against both implementations on purpose: the two live in different packages
 * (cli/ is standalone CJS; src/ is the bundled server) and cannot import each
 * other — a drifting duplicate is exactly how H1 happened.
 *
 * Fake process tables only; nothing real is listed or signalled.
 */
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import {
  isOwnAppProcess,
  parsePidCommand,
  parseWmiCsvEntry,
  collectTunnelPids,
} from "@/lib/appUpdater.js";

const require = createRequire(import.meta.url);
const cli = require("../../cli/cli.js");

const INSTALL = "/opt/npm/lib/node_modules/9router/cli";
const RUNTIME_NM = "/home/u/.9router/runtime/node_modules";
const PORT = "20128";

const OWN_OPTS = {
  selfPid: 100,
  ownedPaths: [`${INSTALL}/cli.js`, `${INSTALL}/app/custom-server.js`],
  ownedDirs: [`${INSTALL}`, `${INSTALL}/app`, RUNTIME_NM],
  caseInsensitive: false,
  resolveCwd: null,
};

// One matrix, both implementations.
const MATRIX = [
  // [should-be-killed, cmd, why]
  [true, `node ${INSTALL}/cli.js --tray --skip-update -p 20128`, "our launcher"],
  [true, `node --max-old-space-size=6144 ${INSTALL}/app/custom-server.js`, "our standalone server"],
  [true, `${INSTALL}/node_modules/systray2/traybin/tray_linux_release -u ipc://1`, "our tray (install tree)"],
  [true, `${RUNTIME_NM}/systray2/traybin/tray_linux_release -u ipc://1`, "our tray (runtime dir)"],
  [false, "next-server (v15.5.4)", "foreign Next.js app (title-only, wrong cwd)"],
  [false, "node /home/u/shop/.next/standalone/server.js", "another Next project"],
  [false, "grep -rn 9router /home/u/docs", "cmdline substring noise"],
  [false, "tail -f /home/u/.9router/server.log", "watching OUR log ≠ our process"],
  [false, "/usr/bin/node /opt/npm/lib/node_modules/9router-old/cli/cli.js", "prefix trap (9router-old)"],
  [false, "vim /home/u/repos/9router-enhanced/README.md", "the /9router ⊂ /9router-enhanced trap"],
];

describe("appUpdater ownership predicate — shared matrix with the launcher (no-drift gate)", () => {
  for (const [shouldKill, cmd, why] of MATRIX) {
    it(`${shouldKill ? "kills" : "spares"}: ${why}`, () => {
      const e = { pid: 4242, cmd };
      expect(isOwnAppProcess(e, OWN_OPTS)).toBe(shouldKill);
      // the launcher's copy must agree verdict-for-verdict:
      expect(cli.isOwnAppProcess(e, OWN_OPTS)).toBe(shouldKill);
    });
  }

  it("never matches the server's own pid (the caller runs inside it)", () => {
    expect(isOwnAppProcess({ pid: 100, cmd: `node ${INSTALL}/app/custom-server.js` }, OWN_OPTS)).toBe(false);
  });

  it("cwd rule: title-rewritten standalone server is matched ONLY when cwd is our app dir", () => {
    const foreign = { pid: 55, cmd: "next-server (v14.2.3)" };
    expect(isOwnAppProcess(foreign, { ...OWN_OPTS, resolveCwd: () => `${INSTALL}/app` })).toBe(true);
    expect(isOwnAppProcess(foreign, { ...OWN_OPTS, resolveCwd: () => "/home/u/shop" })).toBe(false);
    expect(cli.isOwnAppProcess(foreign, { ...OWN_OPTS, resolveCwd: () => `${INSTALL}/app` })).toBe(true);
    expect(cli.isOwnAppProcess(foreign, { ...OWN_OPTS, resolveCwd: () => "/home/u/shop" })).toBe(false);
  });

  it("windows WMI: case-insensitive installed path matches", () => {
    const opts = {
      selfPid: 100,
      ownedPaths: ["c:\\npm\\9router\\cli\\cli.js"],
      ownedDirs: ["c:\\npm\\9router\\cli"],
      caseInsensitive: true,
      resolveCwd: null,
    };
    const e = { pid: 66, cmd: "C:\\Program Files\\NODEJS\\NODE.EXE  C:\\NPM\\9router\\CLI\\cli.js --tray" };
    expect(isOwnAppProcess(e, opts)).toBe(true);
    expect(cli.isOwnAppProcess(e, opts)).toBe(true);
  });

  it("parsers agree with the launcher's", () => {
    expect(parsePidCommand("  42 /usr/bin/node /opt/x/cli.js")).toEqual({ pid: "42", cmd: "/usr/bin/node /opt/x/cli.js" });
    expect(cli.parsePidCommand("  42 /usr/bin/node /opt/x/cli.js")).toEqual({ pid: "42", cmd: "/usr/bin/node /opt/x/cli.js" });
    expect(parseWmiCsvEntry('"7","node.exe  C:\\a\\cli.js"')).toEqual({ pid: "7", cmd: "node.exe  C:\\a\\cli.js" });
  });
});

describe("collectTunnelPids — cloudflared only when it fronts OUR port", () => {
  const entries = [
    { pid: "301", cmd: "cloudflared tunnel --url http://localhost:20128" },
    { pid: "302", cmd: "cloudflared tunnel --url http://127.0.0.1:20128 --no-autoupdate" },
    { pid: "303", cmd: "cloudflared access tcp --hostname shop.internal --url localhost:3000" }, // another app
    { pid: "304", cmd: "cloudflared --url http://localhost:201280" }, // port-prefix trap: 201280 ≠ 20128
  ];

  it("matches tunnels aimed at the app port", () => {
    expect(collectTunnelPids(entries, PORT)).toEqual(["301", "302"]);
  });

  it("returns nothing for a port nobody tunnels to", () => {
    expect(collectTunnelPids(entries, "9999")).toEqual([]);
  });
});
