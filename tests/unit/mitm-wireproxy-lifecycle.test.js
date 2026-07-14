import { afterEach, describe, expect, it, vi } from "vitest";

const manager = await import("../../src/mitm/manager.js");
const lifecycleModule = await import("../../src/lib/network/wireproxyLifecycle.js");

function createHarness({ ensureError, mitmStartError } = {}) {
  const events = [];
  let mitmExitHandler;
  let wireproxyExitHandler;

  const deps = {
    ensureWireproxy: vi.fn(async () => {
      events.push("wireproxy:start");
      if (ensureError) throw ensureError;
      return { managed: true, pid: 42 };
    }),
    stopWireproxy: vi.fn(async () => {
      events.push("wireproxy:stop");
    }),
    startMitmProcess: vi.fn(async () => {
      events.push("mitm:start");
      if (mitmStartError) throw mitmStartError;
      return { running: true, pid: 84 };
    }),
    stopMitmProcess: vi.fn(async () => {
      events.push("mitm:stop");
    }),
    watchMitmExit: vi.fn((_pid, handler) => {
      mitmExitHandler = handler;
      return () => events.push("mitm:unwatch");
    }),
    watchWireproxyExit: vi.fn((_pid, handler) => {
      wireproxyExitHandler = handler;
      return () => events.push("wireproxy:unwatch");
    }),
  };

  return {
    deps,
    events,
    emitMitmExit: async () => mitmExitHandler?.(),
    emitWireproxyExit: async () => wireproxyExitHandler?.(),
  };
}

describe("wireproxy process manager", () => {
  it("preserves a thrown primitive when rollback also fails", async () => {
    const cleanupError = new Error("cleanup failed");

    await expect(
      lifecycleModule.rollbackPreservingError("startup failed", async () => {
        throw cleanupError;
      }),
    ).rejects.toMatchObject({
      message: "startup failed",
      cleanupError,
    });
  });

  it("normalizes PM2 jlist output without executing a shell", async () => {
    expect(lifecycleModule.createPm2CliAdapter).toBeTypeOf("function");
    const execFile = vi.fn((_binary, _args, callback) => {
      callback(null, JSON.stringify([
        { name: "other", pid: 1, pm2_env: { status: "online" } },
        { name: "wireproxy", pid: 42, pm2_env: { status: "online" } },
      ]), "");
    });
    const adapter = lifecycleModule.createPm2CliAdapter({ execFile, pm2Binary: "/usr/bin/pm2" });

    await expect(adapter.runPm2("describe", ["wireproxy"])).resolves.toEqual({
      pid: 42,
      status: "online",
    });
    expect(execFile).toHaveBeenCalledWith("/usr/bin/pm2", ["jlist"], expect.any(Function));
  });

  it("propagates PM2 command failures", async () => {
    const commandError = new Error("pm2 failed");
    const execFile = vi.fn((_binary, _args, callback) => callback(commandError, "", "failed"));
    const adapter = lifecycleModule.createPm2CliAdapter({ execFile });

    await expect(adapter.runPm2("stop", ["wireproxy"])).rejects.toBe(commandError);
  });

  it("rejects malformed PM2 process-list JSON with a diagnostic error", async () => {
    const execFile = vi.fn((_binary, _args, callback) => callback(null, "not-json", ""));
    const adapter = lifecycleModule.createPm2CliAdapter({ execFile });

    await expect(adapter.runPm2("describe", ["wireproxy"])).rejects.toThrow(
      "Failed to parse PM2 process list",
    );
  });

  it("rejects a PM2 process list that is not an array", async () => {
    const execFile = vi.fn((_binary, _args, callback) => callback(null, '{"name":"wireproxy"}', ""));
    const adapter = lifecycleModule.createPm2CliAdapter({ execFile });

    await expect(adapter.runPm2("describe", ["wireproxy"])).rejects.toThrow(
      "PM2 process list must be an array",
    );
  });

  it("resolves when the injected TCP connector reaches wireproxy", async () => {
    expect(lifecycleModule.waitForTcpPort).toBeTypeOf("function");
    const socket = {
      once: vi.fn((event, callback) => {
        if (event === "connect") queueMicrotask(callback);
        return socket;
      }),
      destroy: vi.fn(),
    };

    await lifecycleModule.waitForTcpPort("127.0.0.1", 40000, {
      timeoutMs: 20,
      intervalMs: 1,
      connect: vi.fn(() => socket),
    });

    expect(socket.destroy).toHaveBeenCalledTimes(1);
  });

  it("rejects with the exact endpoint when TCP readiness times out", async () => {
    expect(lifecycleModule.waitForTcpPort).toBeTypeOf("function");
    const connect = vi.fn(() => {
      const socket = {
        once: vi.fn((event, callback) => {
          if (event === "error") queueMicrotask(callback);
          return socket;
        }),
        destroy: vi.fn(),
      };
      return socket;
    });

    await expect(lifecycleModule.waitForTcpPort("127.0.0.1", 40000, {
      timeoutMs: 5,
      intervalMs: 1,
      connect,
    })).rejects.toThrow("Timed out waiting for wireproxy at 127.0.0.1:40000");
  });

  it("times out and destroys a TCP socket that never emits connect or error", async () => {
    const socket = { once: vi.fn().mockReturnThis(), destroy: vi.fn() };

    await expect(lifecycleModule.waitForTcpPort("127.0.0.1", 40000, {
      timeoutMs: 5,
      intervalMs: 1,
      connect: vi.fn(() => socket),
    })).rejects.toThrow("Timed out waiting for wireproxy at 127.0.0.1:40000");

    expect(socket.destroy).toHaveBeenCalledTimes(1);
  });

  it("starts the named PM2 process from the configured binary and waits for readiness", async () => {
    expect(lifecycleModule.createWireproxyProcessManager).toBeTypeOf("function");
    const runPm2 = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ pid: 42, status: "online" });
    const waitForPort = vi.fn().mockResolvedValue(undefined);
    const processManager = lifecycleModule.createWireproxyProcessManager({
      runPm2,
      waitForPort,
      processName: "wireproxy",
      binaryPath: "/usr/local/bin/wireproxy",
      configPath: "/home/test/.9router/warp/wireproxy.conf",
      host: "127.0.0.1",
      port: 40000,
    });

    await expect(processManager.ensure()).resolves.toEqual({ managed: true, pid: 42 });

    expect(runPm2).toHaveBeenNthCalledWith(1, "describe", ["wireproxy"]);
    expect(runPm2).toHaveBeenNthCalledWith(2, "start", [
      "/usr/local/bin/wireproxy",
      "--name",
      "wireproxy",
      "--",
      "-c",
      "/home/test/.9router/warp/wireproxy.conf",
    ]);
    expect(waitForPort).toHaveBeenCalledWith("127.0.0.1", 40000);
  });

  it("reuses an online PM2 process without starting another one", async () => {
    expect(lifecycleModule.createWireproxyProcessManager).toBeTypeOf("function");
    const runPm2 = vi.fn().mockResolvedValue({ pid: 42, status: "online" });
    const waitForPort = vi.fn().mockResolvedValue(undefined);
    const processManager = lifecycleModule.createWireproxyProcessManager({
      runPm2,
      waitForPort,
      processName: "wireproxy",
      binaryPath: "/usr/local/bin/wireproxy",
      configPath: "/home/test/.9router/warp/wireproxy.conf",
      host: "127.0.0.1",
      port: 40000,
    });

    await expect(processManager.ensure()).resolves.toEqual({ managed: true, pid: 42 });

    expect(runPm2).toHaveBeenCalledTimes(1);
    expect(waitForPort).toHaveBeenCalledWith("127.0.0.1", 40000);
  });

  it("refreshes PM2 state after start when the start command returns no process metadata", async () => {
    const runPm2 = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ pid: 42, status: "online" });
    const processManager = lifecycleModule.createWireproxyProcessManager({
      runPm2,
      waitForPort: vi.fn().mockResolvedValue(undefined),
      processName: "wireproxy",
      binaryPath: "/usr/local/bin/wireproxy",
      configPath: "/home/test/.9router/warp/wireproxy.conf",
      host: "127.0.0.1",
      port: 40000,
    });

    await expect(processManager.ensure()).resolves.toEqual({ managed: true, pid: 42 });
    expect(runPm2).toHaveBeenNthCalledWith(3, "describe", ["wireproxy"]);
  });

  it("rejects when PM2 cannot confirm an online wireproxy process", async () => {
    const runPm2 = vi.fn().mockResolvedValue(null);
    const processManager = lifecycleModule.createWireproxyProcessManager({
      runPm2,
      waitForPort: vi.fn(),
      processName: "wireproxy",
      binaryPath: "/usr/local/bin/wireproxy",
      configPath: "/home/test/.9router/warp/wireproxy.conf",
      host: "127.0.0.1",
      port: 40000,
    });

    await expect(processManager.ensure()).rejects.toThrow(
      'PM2 did not report "wireproxy" online after start',
    );
  });

  it("stops only the named PM2 process", async () => {
    expect(lifecycleModule.createWireproxyProcessManager).toBeTypeOf("function");
    const runPm2 = vi.fn().mockResolvedValue(null);
    const processManager = lifecycleModule.createWireproxyProcessManager({
      runPm2,
      waitForPort: vi.fn(),
      processName: "wireproxy",
      binaryPath: "/usr/local/bin/wireproxy",
      configPath: "/home/test/.9router/warp/wireproxy.conf",
      host: "127.0.0.1",
      port: 40000,
    });

    await processManager.stop();

    expect(runPm2).toHaveBeenCalledExactlyOnceWith("stop", ["wireproxy"]);
  });
});

describe("lifecycle watcher setup rollback", () => {
  it("stops MITM and wireproxy when the MITM watcher cannot be installed", async () => {
    const watcherError = new Error("MITM watcher failed");
    const harness = createHarness();
    harness.deps.watchMitmExit.mockImplementation(() => {
      throw watcherError;
    });
    const lifecycle = lifecycleModule.createMitmWireproxyLifecycle(harness.deps);

    await expect(lifecycle.start()).rejects.toBe(watcherError);

    expect(harness.events).toEqual([
      "wireproxy:start",
      "mitm:start",
      "mitm:stop",
      "wireproxy:stop",
    ]);
  });

  it("removes a partial watcher and stops both peers when the second watcher fails", async () => {
    const watcherError = new Error("wireproxy watcher failed");
    const harness = createHarness();
    harness.deps.watchWireproxyExit.mockImplementation(() => {
      throw watcherError;
    });
    const lifecycle = lifecycleModule.createMitmWireproxyLifecycle(harness.deps);

    await expect(lifecycle.start()).rejects.toBe(watcherError);

    expect(harness.events).toEqual([
      "wireproxy:start",
      "mitm:start",
      "mitm:unwatch",
      "mitm:stop",
      "wireproxy:stop",
    ]);
  });
});

describe("process exit watcher", () => {
  it("notifies once when an injected process changes from alive to dead", async () => {
    expect(lifecycleModule.watchProcessExit).toBeTypeOf("function");
    const callback = vi.fn();
    const isProcessAlive = vi.fn().mockReturnValueOnce(true).mockReturnValue(false);
    const scheduled = [];
    const dispose = lifecycleModule.watchProcessExit(42, callback, {
      isProcessAlive,
      setIntervalFn: (handler) => {
        scheduled.push(handler);
        return 7;
      },
      clearIntervalFn: vi.fn(),
      intervalMs: 10,
    });

    await scheduled[0]();
    await scheduled[0]();
    await scheduled[0]();

    expect(callback).toHaveBeenCalledTimes(1);
    dispose();
  });

  it("does not notify after the watcher is disposed", async () => {
    const callback = vi.fn();
    const scheduled = [];
    const clearIntervalFn = vi.fn();
    const dispose = lifecycleModule.watchProcessExit(42, callback, {
      isProcessAlive: vi.fn().mockReturnValue(false),
      setIntervalFn: (handler) => {
        scheduled.push(handler);
        return 7;
      },
      clearIntervalFn,
    });

    dispose();
    await scheduled[0]();

    expect(callback).not.toHaveBeenCalled();
    expect(clearIntervalFn).toHaveBeenCalledWith(7);
  });

  it("does not keep the process alive solely for process-exit polling", () => {
    const timer = { unref: vi.fn() };
    const dispose = lifecycleModule.watchProcessExit(42, vi.fn(), {
      isProcessAlive: vi.fn(() => true),
      setIntervalFn: vi.fn(() => timer),
      clearIntervalFn: vi.fn(),
    });

    expect(timer.unref).toHaveBeenCalledTimes(1);
    dispose();
  });

  it("reports asynchronous callback failures without rejecting from the timer", async () => {
    const callbackError = new Error("peer cleanup failed");
    const onError = vi.fn();
    let tick;
    lifecycleModule.watchProcessExit(42, async () => {
      throw callbackError;
    }, {
      isProcessAlive: () => false,
      setIntervalFn: (handler) => {
        tick = handler;
        return 7;
      },
      clearIntervalFn: vi.fn(),
      onError,
    });

    await expect(tick()).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledWith(callbackError);
  });

  it("treats PM2 PID replacement as exit from the watched generation", async () => {
    const callback = vi.fn();
    const scheduled = [];
    const runPm2 = vi.fn().mockResolvedValue({ pid: 99, status: "online" });
    lifecycleModule.watchPm2ProcessIdentity("wireproxy", 42, callback, {
      runPm2,
      setIntervalFn: (handler) => {
        scheduled.push(handler);
        return 7;
      },
      clearIntervalFn: vi.fn(),
    });

    await scheduled[0]();

    expect(runPm2).toHaveBeenCalledWith("describe", ["wireproxy"]);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("keeps watching while PM2 reports the same online process identity", async () => {
    const callback = vi.fn();
    const scheduled = [];
    lifecycleModule.watchPm2ProcessIdentity("wireproxy", 42, callback, {
      runPm2: vi.fn().mockResolvedValue({ pid: 42, status: "online" }),
      setIntervalFn: (handler) => {
        scheduled.push(handler);
        return 7;
      },
      clearIntervalFn: vi.fn(),
    });

    await scheduled[0]();

    expect(callback).not.toHaveBeenCalled();
  });

  it("does not keep the process alive solely for PM2 identity polling", () => {
    const timer = { unref: vi.fn() };
    const dispose = lifecycleModule.watchPm2ProcessIdentity("wireproxy", 42, vi.fn(), {
      runPm2: vi.fn(),
      setIntervalFn: vi.fn(() => timer),
      clearIntervalFn: vi.fn(),
    });

    expect(timer.unref).toHaveBeenCalledTimes(1);
    dispose();
  });
});

describe("MITM manager wireproxy binding", () => {
  afterEach(() => {
    manager.setWireproxyLifecycleDeps();
    manager.setMitmProcessActions();
  });

  it("builds default wireproxy dependencies with the production endpoint and paths", async () => {
    expect(manager.createDefaultWireproxyDeps).toBeTypeOf("function");
    const runPm2 = vi.fn().mockResolvedValue({ pid: 42, status: "online" });
    const waitForPort = vi.fn().mockResolvedValue(undefined);
    const watchExit = vi.fn(() => () => {});
    const deps = manager.createDefaultWireproxyDeps({
      homeDir: "/home/test",
      dataDir: "/home/test/.9router",
      runPm2,
      waitForPort,
      watchExit,
      accessFile: vi.fn().mockResolvedValue(undefined),
    });

    await deps.ensure();

    expect(runPm2).toHaveBeenCalledWith("describe", ["wireproxy"]);
    expect(waitForPort).toHaveBeenCalledWith("127.0.0.1", 40000);
    const exitHandler = vi.fn();
    deps.watchExit(42, exitHandler);
    expect(watchExit).toHaveBeenCalledWith(42, exitHandler);
    expect(deps.watchIdentity).toBeTypeOf("function");
    expect(deps.config).toEqual({
      processName: "wireproxy",
      binaryPath: "/home/test/.local/bin/wireproxy",
      configPath: "/home/test/.9router/warp/wireproxy.conf",
      host: "127.0.0.1",
      port: 40000,
    });
  });

  it("fails before PM2 when the wireproxy binary is unavailable", async () => {
    const runPm2 = vi.fn();
    const deps = manager.createDefaultWireproxyDeps({
      homeDir: "/home/test",
      dataDir: "/home/test/.9router",
      runPm2,
      accessFile: vi.fn(async (filePath) => {
        if (filePath.endsWith("/wireproxy")) throw new Error("missing");
      }),
    });

    await expect(deps.ensure()).rejects.toThrow(
      "wireproxy binary is unavailable: /home/test/.local/bin/wireproxy",
    );
    expect(runPm2).not.toHaveBeenCalled();
  });

  it("fails before PM2 when the wireproxy config is unavailable", async () => {
    const runPm2 = vi.fn();
    const deps = manager.createDefaultWireproxyDeps({
      homeDir: "/home/test",
      dataDir: "/home/test/.9router",
      runPm2,
      accessFile: vi.fn(async (filePath) => {
        if (filePath.endsWith("wireproxy.conf")) throw new Error("missing");
      }),
    });

    await expect(deps.ensure()).rejects.toThrow(
      "wireproxy config is unavailable: /home/test/.9router/warp/wireproxy.conf",
    );
    expect(runPm2).not.toHaveBeenCalled();
  });

  it("exposes injectable wireproxy lifecycle hooks for start/stop coupling", () => {
    expect(manager.setWireproxyLifecycleDeps).toBeTypeOf("function");
    expect(manager.getWireproxyLifecycleDeps).toBeTypeOf("function");
  });

  it("disables independent MITM auto-restart while fail-together coupling owns lifecycle", () => {
    expect(manager.shouldScheduleMitmRestart({ exitCode: 1, intentionalStop: false })).toBe(false);
  });

  it("exposes only the primary lifecycle coupling surface", () => {
    expect(manager.runWithWireproxyEnsure).toBeUndefined();
    expect(manager.runWithWireproxyStop).toBeUndefined();
    expect(manager.createCoupledMitmActions).toBeUndefined();
    expect(manager.startServer).toBeTypeOf("function");
    expect(manager.stopServer).toBeTypeOf("function");
  });

  it("routes the exported startServer through wireproxy before the injected MITM action", async () => {
    expect(manager.setMitmProcessActions).toBeTypeOf("function");
    const events = [];
    manager.setWireproxyLifecycleDeps({
      ensure: async () => events.push("wireproxy:start"),
      stop: async () => events.push("wireproxy:stop"),
    });
    manager.setMitmProcessActions({
      start: async (...args) => {
        events.push(["mitm:start", ...args]);
        return { running: true, pid: 84 };
      },
      stop: vi.fn(),
    });

    await expect(manager.startServer("test-key", null, true)).resolves.toEqual({
      running: true,
      pid: 84,
    });
    expect(events).toEqual(["wireproxy:start", ["mitm:start", "test-key", null, true]]);
  });

  it("shares one serialized lifecycle across current and legacy start/stop exports", async () => {
    expect(manager.startMitm).toBe(manager.startServer);
    expect(manager.stopMitm).toBe(manager.stopServer);
    let releaseEnsure;
    const ensure = vi.fn(() => new Promise((resolve) => {
      releaseEnsure = () => resolve({ managed: true, pid: 42 });
    }));
    const stop = vi.fn().mockResolvedValue(undefined);
    const start = vi.fn().mockResolvedValue({ running: true, pid: 84 });
    const stopMitmProcess = vi.fn().mockResolvedValue({ running: false, pid: null });
    manager.setWireproxyLifecycleDeps({ ensure, stop, watchExit: vi.fn(() => () => {}) });
    manager.setMitmProcessActions({ start, stop: stopMitmProcess });

    const first = manager.startServer("test-key", null);
    const second = manager.startMitm("test-key", null);
    releaseEnsure();
    await Promise.all([first, second]);
    await manager.stopMitm(null);

    expect(ensure).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledTimes(1);
    expect(stopMitmProcess).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("keeps the first caller arguments while a concurrent start is serialized", async () => {
    let releaseEnsure;
    const ensure = vi.fn(() => new Promise((resolve) => {
      releaseEnsure = () => resolve({ managed: true, pid: 42 });
    }));
    const start = vi.fn().mockResolvedValue({ running: true, pid: 84 });
    manager.setWireproxyLifecycleDeps({
      ensure,
      stop: vi.fn().mockResolvedValue(undefined),
      watchExit: vi.fn(() => () => {}),
    });
    manager.setMitmProcessActions({ start, stop: vi.fn().mockResolvedValue(undefined) });

    const first = manager.startServer("key-A", "password-A", false);
    const second = manager.startServer("key-B", "password-B", true);
    releaseEnsure();
    await Promise.all([first, second]);

    expect(start).toHaveBeenCalledExactlyOnceWith("key-A", "password-A", false);
  });

  it("routes the exported stopServer through the injected MITM action before wireproxy stop", async () => {
    expect(manager.setMitmProcessActions).toBeTypeOf("function");
    const events = [];
    manager.setWireproxyLifecycleDeps({
      ensure: vi.fn().mockResolvedValue({ managed: true, pid: 42 }),
      stop: async () => events.push("wireproxy:stop"),
      watchExit: vi.fn(() => () => {}),
    });
    manager.setMitmProcessActions({
      start: vi.fn().mockResolvedValue({ running: true, pid: 84 }),
      stop: async (...args) => {
        events.push(["mitm:stop", ...args]);
        return { running: false, pid: null };
      },
    });

    await manager.startServer("test-key", null);
    await expect(manager.stopServer("password")).resolves.toEqual({ running: false, pid: null });
    expect(events).toEqual([["mitm:stop", "password"], "wireproxy:stop"]);
  });
});

describe("MITM and wireproxy fail-together lifecycle", () => {
  it("starts wireproxy before MITM and stops both in reverse order", async () => {
    expect(manager.createMitmWireproxyLifecycle).toBeTypeOf("function");
    const harness = createHarness();
    const lifecycle = manager.createMitmWireproxyLifecycle(harness.deps);

    await lifecycle.start();
    await lifecycle.stop();

    expect(harness.deps.watchMitmExit).toHaveBeenCalledWith(84, expect.any(Function));
    expect(harness.events).toEqual([
      "wireproxy:start",
      "mitm:start",
      "mitm:stop",
      "mitm:unwatch",
      "wireproxy:unwatch",
      "wireproxy:stop",
    ]);
  });

  it("does not start MITM when wireproxy cannot be ensured", async () => {
    expect(manager.createMitmWireproxyLifecycle).toBeTypeOf("function");
    const harness = createHarness({ ensureError: new Error("wireproxy unavailable") });
    const lifecycle = manager.createMitmWireproxyLifecycle(harness.deps);

    await expect(lifecycle.start()).rejects.toThrow("wireproxy unavailable");

    expect(harness.deps.startMitmProcess).not.toHaveBeenCalled();
    expect(harness.deps.stopMitmProcess).not.toHaveBeenCalled();
  });

  it("rolls back wireproxy when MITM cannot start", async () => {
    expect(manager.createMitmWireproxyLifecycle).toBeTypeOf("function");
    const harness = createHarness({ mitmStartError: new Error("MITM unavailable") });
    const lifecycle = manager.createMitmWireproxyLifecycle(harness.deps);

    await expect(lifecycle.start()).rejects.toThrow("MITM unavailable");

    expect(harness.events).toEqual(["wireproxy:start", "mitm:start", "wireproxy:stop"]);
  });

  it("preserves the MITM startup error when lifecycle rollback also fails", async () => {
    const primaryError = new Error("MITM boot failed");
    const cleanupError = new Error("wireproxy rollback failed");
    const harness = createHarness({ mitmStartError: primaryError });
    harness.deps.stopWireproxy.mockRejectedValue(cleanupError);
    const lifecycle = manager.createMitmWireproxyLifecycle(harness.deps);

    let rejection;
    try {
      await lifecycle.start();
    } catch (error) {
      rejection = error;
    }

    expect(rejection).toBe(primaryError);
    expect(rejection.cleanupError).toBe(cleanupError);
  });

  it("normalizes a primitive MITM startup failure before attaching rollback failure", async () => {
    const harness = createHarness();
    const cleanupError = new Error("wireproxy rollback failed");
    harness.deps.startMitmProcess.mockRejectedValue("MITM boot failed");
    harness.deps.stopWireproxy.mockRejectedValue(cleanupError);
    const lifecycle = lifecycleModule.createMitmWireproxyLifecycle(harness.deps);

    await expect(lifecycle.start()).rejects.toMatchObject({
      message: "MITM boot failed",
      cleanupError,
    });
  });

  it("stops wireproxy when MITM exits unexpectedly", async () => {
    expect(manager.createMitmWireproxyLifecycle).toBeTypeOf("function");
    const harness = createHarness();
    const lifecycle = manager.createMitmWireproxyLifecycle(harness.deps);
    await lifecycle.start();

    await harness.emitMitmExit();

    expect(harness.deps.stopWireproxy).toHaveBeenCalledTimes(1);
  });

  it("stops MITM when wireproxy exits unexpectedly", async () => {
    expect(manager.createMitmWireproxyLifecycle).toBeTypeOf("function");
    const harness = createHarness();
    const lifecycle = manager.createMitmWireproxyLifecycle(harness.deps);
    await lifecycle.start();

    await harness.emitWireproxyExit();

    expect(harness.deps.stopMitmProcess).toHaveBeenCalledTimes(1);
  });

  it("still stops wireproxy and removes watchers when intentional MITM stop fails", async () => {
    const primaryError = new Error("MITM stop failed");
    const harness = createHarness();
    harness.deps.stopMitmProcess.mockRejectedValue(primaryError);
    const lifecycle = manager.createMitmWireproxyLifecycle(harness.deps);
    await lifecycle.start();

    await expect(lifecycle.stop()).rejects.toBe(primaryError);

    expect(harness.deps.stopWireproxy).toHaveBeenCalledTimes(1);
    expect(harness.events).toContain("mitm:unwatch");
    expect(harness.events).toContain("wireproxy:unwatch");
  });

  it("preserves the MITM stop error when wireproxy cleanup also fails", async () => {
    const primaryError = new Error("MITM stop failed");
    const cleanupError = new Error("wireproxy stop failed");
    const harness = createHarness();
    harness.deps.stopMitmProcess.mockRejectedValue(primaryError);
    harness.deps.stopWireproxy.mockRejectedValue(cleanupError);
    const lifecycle = manager.createMitmWireproxyLifecycle(harness.deps);
    await lifecycle.start();

    let rejection;
    try {
      await lifecycle.stop();
    } catch (error) {
      rejection = error;
    }

    expect(rejection).toBe(primaryError);
    expect(rejection.cleanupError).toBe(cleanupError);
  });

  it("normalizes a primitive MITM stop failure before attaching wireproxy cleanup failure", async () => {
    const harness = createHarness();
    const cleanupError = new Error("wireproxy cleanup failed");
    harness.deps.stopMitmProcess.mockRejectedValue("MITM stop failed");
    harness.deps.stopWireproxy.mockRejectedValue(cleanupError);
    const lifecycle = lifecycleModule.createMitmWireproxyLifecycle(harness.deps);

    await lifecycle.start();
    await expect(lifecycle.stop()).rejects.toMatchObject({
      message: "MITM stop failed",
      cleanupError,
    });
  });

  it("is idempotent across repeated start and stop calls", async () => {
    expect(manager.createMitmWireproxyLifecycle).toBeTypeOf("function");
    const harness = createHarness();
    const lifecycle = manager.createMitmWireproxyLifecycle(harness.deps);

    await lifecycle.start();
    await lifecycle.start();
    await lifecycle.stop();
    await lifecycle.stop();

    expect(harness.deps.ensureWireproxy).toHaveBeenCalledTimes(1);
    expect(harness.deps.startMitmProcess).toHaveBeenCalledTimes(1);
    expect(harness.deps.stopMitmProcess).toHaveBeenCalledTimes(1);
    expect(harness.deps.stopWireproxy).toHaveBeenCalledTimes(1);
  });

  it("returns the active generation result from a repeated start", async () => {
    const harness = createHarness();
    const lifecycle = lifecycleModule.createMitmWireproxyLifecycle(harness.deps);

    const first = await lifecycle.start();
    const repeated = await lifecycle.start();

    expect(repeated).toEqual(first);
    expect(harness.deps.ensureWireproxy).toHaveBeenCalledTimes(1);
    expect(harness.deps.startMitmProcess).toHaveBeenCalledTimes(1);
  });

  it("serializes concurrent start calls into one lifecycle transition", async () => {
    const harness = createHarness();
    let releaseEnsure;
    harness.deps.ensureWireproxy.mockImplementation(
      () => new Promise((resolve) => {
        releaseEnsure = () => resolve({ managed: true, pid: 42 });
      }),
    );
    const lifecycle = manager.createMitmWireproxyLifecycle(harness.deps);

    const first = lifecycle.start();
    const second = lifecycle.start();
    releaseEnsure();
    await Promise.all([first, second]);

    expect(harness.deps.ensureWireproxy).toHaveBeenCalledTimes(1);
    expect(harness.deps.startMitmProcess).toHaveBeenCalledTimes(1);
  });

  it("ignores a stale exit callback from an earlier lifecycle generation", async () => {
    const harness = createHarness();
    const callbacks = [];
    harness.deps.watchMitmExit.mockImplementation((_pid, handler) => {
      callbacks.push(handler);
      return () => harness.events.push("mitm:unwatch");
    });
    const lifecycle = manager.createMitmWireproxyLifecycle(harness.deps);

    await lifecycle.start();
    await lifecycle.stop();
    await lifecycle.start();
    await callbacks[0]();

    expect(harness.deps.stopWireproxy).toHaveBeenCalledTimes(1);
  });

  it("ignores a concurrent exit callback while intentional stop is already running", async () => {
    const harness = createHarness();
    let releaseStop;
    harness.deps.stopMitmProcess.mockImplementation(
      () => new Promise((resolve) => {
        releaseStop = () => {
          harness.events.push("mitm:stop");
          resolve({ running: false, pid: null });
        };
      }),
    );
    const lifecycle = lifecycleModule.createMitmWireproxyLifecycle(harness.deps);

    await lifecycle.start();
    const stopPromise = lifecycle.stop();
    await harness.emitMitmExit();
    releaseStop();
    await stopPromise;

    expect(harness.deps.stopWireproxy).toHaveBeenCalledTimes(1);
    expect(harness.deps.stopMitmProcess).toHaveBeenCalledTimes(1);
  });

  it("returns to stopped without recursion when unexpected-exit peer cleanup fails", async () => {
    const harness = createHarness();
    harness.deps.stopWireproxy.mockRejectedValue(new Error("peer stop failed"));
    const lifecycle = lifecycleModule.createMitmWireproxyLifecycle(harness.deps);

    await lifecycle.start();
    await expect(harness.emitMitmExit()).rejects.toThrow("peer stop failed");

    expect(harness.deps.stopWireproxy).toHaveBeenCalledTimes(1);
    expect(harness.deps.stopMitmProcess).toHaveBeenCalledTimes(0);
    await expect(lifecycle.start()).resolves.toMatchObject({
      mitm: { running: true, pid: 84 },
    });
  });

  it("transitions to stopped and removes watchers when MITM exits unexpectedly", async () => {
    const harness = createHarness();
    const lifecycle = manager.createMitmWireproxyLifecycle(harness.deps);
    await lifecycle.start();

    await harness.emitMitmExit();
    await lifecycle.start();

    expect(harness.events).toContain("mitm:unwatch");
    expect(harness.events).toContain("wireproxy:unwatch");
    expect(harness.deps.ensureWireproxy).toHaveBeenCalledTimes(2);
    expect(harness.deps.startMitmProcess).toHaveBeenCalledTimes(2);
  });
});
