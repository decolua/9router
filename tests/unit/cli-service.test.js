import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

const require = createRequire(import.meta.url);

describe("9router service unit generation", () => {
  // Re-require per describe so module cache doesn't bleed mocks
  const svc = require("../../cli/src/cli/service/index.js");

  it("systemdUnitText launches custom-server.js with quoted paths + env + restart", () => {
    const text = svc.systemdUnitText(
      "/usr/bin/node",
      "/opt/durindoor/app/custom-server.js",
      "/opt/durindoor/app",
      { PORT: "20128", HOSTNAME: "0.0.0.0", NODE_ENV: "production" }
    );
    expect(text).toContain('ExecStart="/usr/bin/node" "/opt/durindoor/app/custom-server.js"');
    expect(text).toContain("Environment=PORT=20128");
    expect(text).toContain("Environment=HOSTNAME=0.0.0.0");
    expect(text).toContain("Environment=NODE_ENV=production");
    expect(text).toContain("Restart=on-failure");
    expect(text).toContain("WantedBy=default.target");
    expect(text).toContain("WorkingDirectory=/opt/durindoor/app");
  });

  it("launchdPlist has RunAtLoad, KeepAlive, ProgramArguments + env", () => {
    const plist = svc.launchdPlist("/usr/local/bin/node", "/x/custom-server.js", "/x", { PORT: "20128", NODE_ENV: "production" });
    expect(plist).toContain("<key>RunAtLoad</key><true/>");
    expect(plist).toContain("<key>KeepAlive</key><true/>");
    expect(plist).toContain("/x/custom-server.js");
    expect(plist).toContain("<key>PORT</key><string>20128</string>");
    expect(plist).toContain("com.durindoor.server");
  });

  it("systemdUnitPath is under the user systemd dir", () => {
    expect(svc.systemdUnitPath()).toMatch(/\.config\/systemd\/user\/durindoor\.service$/);
  });

  it("launchdPlistPath is under LaunchAgents", () => {
    expect(svc.launchdPlistPath()).toMatch(/Library\/LaunchAgents\/com\.durindoor\.server\.plist$/);
  });

  it("runServiceCommand refuses install when customServerPath is missing (exit 1)", () => {
    const file = path.resolve("cli/src/cli/service/index.js");
    let exitCode = 0;
    try {
      execFileSync(
        process.execPath,
        ["-e", `require(${JSON.stringify(file)}).runServiceCommand(["install"], { standaloneDir:"/tmp", customServerPath:"/tmp/does-not-exist-custom-server.js" })`],
        { stdio: "pipe" }
      );
    } catch (e) {
      exitCode = e.status ?? 1;
    }
    expect(exitCode).toBe(1);
  });

  it("runServiceCommand rejects an unknown action (exit 2)", () => {
    const file = path.resolve("cli/src/cli/service/index.js");
    let exitCode = 0;
    try {
      execFileSync(
        process.execPath,
        ["-e", `require(${JSON.stringify(file)}).runServiceCommand(["bogus"], { standaloneDir:"/tmp", customServerPath:"/tmp/x" })`],
        { stdio: "pipe" }
      );
    } catch (e) {
      exitCode = e.status ?? 2;
    }
    expect(exitCode).toBe(2);
  });
});

// ── Legacy migration tests ────────────────────────────────────────────────────
describe("migrateLegacyService (systemd)", () => {
  // We test the exported helper directly by mocking child_process.execSync
  // and fs.existsSync via module-level vi.mock. Because the module is already
  // loaded above we use the unstable_mockModule pattern with a fresh dynamic
  // import inside each test group.

  let execSyncMock;
  let existsSyncMock;
  let consoleSpy;

  beforeEach(() => {
    execSyncMock = vi.fn().mockReturnValue("");
    existsSyncMock = vi.fn().mockReturnValue(false);
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function makeMigrateCtx(execSync, existsSync) {
    // Directly invoke the exported helper by re-wiring the module internals
    // via the require-time closure approach: we call migrateLegacyService with
    // injected deps so we never shell out for real.
    const require2 = createRequire(import.meta.url);
    const svc = require2("../../cli/src/cli/service/index.js");
    return svc.migrateLegacyService({ execSync, existsSync, homeDir: "/fake-home" });
  }

  it("(a) old 9router.service present -> stop+disable attempted, no throw", () => {
    existsSyncMock.mockImplementation((p) =>
      p === "/fake-home/.config/systemd/user/9router.service"
    );
    // should not throw
    expect(() => makeMigrateCtx(execSyncMock, existsSyncMock)).not.toThrow();
    const calls = execSyncMock.mock.calls.map((c) => c[0]);
    expect(calls.some((c) => c.includes("stop 9router"))).toBe(true);
    expect(calls.some((c) => c.includes("disable 9router"))).toBe(true);
  });

  it("(b) no old artifacts -> no stop/disable attempted", () => {
    existsSyncMock.mockReturnValue(false);
    expect(() => makeMigrateCtx(execSyncMock, existsSyncMock)).not.toThrow();
    expect(execSyncMock).not.toHaveBeenCalled();
  });

  it("(c) stop throws (unit not loaded) -> caught, no error propagated", () => {
    existsSyncMock.mockImplementation((p) =>
      p === "/fake-home/.config/systemd/user/9router.service"
    );
    execSyncMock.mockImplementation((cmd) => {
      if (cmd.includes("stop 9router")) throw new Error("Unit 9router.service not loaded.");
      return "";
    });
    expect(() => makeMigrateCtx(execSyncMock, existsSyncMock)).not.toThrow();
    // disable should still be attempted despite stop failing
    const calls = execSyncMock.mock.calls.map((c) => c[0]);
    expect(calls.some((c) => c.includes("disable 9router"))).toBe(true);
  });

  it("(d) launchd plists present -> launchctl unload attempted for each", () => {
    const plist1 = "/fake-home/Library/LaunchAgents/com.9router.server.plist";
    const plist2 = "/fake-home/Library/LaunchAgents/com.9router.autostart.plist";
    existsSyncMock.mockImplementation((p) => p === plist1 || p === plist2);
    expect(() => makeMigrateCtx(execSyncMock, existsSyncMock)).not.toThrow();
    const calls = execSyncMock.mock.calls.map((c) => c[0]);
    expect(calls.some((c) => c.includes(plist1))).toBe(true);
    expect(calls.some((c) => c.includes(plist2))).toBe(true);
  });

  it("(e) launchctl unload throws -> caught, no error propagated", () => {
    const plist1 = "/fake-home/Library/LaunchAgents/com.9router.server.plist";
    existsSyncMock.mockImplementation((p) => p === plist1);
    execSyncMock.mockImplementation(() => { throw new Error("No such file"); });
    expect(() => makeMigrateCtx(execSyncMock, existsSyncMock)).not.toThrow();
  });
});

// ── Install-path integration: runServiceCommand calls migrateLegacyService ──
describe("runServiceCommand install calls migrateLegacyService first", () => {
  it("old 9router.service exists -> stop+disable run before install writes unit", () => {
    const file = path.resolve("cli/src/cli/service/index.js");
    // customServerPath is a distinct fake path (not the legacy unit path).
    // existsSync returns true for BOTH so the custom-server guard passes AND
    // the legacy artifact is detected.
    const script = `
const os = require("os");
const path = require("path");
const homeDir = os.homedir();
const legacyUnit = path.join(homeDir, ".config", "systemd", "user", "9router.service");
const fakeCustomServer = "/fake/standalone/custom-server.js";

const calls = [];
const cp = require("child_process");
cp.execSync = (cmd, opts) => { calls.push(cmd); return ""; };

const fs = require("fs");
fs.existsSync = (p) => p === legacyUnit || p === fakeCustomServer;
fs.mkdirSync = () => {};
fs.writeFileSync = () => {};

const svc = require(${JSON.stringify(file)});
svc.runServiceCommand(["install"], {
  standaloneDir: "/fake/standalone",
  customServerPath: fakeCustomServer,
  port: 20128,
  host: "0.0.0.0",
});

const stopped = calls.some(c => c.includes("stop 9router"));
const disabled = calls.some(c => c.includes("disable 9router"));
const daemonReload = calls.some(c => c.includes("daemon-reload"));
const enabled = calls.some(c => c.includes("enable --now durindoor"));
if (!stopped)     { console.error("FAIL: stop 9router not called"); process.exit(1); }
if (!disabled)    { console.error("FAIL: disable 9router not called"); process.exit(1); }
if (!daemonReload){ console.error("FAIL: daemon-reload not called"); process.exit(1); }
if (!enabled)     { console.error("FAIL: enable --now durindoor not called"); process.exit(1); }
console.log("OK");
`;
    let out = "", exitCode = 0;
    try {
      out = execFileSync(process.execPath, ["-e", script], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) { exitCode = e.status ?? 1; out = (e.stdout || "") + (e.stderr || ""); }
    expect(exitCode, out).toBe(0);
    expect(out).toContain("OK");
  });

  it("no legacy artifacts -> install succeeds without stop/disable", () => {
    const file = path.resolve("cli/src/cli/service/index.js");
    // customServerPath is distinct from all legacy paths; existsSync only
    // returns true for it so the custom-server guard passes but migration
    // finds no legacy artifacts.
    const script = `
const os = require("os");
const path = require("path");
const fakeCustomServer = "/fake/standalone/custom-server.js";

const calls = [];
const cp = require("child_process");
cp.execSync = (cmd, opts) => { calls.push(cmd); return ""; };

const fs = require("fs");
fs.existsSync = (p) => p === fakeCustomServer;
fs.mkdirSync = () => {};
fs.writeFileSync = () => {};

const svc = require(${JSON.stringify(file)});
svc.runServiceCommand(["install"], {
  standaloneDir: "/fake/standalone",
  customServerPath: fakeCustomServer,
  port: 20128,
  host: "0.0.0.0",
});

const stopped = calls.some(c => c.includes("stop 9router"));
const disabled = calls.some(c => c.includes("disable 9router"));
if (stopped || disabled) { console.error("FAIL: unexpected legacy stop/disable"); process.exit(1); }
console.log("OK");
`;
    let out = "", exitCode = 0;
    try {
      out = execFileSync(process.execPath, ["-e", script], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) { exitCode = e.status ?? 1; out = (e.stdout || "") + (e.stderr || ""); }
    expect(exitCode, out).toBe(0);
    expect(out).toContain("OK");
  });

  it("stop throws -> install still succeeds (non-fatal)", () => {
    const file = path.resolve("cli/src/cli/service/index.js");
    const script = `
const os = require("os");
const path = require("path");
const homeDir = os.homedir();
const legacyUnit = path.join(homeDir, ".config", "systemd", "user", "9router.service");
const fakeCustomServer = "/fake/standalone/custom-server.js";

const cp = require("child_process");
cp.execSync = (cmd, opts) => {
  if (cmd.includes("stop 9router")) throw new Error("Unit not loaded.");
  return "";
};

const fs = require("fs");
fs.existsSync = (p) => p === legacyUnit || p === fakeCustomServer;
fs.mkdirSync = () => {};
fs.writeFileSync = () => {};

const svc = require(${JSON.stringify(file)});
svc.runServiceCommand(["install"], {
  standaloneDir: "/fake/standalone",
  customServerPath: fakeCustomServer,
  port: 20128,
  host: "0.0.0.0",
});
console.log("OK");
`;
    let out = "", exitCode = 0;
    try {
      out = execFileSync(process.execPath, ["-e", script], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) { exitCode = e.status ?? 1; out = (e.stdout || "") + (e.stderr || ""); }
    expect(exitCode, out).toBe(0);
    expect(out).toContain("OK");
  });
});
