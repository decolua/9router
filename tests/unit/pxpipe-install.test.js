// PXPIPE installer lifecycle: shell-free Windows npm-cli invocation, bounded
// leak-safe diagnostics, fd/timer/settlement hygiene. Mock-only — never runs a
// real package manager, network, or live PXPIPE.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  execSync: vi.fn(() => Buffer.from("/usr/bin/npm\n")),
  // Default: no where.exe output (no fallback candidates).
  execFileSync: vi.fn(() => ""),
  closeCalls: 0,
  // Optional statSync gate: return false for a path to make it vanish (ENOENT).
  state: { dataDir: "", statGate: null },
}));

vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, spawn: mocks.spawn, execSync: mocks.execSync, execFileSync: mocks.execFileSync };
});

// Wrap closeSync (truthful fd counts) and gate statSync so Windows resolution
// is controllable without touching the real node install.
vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal();
  const closeSync = (...args) => {
    mocks.closeCalls += 1;
    return actual.closeSync(...args);
  };
  const statSync = (...args) => {
    const p = String(args[0]);
    if (typeof mocks.state.statGate === "function" && !mocks.state.statGate(p)) {
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    }
    return actual.statSync(...args);
  };
  return { ...actual, default: { ...(actual.default || {}), closeSync, statSync }, closeSync, statSync };
});

vi.mock("@/lib/dataDir.js", () => ({
  get DATA_DIR() {
    return mocks.state.dataDir;
  },
}));

const REAL_PLATFORM = process.platform;
// Capture at module load — beforeEach deletes these; afterEach must restore
// exact originals (delete when undefined, assign otherwise) or the leak
// poisons sibling test files.
const REAL_SYSTEM_ROOT = Object.prototype.hasOwnProperty.call(process.env, "SystemRoot")
  ? process.env.SystemRoot
  : undefined;
const REAL_WINDIR = Object.prototype.hasOwnProperty.call(process.env, "WINDIR")
  ? process.env.WINDIR
  : undefined;

function restoreEnv(name, original) {
  if (original === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = original;
  }
}

const INSTALL_TIMEOUT_MS = 5 * 60 * 1000;
let mod;

function setPlatform(p) {
  Object.defineProperty(process, "platform", { value: p, configurable: true });
}

async function load(platform) {
  setPlatform(platform);
  vi.resetModules();
  mod = await import("../../src/lib/pxpipe/install.js");
  return mod;
}

function makeChild(pid = 4242) {
  const child = new EventEmitter();
  child.pid = pid;
  child.kill = vi.fn();
  return child;
}

function seedPackage(version = "1.2.3") {
  const root = mod.packageRoot();
  fs.mkdirSync(path.join(root, "dist", "core"), { recursive: true });
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "pxpipe-proxy", version }));
  fs.writeFileSync(path.join(root, "dist", "core", "library.js"), "export {};");
}

// Seed a fake node layout: <dir>/node_modules/npm/bin/npm-cli.js beside <dir>/node.exe.
function seedNpmCli(nodeExecutable) {
  const cli = path.join(path.dirname(nodeExecutable), "node_modules", "npm", "bin", "npm-cli.js");
  fs.mkdirSync(path.dirname(cli), { recursive: true });
  fs.writeFileSync(cli, "// fake npm-cli");
  return cli;
}

function readLog() {
  return fs.readFileSync(path.join(mocks.state.dataDir, "pxpipe", "install.log"), "utf8");
}

beforeEach(() => {
  mocks.state.dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-pxpipe-install-"));
  mocks.state.statGate = null;
  mocks.spawn.mockReset();
  mocks.execSync.mockReset().mockImplementation(() => Buffer.from("/usr/bin/npm\n"));
  mocks.execFileSync.mockReset().mockImplementation(() => "");
  mocks.closeCalls = 0;
  delete process.env.SystemRoot;
  delete process.env.WINDIR;
  // Default SystemRoot so Windows fallback has a where.exe path; individual
  // tests override to test fail-closed behavior.
  process.env.SystemRoot = "C:\\Windows";
});

afterEach(() => {
  setPlatform(REAL_PLATFORM);
  vi.useRealTimers();
  restoreEnv("SystemRoot", REAL_SYSTEM_ROOT);
  restoreEnv("WINDIR", REAL_WINDIR);
  vi.resetModules();
  try {
    fs.rmSync(mocks.state.dataDir, { recursive: true, force: true });
  } catch {}
});

describe("pxpipe install spawn options", () => {
  it("windows: spawns node + npm-cli.js with exact argv and NO shell", async () => {
    await load("win32");
    seedPackage();
    const cli = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
    const child = makeChild();
    mocks.spawn.mockImplementation(() => child);

    const p = mod.installPxpipe();
    child.emit("exit", 0);
    const info = await p;

    expect(mocks.spawn).toHaveBeenCalledTimes(1);
    const [cmd, args, opts] = mocks.spawn.mock.calls[0];
    expect(cmd).toBe(process.execPath);
    expect(args[0]).toBe(cli);
    expect(args.slice(1)).toEqual(["install", "pxpipe-proxy@latest", "--no-audit", "--no-fund", "--omit=dev"]);
    expect(opts.shell).toBe(false);
    expect(opts).not.toHaveProperty("shell", true);
    expect(info).toEqual({ installed: true, version: "1.2.3", path: mod.packageRoot() });
  });

  it("windows: missing/invalid npm-cli fails closed with NPM_NOT_FOUND and never spawns", async () => {
    await load("win32");
    // Gate primary adjacent npm-cli.js as missing and ensure fallback
    // candidates are also absent so the fallback cannot save it.
    mocks.state.statGate = (p) => !String(p).endsWith("npm-cli.js");
    // No where.exe candidates.
    mocks.execFileSync.mockReset().mockImplementation(() => "");

    let caught;
    await mod.installPxpipe().then(
      () => {},
      (e) => {
        caught = e;
      },
    );
    expect(caught.code).toBe("NPM_NOT_FOUND");
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(mocks.closeCalls).toBe(0);
  });

  it("windows resolver: spaces/metacharacter node path yields ONE argv element, no shell string", async () => {
    await load("win32");
    const weirdNode = path.join(mocks.state.dataDir, "Pro gram Files (x86) & ; 'quote'\\node.exe");
    const cli = seedNpmCli(weirdNode);

    // Resolver returns only the trusted prefix (command + cli atom);
    // INSTALL_ARGS are appended later at spawn time as discrete argv entries.
    const inv = mod.resolveNpmInvocation(weirdNode);

    expect(inv.command).toBe(weirdNode);
    expect(inv.args).toEqual([cli]);
    expect(inv.args[0]).not.toContain(" && ");
    // Full argv stays shell-free: prefix + install args as distinct elements.
    const fullArgv = [...inv.args, "install", "pxpipe-proxy@latest", "--no-audit", "--no-fund", "--omit=dev"];
    expect(fullArgv[0]).toBe(cli);
    expect(fullArgv).not.toContain(" && ");
  });

  it("windows Bun-like execPath: primary missing, where.exe fallback finds valid node+cli, spawns exact argv", async () => {
    await load("win32");
    // Simulate bun.exe primary with no adjacent npm — fallback must pick the
    // valid candidate. Need a real on-disk node file at the valid path so
    // isFile(candidate) passes; create that and gate bad candidate's node file.
    const badNode = path.join(mocks.state.dataDir, "Pro gram Files (x86) & ; 'quote'", "node.exe");
    const goodNode = path.join(mocks.state.dataDir, "Node Dir With Spaces & Co", "node.exe");
    const badCli = seedNpmCli(badNode); // cli exists but its node file will be gated missing
    const goodCli = seedNpmCli(goodNode);
    // Also ensure the valid node's file itself exists for isFile(candidate).
    fs.mkdirSync(path.dirname(goodNode), { recursive: true });
    fs.writeFileSync(goodNode, "");

    // Primary (beside process.execPath) gated missing; invalid candidate's
    // node file gated missing so only goodNode survives verification.
    mocks.state.statGate = (p) => {
      const s = String(p);
      if (s === badNode) return false;
      if (s.endsWith("npm-cli.js") && s.startsWith(path.dirname(process.execPath))) return false;
      return true;
    };
    mocks.execFileSync.mockImplementation(() => Buffer.from(`${badNode}\r\n${goodNode}\r\n`));

    const child = makeChild();
    mocks.spawn.mockImplementation(() => child);
    seedPackage();
    const p = mod.installPxpipe();
    child.emit("exit", 0);
    await p;

    expect(mocks.spawn).toHaveBeenCalledTimes(1);
    const [cmd, args, opts] = mocks.spawn.mock.calls[0];
    expect(cmd).toBe(goodNode);
    expect(args[0]).toBe(goodCli);
    expect(args.slice(1)).toEqual(["install", "pxpipe-proxy@latest", "--no-audit", "--no-fund", "--omit=dev"]);
    expect(opts.shell).toBe(false);

    const [whereCmd, whereArgs, whereOpts] = mocks.execFileSync.mock.calls[0];
    expect(whereCmd.toLowerCase()).toBe("c:\\windows\\system32\\where.exe");
    expect(whereArgs).toEqual(["node.exe"]);
    expect(whereOpts.shell).toBe(false);
    expect(whereOpts.encoding).toBe("utf8");
    expect(String(JSON.stringify(whereOpts.env.PATH))).not.toContain("undefined");
  });

  it("windows fallback locator: absolute where.exe, args ['node.exe'], never npm.cmd, no shell string", async () => {
    await load("win32");
    const bunPath = path.join(mocks.state.dataDir, "bun-dir", "bun.exe");
    const goodNode = path.join(mocks.state.dataDir, "Node Dir & More", "node.exe");
    const goodCli = seedNpmCli(goodNode);
    fs.writeFileSync(goodNode, "");
    mocks.state.statGate = (p) =>
      !(String(p).startsWith(path.dirname(process.execPath)) && String(p).endsWith("npm-cli.js"));

    mocks.execFileSync.mockImplementation(() => Buffer.from(`${goodNode}\r\nC:\\fake\\npm.cmd\r\n`));

    const inv = mod.resolveNpmInvocation(bunPath);

    expect(mocks.execFileSync).toHaveBeenCalledTimes(1);
    const [whereCmd, whereArgs, whereOpts] = mocks.execFileSync.mock.calls[0];
    expect(whereCmd).toBe(path.join("C:\\Windows", "System32", "where.exe"));
    expect(whereArgs).toEqual(["node.exe"]);
    expect(whereOpts.shell).toBe(false);
    expect(whereOpts.encoding).toBe("utf8");

    // Only the verified node+cli pair wins; npm.cmd is never trusted.
    expect(inv.command).toBe(goodNode);
    expect(inv.args[0]).toBe(goodCli);
    expect(inv.args.join(" ")).not.toContain("npm.cmd");
  });

  it("windows: missing SystemRoot fails closed NPM_NOT_FOUND without spawning or calling where.exe", async () => {
    await load("win32");
    delete process.env.SystemRoot;
    delete process.env.WINDIR;
    // Gate primary adjacent cli missing so resolution reaches the fallback.
    mocks.state.statGate = (p) =>
      !(String(p).startsWith(path.dirname(process.execPath)) && String(p).endsWith("npm-cli.js"));

    let caught;
    await mod.installPxpipe().then(
      () => {},
      (e) => {
        caught = e;
      },
    );
    expect(caught.code).toBe("NPM_NOT_FOUND");
    expect(mocks.execFileSync).not.toHaveBeenCalled();
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(mocks.closeCalls).toBe(0);
  });

  it("windows: where.exe candidates but no valid node+cli pair yields NPM_NOT_FOUND, no spawn", async () => {
    await load("win32");
    // Gate ALL statSync calls to fail (candidate files + adjacent clis all
    // missing) so no candidate pair can verify.
    mocks.state.statGate = () => false;
    mocks.execFileSync.mockImplementation(() => Buffer.from("C:\\nowhere\\node.exe\r\nD:\\alsonowhere\\node.exe\r\n"));

    let caught;
    await mod.installPxpipe().then(
      () => {},
      (e) => {
        caught = e;
      },
    );
    expect(caught.code).toBe("NPM_NOT_FOUND");
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(mocks.closeCalls).toBe(0);
  });

  it("non-windows: direct spawn of resolved npm with explicit shell:false", async () => {
    await load("linux");
    mocks.execSync.mockImplementation(() => Buffer.from("/usr/bin/npm\n"));
    seedPackage();
    const child = makeChild();
    mocks.spawn.mockImplementation(() => child);

    const p = mod.installPxpipe();
    child.emit("exit", 0);
    await p;

    const [cmd, args, opts] = mocks.spawn.mock.calls[0];
    expect(cmd).toBe("/usr/bin/npm");
    expect(args).toEqual(["install", "pxpipe-proxy@latest", "--no-audit", "--no-fund", "--omit=dev"]);
    expect(opts).toHaveProperty("shell", false);
  });
});

describe("pxpipe install failure hygiene", () => {
  it("sync spawn EINVAL: bounded code preserved, fixed diagnostic, fd closed once, no path/message leak", async () => {
    await load("win32");
    const boom = Object.assign(new Error("spawn npm.cmd EINVAL"), {
      code: "EINVAL",
      errno: -4070,
      syscall: "spawn",
      path: "C:\\fake\\npm.cmd",
    });
    mocks.spawn.mockImplementation(() => {
      throw boom;
    });

    const caught = await mod.installPxpipe().then(
      () => null,
      (e) => e,
    );
    expect(caught.code).toBe("EINVAL");
    expect(caught.message).not.toContain("C:");
    expect(caught.message).not.toContain("errno");

    const log = readLog();
    expect(log).toContain("spawn failed: EINVAL");
    expect(log).not.toContain("C:");
    expect(log).not.toContain(mocks.state.dataDir);
    expect(log).not.toContain("spawn npm.cmd");
    expect(log).not.toContain("-4070");
    expect(mocks.closeCalls).toBe(1);
  });

  it("async error then exit: settles once, timer cleared, fd closed once, bounded diagnostic", async () => {
    vi.useFakeTimers();
    await load("win32");
    const child = makeChild();
    mocks.spawn.mockImplementation(() => child);

    const p = mod.installPxpipe();
    const expectation = expect(p).rejects.toMatchObject({ code: "EINVAL" });
    child.emit("error", Object.assign(new Error("spawn FAILED\nPATH=C:\\leak"), { code: "EINVAL" }));
    child.emit("exit", 0);
    await expectation;

    // Late events (timeout fire, second exit) change nothing.
    const logAfterSettle = readLog();
    await vi.advanceTimersByTimeAsync(INSTALL_TIMEOUT_MS + 1000);
    child.emit("exit", 0);
    expect(readLog()).toBe(logAfterSettle);
    expect(logAfterSettle).toContain("spawn error: EINVAL");
    expect((logAfterSettle.match(/spawn error:/g) || []).length).toBe(1);
    expect(logAfterSettle).not.toContain("C:");
    expect(mocks.closeCalls).toBe(1);
  });

  it("nonzero exit: bounded diagnostic, single rejection, fd closed once", async () => {
    vi.useFakeTimers();
    await load("win32");
    const child = makeChild();
    mocks.spawn.mockImplementation(() => child);

    const p = mod.installPxpipe();
    const expectation = expect(p).rejects.toMatchObject({ code: "INSTALL_EXIT_3" });
    child.emit("exit", 3);
    await expectation;

    await vi.advanceTimersByTimeAsync(INSTALL_TIMEOUT_MS + 1000);
    const log = readLog();
    expect(log).toContain("exit code 3");
    expect(log).not.toContain(mocks.state.dataDir);
    expect(mocks.closeCalls).toBe(1);

    let rejections = 0;
    p.catch(() => {
      rejections += 1;
    });
    await Promise.resolve();
    child.emit("error", new Error("late"));
    await Promise.resolve();
    expect(rejections).toBeLessThanOrEqual(1);
  });

  it("timeout: fixed diagnostic written, child killed, rejects once, fd closed once", async () => {
    vi.useFakeTimers();
    await load("win32");
    const child = makeChild();
    mocks.spawn.mockImplementation(() => child);

    const p = mod.installPxpipe();
    const expectation = expect(p).rejects.toMatchObject({ code: "INSTALL_TIMEOUT" });
    await vi.advanceTimersByTimeAsync(INSTALL_TIMEOUT_MS);
    await expectation;

    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
    const log = readLog();
    expect(log).toContain("npm install timed out after 5 minutes");
    expect(log).not.toContain(mocks.state.dataDir);
    expect(mocks.closeCalls).toBe(1);

    // Late exit/error after timeout must not re-close or append a duplicate diagnostic.
    child.emit("exit", 3);
    child.emit("error", Object.assign(new Error("late"), { code: "EFOO" }));
    expect(readLog()).toBe(log);
    expect((readLog().match(/timed out/g) || []).length).toBe(1);
    expect(readLog()).not.toContain("EFOO");
    expect(mocks.closeCalls).toBe(1);
  });

  it("signal exit (null, SIGTERM): bounded INSTALL_SIGNAL_SIGTERM, no exit code 0", async () => {
    vi.useFakeTimers();
    await load("win32");
    const child = makeChild();
    mocks.spawn.mockImplementation(() => child);

    const p = mod.installPxpipe();
    const expectation = expect(p).rejects.toMatchObject({ code: "INSTALL_SIGNAL_SIGTERM" });
    child.emit("exit", null, "SIGTERM");
    await expectation;

    const log = readLog();
    expect(log).toContain("signal SIGTERM");
    expect(log).not.toContain("exit code 0");
    expect(log).not.toContain(mocks.state.dataDir);
    // Signal path logs with "exited with signal ..."; count any "npm install" line.
    expect((log.match(/npm install/g) || []).length).toBe(2); // header + signal diagnostic
    expect(log).toContain("exited with signal");
    expect(mocks.closeCalls).toBe(1);

    // Late events stay silent after settle.
    const logAfterSettle = log;
    child.emit("exit", 0);
    child.emit("error", Object.assign(new Error("late"), { code: "ELATE" }));
    expect(readLog()).toBe(logAfterSettle);
    expect(readLog()).not.toContain("ELATE");
  });

  it("signal exit with unsafe signal string: falls back to bounded INSTALL_FAILED, no raw leak", async () => {
    vi.useFakeTimers();
    await load("win32");
    const child = makeChild();
    mocks.spawn.mockImplementation(() => child);

    // Unsafe charset in signal must not survive diagCode.
    const unsafeSignal = "SIG<X> && rm -rf";
    const p = mod.installPxpipe();
    const expectation = expect(p).rejects.toMatchObject({ code: "INSTALL_FAILED" });
    child.emit("exit", null, unsafeSignal);
    await expectation;

    const log = readLog();
    expect(log).not.toContain(unsafeSignal);
    expect(log).toContain("signal");
    expect(mocks.closeCalls).toBe(1);
  });

  it("late error after nonzero exit does not append duplicate diagnostic", async () => {
    vi.useFakeTimers();
    await load("win32");
    const child = makeChild();
    mocks.spawn.mockImplementation(() => child);

    const p = mod.installPxpipe();
    const expectation = expect(p).rejects.toMatchObject({ code: "INSTALL_EXIT_2" });
    child.emit("exit", 2);
    await expectation;

    const logAfterSettle = readLog();
    child.emit("error", Object.assign(new Error("late"), { code: "EBAR" }));
    child.emit("exit", 5);
    expect(readLog()).toBe(logAfterSettle);
    expect((logAfterSettle.match(/exited with exit code/g) || []).length).toBe(1);
    expect(logAfterSettle).not.toContain("EBAR");
    expect(mocks.closeCalls).toBe(1);
  });
});

describe("pxpipe install success + serialization", () => {
  it("fake success: managed package.json + library entry yield installed true with version", async () => {
    await load("win32");
    seedPackage("9.9.9");
    const child = makeChild();
    mocks.spawn.mockImplementation(() => child);

    const p = mod.installPxpipe();
    child.emit("exit", 0);
    const info = await p;

    expect(info.installed).toBe(true);
    expect(info.version).toBe("9.9.9");
    expect(mocks.closeCalls).toBe(1);
  });

  it("concurrent installs serialize onto one spawn", async () => {
    await load("win32");
    seedPackage();
    const child = makeChild();
    mocks.spawn.mockImplementation(() => child);

    const p1 = mod.installPxpipe();
    const p2 = mod.installPxpipe();
    expect(mocks.spawn).toHaveBeenCalledTimes(1);

    child.emit("exit", 0);
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(r1.installed).toBe(true);
    expect(r2.installed).toBe(true);
    expect(mocks.spawn).toHaveBeenCalledTimes(1);
    expect(mocks.closeCalls).toBe(1);
  });
});
