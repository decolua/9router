import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  closeSync: vi.fn(),
  execFileSync: vi.fn(),
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  openSync: vi.fn(),
  readFileSync: vi.fn(),
  spawn: vi.fn(),
  unlinkSync: vi.fn(),
  writeFileSync: vi.fn(),
  findHeadroomBinary: vi.fn(),
  findPython310: vi.fn(),
  getInstalledHeadroomExtras: vi.fn(),
}));

vi.mock("fs", () => ({
  default: {
    closeSync: mocks.closeSync,
    existsSync: mocks.existsSync,
    mkdirSync: mocks.mkdirSync,
    openSync: mocks.openSync,
    readFileSync: mocks.readFileSync,
    unlinkSync: mocks.unlinkSync,
    writeFileSync: mocks.writeFileSync,
  },
  closeSync: mocks.closeSync,
  existsSync: mocks.existsSync,
  mkdirSync: mocks.mkdirSync,
  openSync: mocks.openSync,
  readFileSync: mocks.readFileSync,
  unlinkSync: mocks.unlinkSync,
  writeFileSync: mocks.writeFileSync,
}));

vi.mock("child_process", () => ({
  execFileSync: mocks.execFileSync,
  spawn: mocks.spawn,
}));

vi.mock("@/lib/dataDir.js", () => ({ DATA_DIR: "C:\\9router-test" }));
vi.mock("../../src/lib/headroom/detect.js", () => ({
  EXTRA_MARKERS: {},
  HEADROOM_COMPRESSION_EXTRAS: [],
  findHeadroomBinary: mocks.findHeadroomBinary,
  findPython310: mocks.findPython310,
  getInstalledHeadroomExtras: mocks.getInstalledHeadroomExtras,
}));

function makeChild(pid = 4242) {
  const child = new EventEmitter();
  child.pid = pid;
  child.unref = vi.fn();
  return child;
}

describe("Headroom managed-process lifecycle", () => {
  let pidFile = null;
  let livePids;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();
    pidFile = null;
    livePids = new Set();

    mocks.existsSync.mockImplementation((candidate) =>
      String(candidate).endsWith("proxy.pid") ? pidFile !== null : true,
    );
    mocks.readFileSync.mockImplementation((candidate) =>
      String(candidate).endsWith("proxy.pid") ? pidFile : "",
    );
    mocks.writeFileSync.mockImplementation((candidate, content) => {
      if (String(candidate).endsWith("proxy.pid")) pidFile = String(content);
    });
    mocks.unlinkSync.mockImplementation((candidate) => {
      if (String(candidate).endsWith("proxy.pid")) pidFile = null;
    });
    mocks.openSync.mockReturnValue(91);
    mocks.findHeadroomBinary.mockReturnValue("C:\\tools\\headroom.exe");
    mocks.execFileSync.mockReturnValue(process.platform === "win32"
      ? '"headroom.exe","4242","Console","1","1,024 K"\r\n'
      : "/usr/local/bin/headroom\n");

    vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
      if (signal === 0) {
        if (livePids.has(pid)) return true;
        throw new Error("ESRCH");
      }
      if (signal === "SIGTERM" || signal === "SIGKILL") {
        livePids.delete(pid);
        return true;
      }
      return true;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("coalesces concurrent starts and never double-closes the log fd after a later exit", async () => {
    const child = makeChild();
    livePids.add(child.pid);
    mocks.spawn.mockReturnValue(child);

    const { startHeadroomProxy } = await import("../../src/lib/headroom/process.js");
    const first = startHeadroomProxy();
    const second = startHeadroomProxy();

    expect(second).toBe(first);
    await Promise.resolve();
    expect(mocks.spawn).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(8000);
    await expect(first).resolves.toEqual({ pid: child.pid, alreadyRunning: false });
    expect(mocks.closeSync).toHaveBeenCalledTimes(1);
    expect(JSON.parse(pidFile)).toMatchObject({
      pid: child.pid,
      binary: "headroom.exe",
      port: 8787,
    });

    livePids.delete(child.pid);
    child.emit("exit", 0);
    expect(mocks.closeSync).toHaveBeenCalledTimes(1);
    expect(pidFile).toBeNull();
  });

  it("turns an asynchronous spawn error into a rejected request rather than an uncaught error", async () => {
    const child = makeChild();
    livePids.add(child.pid);
    mocks.spawn.mockReturnValue(child);

    const { startHeadroomProxy } = await import("../../src/lib/headroom/process.js");
    const pending = startHeadroomProxy();
    await Promise.resolve();
    child.emit("error", new Error("ENOENT"));

    await expect(pending).rejects.toMatchObject({ code: "SPAWN_FAILED" });
    expect(mocks.closeSync).toHaveBeenCalledTimes(1);
    expect(pidFile).toBeNull();
  });

  it("retires a stale PID record instead of treating a recycled process as Headroom", async () => {
    const pid = 777;
    pidFile = JSON.stringify({ pid, binary: "headroom.exe", port: 8787 });
    livePids.add(pid);
    mocks.execFileSync.mockReturnValue(process.platform === "win32"
      ? '"notepad.exe","777","Console","1","1,024 K"\r\n'
      : "/usr/bin/notepad\n");

    const { getManagedPid, stopHeadroomProxy } = await import("../../src/lib/headroom/process.js");

    expect(getManagedPid()).toBeNull();
    await expect(stopHeadroomProxy()).resolves.toEqual({ stopped: false, reason: "not_running" });
    expect(pidFile).toBeNull();
    expect(process.kill.mock.calls.filter(([, signal]) => signal !== 0)).toEqual([]);
  });
});
