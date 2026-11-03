import { readFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import path from "node:path";
import vm from "node:vm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cliPath = path.resolve(import.meta.dirname, "../../cli/cli.js");
const source = readFileSync(cliPath, "utf8").replace(/^#!.*\r?\n/, "");

// Run the real launcher while isolating every process, filesystem and network
// operation: its startup sweep must never inspect or kill real processes.
async function launch(args, isTTY = false) {
  const child = Object.assign(new EventEmitter(), { pid: 424242, stderr: new EventEmitter() });
  const spawn = vi.fn(() => child);
  const initTray = vi.fn();
  const killTray = vi.fn();
  const ensureTrayRuntime = vi.fn();
  const selectMenu = vi.fn(() => new Promise(() => {}));
  const processStub = Object.assign(new EventEmitter(), {
    argv: ["node", cliPath, ...args], platform: "linux", pid: 12345,
    execPath: "/isolated/node", env: {}, stdin: { isTTY },
    stdout: { isTTY: false, write: vi.fn() }, kill: vi.fn(),
    exit: vi.fn(),
  });
  const output = { log: vi.fn(), error: vi.fn() };
  const modules = {
    child_process: { spawn, exec: vi.fn(), execSync: vi.fn(() => "") },
    path,
    fs: { existsSync: (p) => p.endsWith("custom-server.js") },
    https: { get: () => {
      const req = new EventEmitter();
      queueMicrotask(() => req.emit("error", new Error("offline test")));
      return req;
    } },
    net: { connect: (_options, ready) => {
      const socket = Object.assign(new EventEmitter(), { destroy: vi.fn() });
      queueMicrotask(ready);
      return socket;
    } },
    os: { homedir: () => "/isolated", networkInterfaces: () => ({}) },
    "./package.json": { name: "9router", version: "0.5.112" },
    "./hooks/sqliteRuntime": { ensureSqliteRuntime() {}, buildEnvWithRuntime: (env) => env },
    "./hooks/trayRuntime": { ensureTrayRuntime },
    "./src/cli/tray/tray": { initTray, killTray },
    "./src/cli/utils/input": { selectMenu },
    "./src/cli/utils/display": { clearScreen() {} },
    "./src/cli/utils/endpoint": { getEndpoint: async () => ({ tunnelEnabled: false }) },
  };
  const context = vm.createContext({
    console: output, process: processStub, setTimeout, clearTimeout, setInterval, clearInterval,
    setImmediate, queueMicrotask,
  });
  const run = vm.runInContext(`(function(require, __filename, __dirname) {\n${source}\n})`, context);
  run((name) => {
    if (!(name in modules)) throw new Error(`Unexpected launcher dependency: ${name}`);
    return modules[name];
  }, cliPath, path.dirname(cliPath));
  await vi.advanceTimersByTimeAsync(600);
  return { child, spawn, initTray, killTray, ensureTrayRuntime, selectMenu, process: processStub, output };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("CLI foreground supervision (#4296)", () => {
  it.each([false, true])("starts an attached server without a tray or menu (TTY=%s)", async (isTTY) => {
    const app = await launch(["--foreground", "--skip-update"], isTTY);
    expect(app.spawn).toHaveBeenCalledTimes(1);
    const options = app.spawn.mock.calls[0][2];
    expect(options.detached).toBe(false);
    expect(options.stdio).toEqual(["ignore", "inherit", "inherit"]);
    expect(options.env.TRAY_MODE).toBeUndefined();
    expect(app.initTray).not.toHaveBeenCalled();
    expect(app.ensureTrayRuntime).not.toHaveBeenCalled();
    expect(app.selectMenu).not.toHaveBeenCalled();
    expect(app.child.listenerCount("close")).toBe(1);
    expect(app.process.exit).not.toHaveBeenCalled();
  });

  it("also stays in foreground without --skip-update", async () => {
    const app = await launch(["--foreground"]);
    expect(app.selectMenu).not.toHaveBeenCalled();
    expect(app.initTray).not.toHaveBeenCalled();
    expect(app.process.exit).not.toHaveBeenCalled();
  });

  it("passes the requested host and port to the foreground server", async () => {
    const app = await launch(["--foreground", "--skip-update", "-H", "127.0.0.1", "-p", "22000"]);
    expect(app.spawn.mock.calls[0][2].env).toMatchObject({ PORT: "22000", HOSTNAME: "127.0.0.1" });
  });

  it.each([0, 7, null])("reports server exit %s to the supervisor without restarting", async (code) => {
    const app = await launch(["--foreground", "--skip-update"]);
    app.child.emit("close", code);
    expect(app.process.exit).toHaveBeenCalledWith(code ?? 1);
    await vi.advanceTimersByTimeAsync(12000);
    expect(app.spawn).toHaveBeenCalledTimes(1);
  });

  it("reports a spawn failure without launching another server", async () => {
    const app = await launch(["--foreground", "--skip-update"]);
    app.child.emit("error", new Error("spawn failed"));
    expect(app.process.exit).toHaveBeenCalledWith(1);
    await vi.advanceTimersByTimeAsync(12000);
    expect(app.spawn).toHaveBeenCalledTimes(1);
  });

  it("stops its attached child on SIGTERM without killing a process group", async () => {
    const app = await launch(["--foreground", "--skip-update"]);
    app.process.emit("SIGTERM");
    expect(app.process.kill).toHaveBeenCalledWith(424242, "SIGKILL");
    expect(app.process.kill).not.toHaveBeenCalledWith(-424242, expect.anything());
    expect(app.killTray).not.toHaveBeenCalled();
    app.child.emit("close", null, "SIGKILL");
    expect(app.process.exit).toHaveBeenCalledWith(0);
    await vi.advanceTimersByTimeAsync(100);
    expect(app.process.exit).toHaveBeenCalledWith(0);
  });

  it("keeps explicit tray mode available", async () => {
    const app = await launch(["--tray", "--skip-update"]);
    expect(app.spawn.mock.calls[0][2].detached).toBe(true);
    expect(app.initTray).toHaveBeenCalledOnce();
    expect(app.selectMenu).not.toHaveBeenCalled();
  });

  it("keeps the normal interactive menu available", async () => {
    const app = await launch(["--skip-update"], true);
    expect(app.selectMenu).toHaveBeenCalledOnce();
    expect(app.initTray).toHaveBeenCalledOnce();
  });

  it.each([["--foreground", "--tray"], ["-t", "--foreground"]])(
    "rejects conflicting foreground and tray options: %j",
    async (...args) => {
      const app = await launch([...args, "--skip-update"]);
      expect(app.process.exit).toHaveBeenCalledWith(1);
      expect(app.spawn).not.toHaveBeenCalled();
      expect(app.output.error.mock.calls.flat().join(" ")).toContain("--foreground");
    }
  );
});
