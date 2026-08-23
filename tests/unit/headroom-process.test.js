// Headroom managed-proxy lifecycle: fd close races, stop/start race, restart
// ordering. No real sleeps — fake timers and controlled child emitters only.
import { describe, it, expect, vi, beforeEach, afterEach, hoisted } from "vitest";
import { EventEmitter } from "events";

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  openSync: vi.fn(() => 99),
  closeSync: vi.fn(),
  unlinkSync: vi.fn(),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn(),
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, spawn: mocks.spawn };
});

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal();
  const stub = {
    openSync: mocks.openSync,
    closeSync: mocks.closeSync,
    unlinkSync: mocks.unlinkSync,
    writeFileSync: mocks.writeFileSync,
    readFileSync: mocks.readFileSync,
    existsSync: mocks.existsSync,
    mkdirSync: mocks.mkdirSync,
  };
  return {
    ...actual,
    default: { ...(actual.default || {}), ...stub },
    ...stub,
  };
});

vi.mock("@/lib/dataDir.js", () => ({ DATA_DIR: "C:/tmp/9router-headroom-test-data" }));

vi.mock("@/lib/headroom/detect.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    findHeadroomBinary: vi.fn(() => "/usr/bin/headroom"),
    findPython310: vi.fn(() => "/usr/bin/python3"),
    getInstalledHeadroomExtras: vi.fn(() => ({ installed: true, version: "0.26.0", extras: { code: false, ml: false } })),
  };
});

import { startHeadroomProxy, stopHeadroomProxy, restartHeadroomProxy, installHeadroomExtras, uninstallHeadroomExtras } from "../../src/lib/headroom/process.js";
import fs from "fs";

function makeChild(pid = 4242) {
  const child = new EventEmitter();
  child.pid = pid;
  child.unref = vi.fn();
  return child;
}

let alive;
let killSpy;
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  alive = new Set();
  killSpy = vi.spyOn(process, "kill").mockImplementation((pid, sig) => {
    if ((sig === 0 || sig === undefined) && !alive.has(Number(pid))) {
      throw new Error("ESRCH");
    }
    return true;
  });
});
afterEach(() => {
  vi.useRealTimers();
  killSpy.mockRestore();
});

function setAlive(pid, isAlive = true) {
  if (isAlive) alive.add(Number(pid));
  else alive.delete(Number(pid));
}

describe("startHeadroomProxy fd + settle-once", () => {
  it("closes log fd when spawn throws synchronously", async () => {
    mocks.spawn.mockImplementation(() => { throw new Error("spawn blew up sync"); });
    await expect(startHeadroomProxy({})).rejects.toMatchObject({ code: "SPAWN_FAILED" });
    expect(mocks.closeSync).toHaveBeenCalledTimes(1);
    // Never wrote/cleared a pid — nothing was spawned.
    expect(mocks.writeFileSync).not.toHaveBeenCalled();
    expect(mocks.unlinkSync).not.toHaveBeenCalled();
  });

  it("removes the early-exit listener after successful startup so a late crash fires only the late handler", async () => {
    mocks.existsSync.mockImplementation(() => false);
    mocks.readFileSync.mockReturnValue("");

    const child = makeChild(4321);
    mocks.spawn.mockReturnValue(child);
    setAlive(4321);

    const promise = startHeadroomProxy({});
    await vi.advanceTimersByTimeAsync(8000);
    await promise;

    expect(child.listenerCount("exit")).toBe(1);

    // Late crash still clears an owned pid file via the surviving late handler.
    mocks.existsSync.mockImplementation((p) => String(p).endsWith("proxy.pid"));
    mocks.readFileSync.mockReturnValue("4321");
    setAlive(4321, false);
    child.emit("exit", 0);
    expect(mocks.unlinkSync).toHaveBeenCalledTimes(1);
  });

  it("closes log fd exactly once when child exits during startup; late timeout does not double-throw", async () => {
    const child = makeChild(4242);
    mocks.spawn.mockReturnValue(child);
    setAlive(4242);

    const promise = startHeadroomProxy({});
    await vi.advanceTimersByTimeAsync(5);
    child.emit("exit", 1);
    await expect(promise).rejects.toMatchObject({ code: "EARLY_EXIT" });

    // Late startup-timeout firing after early exit must be a no-op (settled once, no unhandled).
    const beforeCalls = mocks.closeSync.mock.calls.length;
    await vi.advanceTimersByTimeAsync(8000);
    expect(mocks.closeSync).toHaveBeenCalledTimes(beforeCalls);
    expect(mocks.unlinkSync).not.toHaveBeenCalled();
  });

  it("startup timeout on a dead child settles once with startup error", async () => {
    const child = makeChild(5000);
    mocks.spawn.mockReturnValue(child);
    setAlive(5000);
    const promise = startHeadroomProxy({});
    const expectation = expect(promise).rejects.toThrow(/exited during startup/);
    await vi.advanceTimersByTimeAsync(5);
    setAlive(5000, false);
    await vi.advanceTimersByTimeAsync(8000);
    await expectation;
    expect(closeSpyCount()).toBe(1);
  });

  function closeSpyCount() { return mocks.closeSync.mock.calls.length; }

  it("resolves once on successful startup; late exit after success clears only if pid file still owned", async () => {
    // For this test, DATA_DIR pid file is NOT pre-seeded — getManagedPid returns null at entry.
    mocks.existsSync.mockImplementation((p) => false);
    mocks.readFileSync.mockReturnValue("");

    const child = makeChild(777);
    mocks.spawn.mockReturnValue(child);
    setAlive(777);

    const promise = startHeadroomProxy({});
    await vi.advanceTimersByTimeAsync(8000);
    const result = await promise;
    expect(result).toEqual({ pid: 777, alreadyRunning: false });
    expect(closeSpyCount()).toBe(1);

    // Late crash after success: late handler checks ownership against the pid file.
    // Re-establish pid-file ownership so the late handler can read "777".
    mocks.existsSync.mockImplementation((p) => String(p).endsWith("proxy.pid"));
    mocks.readFileSync.mockReturnValue("777");
    setAlive(777, false);
    child.emit("exit", 0);
    await Promise.resolve();
    expect(unlinkCalls()).toBe(1);
    // Next late event finds no file — idempotent.
    mocks.existsSync.mockImplementation((p) => false);
    child.emit("exit", 0);
    expect(unlinkCalls()).toBe(1);
  });

  function unlinkCalls() { return mocks.unlinkSync.mock.calls.length; }

  it("late exit after success does NOT clear pid file rewritten by a newer start", async () => {
    mocks.existsSync.mockImplementation((p) => false);
    mocks.readFileSync.mockReturnValue("");

    const child = makeChild(800);
    mocks.spawn.mockReturnValue(child);
    setAlive(800);

    const promise = startHeadroomProxy({});
    await vi.advanceTimersByTimeAsync(8000);
    await promise;

    mocks.existsSync.mockImplementation((p) => String(p).endsWith("proxy.pid"));
    mocks.readFileSync.mockReturnValue("999"); // newer epoch owns the file
    child.emit("exit", 0);
    expect(unlinkCalls()).toBe(0); // never deletes a newer process's PID
  });
});

describe("stopHeadroomProxy await-death + ownership guard", () => {
  it("awaits pid death before clearing file and reporting stopped=true", async () => {
    setAlive(5555);
    mocks.existsSync.mockImplementation((p) => String(p).endsWith("proxy.pid"));
    mocks.readFileSync.mockReturnValue("5555");

    const promise = stopHeadroomProxy();
    await vi.advanceTimersByTimeAsync(300);
    expect(mocks.unlinkSync).not.toHaveBeenCalled(); // not while alive

    setAlive(5555, false);
    await vi.advanceTimersByTimeAsync(300);
    const result = await promise;

    expect(result).toEqual({ stopped: true, pid: 5555 });
    expect(killSpy).toHaveBeenCalledWith(5555, "SIGTERM");
    expect(mocks.unlinkSync).toHaveBeenCalledTimes(1);
  });

  it("escapes to SIGKILL when the process ignores TERM", async () => {
    setAlive(6666);
    mocks.existsSync.mockImplementation((p) => String(p).endsWith("proxy.pid"));
    mocks.readFileSync.mockReturnValue("6666");

    const promise = stopHeadroomProxy();
    await vi.advanceTimersByTimeAsync(2500); // TERM grace elapses → SIGKILL sent
    expect(killSpy).toHaveBeenCalledWith(6666, "SIGKILL");
    setAlive(6666, false);
    await vi.advanceTimersByTimeAsync(1000);
    const result = await promise;
    expect(result.stopped).toBe(true);
    expect(mocks.unlinkSync).toHaveBeenCalledTimes(1);
  });

  it("does NOT delete pid file now owned by a newer epoch mid-stop", async () => {
    // getManagedPid must see old pid 111 at entry, then the file races to 222.
    mocks.existsSync.mockImplementation((p) => String(p).endsWith("proxy.pid"));
    let fileOwner = "111";
    mocks.readFileSync.mockImplementation(() => fileOwner);
    setAlive(Number(fileOwner));

    const promise = stopHeadroomProxy();
    await vi.advanceTimersByTimeAsync(50);
    fileOwner = "222"; // concurrent start rewrites ownership
    setAlive(111, false);
    await vi.advanceTimersByTimeAsync(400);
    const result = await promise;

    expect(result.stopped).toBe(true);
    expect(mocks.unlinkSync).not.toHaveBeenCalled();
  });

  it("rejects STOP_FAILED without deleting the pid file when death never observed", async () => {
    setAlive(31337);
    mocks.existsSync.mockImplementation((p) => String(p).endsWith("proxy.pid"));
    mocks.readFileSync.mockReturnValue("31337");

    const promise = stopHeadroomProxy();
    const expectation = expect(promise).rejects.toMatchObject({ code: "STOP_FAILED" });
    await vi.advanceTimersByTimeAsync(60000);
    await expectation;
    expect(killSpy).toHaveBeenCalledWith(31337, "SIGKILL");
    expect(mocks.unlinkSync).not.toHaveBeenCalled();
  });
});

describe("restart ordering", () => {
  it("waits for old process death before spawning replacement", async () => {
    setAlive(888);
    mocks.readFileSync.mockReturnValue("888");
    mocks.existsSync.mockImplementation((p) => String(p).endsWith("proxy.pid"));

    const child = makeChild(999);
    mocks.spawn.mockReturnValue(child);

    const promise = restartHeadroomProxy({});
    await vi.advanceTimersByTimeAsync(200);
    expect(mocks.spawn).not.toHaveBeenCalled(); // old still alive

    setAlive(888, false);
    await vi.advanceTimersByTimeAsync(1200);
    expect(mocks.spawn).toHaveBeenCalled();

    setAlive(999);
    await vi.advanceTimersByTimeAsync(8000);
    const result = await promise;
    expect(result.pid).toBe(999);
  });

  it("fails without spawning when old process refuses to die", async () => {
    setAlive(31337);
    mocks.readFileSync.mockReturnValue("31337");
    mocks.existsSync.mockImplementation((p) => String(p).endsWith("proxy.pid"));

    const promise = restartHeadroomProxy({});
    const expectation = expect(promise).rejects.toMatchObject({ code: "RESTART_FAILED" });
    await vi.advanceTimersByTimeAsync(60000);
    await expectation;
    expect(mocks.spawn).not.toHaveBeenCalled();
  });
});

describe("install/uninstall fd guards", () => {
  it("install closes install-log fd exactly once on error+exit overlap", async () => {
    const child = makeChild(8888);
    mocks.spawn.mockReturnValue(child);

    const promise = installHeadroomExtras(["ml"]);
    child.emit("error", new Error("spawn blew up"));
    child.emit("exit", 0);

    await expect(promise).rejects.toThrow("spawn blew up");
    expect(mocks.closeSync).toHaveBeenCalledTimes(1);
    expect(mocks.closeSync).toHaveBeenCalledWith(99);
    // Second late exit must not re-close.
    child.emit("exit", 0);
    expect(mocks.closeSync).toHaveBeenCalledTimes(1);
  });

  it("uninstall settles once and closes fd once on exit; late events ignored", async () => {
    const child = makeChild(9000);
    mocks.spawn.mockReturnValue(child);

    const promise = uninstallHeadroomExtras(["ml"]);
    child.emit("exit", 0);
    const result = await promise;

    expect(result.success).toBe(true);
    expect(mocks.closeSync).toHaveBeenCalledTimes(1);
    child.emit("error", new Error("late error"));
    child.emit("exit", 0);
    expect(mocks.closeSync).toHaveBeenCalledTimes(1);
  });

  it("uninstall rejects UNINSTALL_FAILED on nonzero exit; late error ignored", async () => {
    const child = makeChild(9010);
    mocks.spawn.mockReturnValue(child);

    const promise = uninstallHeadroomExtras(["ml"]);
    child.emit("exit", 1);
    child.emit("error", new Error("late error"));
    await expect(promise).rejects.toMatchObject({ code: "UNINSTALL_FAILED" });
    expect(mocks.closeSync).toHaveBeenCalledTimes(1);
  });

  it("install sync spawn throw closes fd once, rejects", async () => {
    mocks.spawn.mockImplementation(() => { throw new Error("sync boom"); });
    await expect(installHeadroomExtras(["ml"])).rejects.toThrow("sync boom");
    expect(mocks.closeSync).toHaveBeenCalledTimes(1);
    expect(mocks.closeSync).toHaveBeenCalledWith(99);
  });

  it("uninstall sync spawn throw closes fd once, rejects", async () => {
    mocks.spawn.mockImplementation(() => { throw new Error("sync boom u"); });
    await expect(uninstallHeadroomExtras(["ml"])).rejects.toThrow("sync boom u");
    expect(mocks.closeSync).toHaveBeenCalledTimes(1);
    expect(mocks.closeSync).toHaveBeenCalledWith(99);
  });
});

describe("managed child env inheritance", () => {
  it("spawn inherits HEADROOM_PROXY_TOKEN from process.env", async () => {
    process.env.HEADROOM_PROXY_TOKEN = "inbound-secret";
    try {
      const child = makeChild(1234);
      mocks.spawn.mockReturnValue(child);
      setAlive(1234);

      const promise = startHeadroomProxy({});
      await vi.advanceTimersByTimeAsync(8000);
      await promise;

      expect(mocks.spawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Array),
        expect.objectContaining({
          env: expect.objectContaining({ HEADROOM_PROXY_TOKEN: "inbound-secret" }),
        }),
      );
    } finally {
      delete process.env.HEADROOM_PROXY_TOKEN;
    }
  });
});
