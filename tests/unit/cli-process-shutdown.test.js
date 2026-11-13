import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { stopServerProcess, GRACEFUL_TIMEOUT_MS } = require("../../cli/src/cli/utils/processShutdown.js");

describe("CLI graceful server stop", () => {
  it("sends SIGTERM first and does not SIGKILL when the server exits within the bound", () => {
    const signals = [];
    const kill = (pid, signal) => { signals.push([pid, signal]); };
    const waitForExit = vi.fn(() => true);

    const result = stopServerProcess(4242, { platform: "linux", kill, waitForExit, timeoutMs: 2000 });

    expect(signals).toEqual([[4242, "SIGTERM"]]);
    expect(waitForExit).toHaveBeenCalledWith(4242, 2000);
    expect(result).toMatchObject({ pid: 4242, graceful: true, forced: false });
  });

  it("force-kills the process tree after the bounded wait when SIGTERM is ignored", () => {
    const signals = [];
    const kill = (pid, signal) => { signals.push([pid, signal]); };
    const waitForExit = vi.fn(() => false);

    const result = stopServerProcess(4242, { platform: "darwin", kill, waitForExit, timeoutMs: 1500 });

    expect(signals).toEqual([[4242, "SIGTERM"], [-4242, "SIGKILL"]]);
    expect(waitForExit).toHaveBeenCalledWith(4242, 1500);
    expect(result).toMatchObject({ graceful: false, forced: true });
  });

  it("falls back to signalling the leader when the process group is gone", () => {
    const signals = [];
    const kill = (pid, signal) => {
      signals.push([pid, signal]);
      if (pid < 0) throw new Error("ESRCH");
    };

    stopServerProcess(555, { platform: "linux", kill, waitForExit: () => false, timeoutMs: 100 });

    expect(signals).toEqual([[555, "SIGTERM"], [-555, "SIGKILL"], [555, "SIGKILL"]]);
  });

  it("asks Windows for a graceful tree close before forcing it", () => {
    const commands = [];
    const exec = (command) => { commands.push(command); };

    const result = stopServerProcess(77, {
      platform: "win32",
      exec,
      waitForExit: () => false,
      timeoutMs: 1200,
    });

    expect(commands[0]).toContain("taskkill /T /PID 77");
    expect(commands[0]).not.toContain("/F");
    expect(commands[1]).toContain("taskkill /F /T /PID 77");
    expect(result).toMatchObject({ graceful: false, forced: true });
  });

  it("does not force Windows processes that closed gracefully", () => {
    const commands = [];
    const exec = (command) => { commands.push(command); };

    const result = stopServerProcess(88, {
      platform: "win32",
      exec,
      waitForExit: () => true,
      timeoutMs: 1200,
    });

    expect(commands).toHaveLength(1);
    expect(result).toMatchObject({ graceful: true, forced: false });
  });

  it("does nothing without a pid", () => {
    const kill = vi.fn();

    const result = stopServerProcess(undefined, { platform: "linux", kill });

    expect(kill).not.toHaveBeenCalled();
    expect(result).toMatchObject({ pid: null, graceful: false, forced: false });
  });

  it("exposes a positive, finite default bound", () => {
    expect(GRACEFUL_TIMEOUT_MS).toBeGreaterThan(0);
    expect(Number.isFinite(GRACEFUL_TIMEOUT_MS)).toBe(true);
  });
});
