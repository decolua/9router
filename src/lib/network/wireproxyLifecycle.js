async function rollbackPreservingError(error, rollback) {
  const primaryError = error instanceof Error ? error : new Error(String(error));
  try {
    await rollback();
  } catch (cleanupError) {
    primaryError.cleanupError = cleanupError;
  }
  throw primaryError;
}

function createPm2CliAdapter({ execFile, pm2Binary = "pm2" }) {
  function execute(args) {
    return new Promise((resolve, reject) => {
      execFile(pm2Binary, args, (error, stdout) => {
        if (error) return reject(error);
        resolve(stdout);
      });
    });
  }

  async function runPm2(action, args) {
    const processName = args[0];
    if (action === "describe") {
      const stdout = await execute(["jlist"]);
      let processes;
      try {
        processes = JSON.parse(stdout);
      } catch (error) {
        throw new Error("Failed to parse PM2 process list", { cause: error });
      }
      if (!Array.isArray(processes)) throw new Error("PM2 process list must be an array");
      const process = processes.find((candidate) => candidate.name === processName);
      return process
        ? { pid: process.pid, status: process.pm2_env?.status }
        : null;
    }

    await execute([action, ...args]);
    return null;
  }

  return { runPm2 };
}

function waitForTcpPort(host, port, {
  timeoutMs = 10000,
  intervalMs = 100,
  connect,
} = {}) {
  const connectSocket = connect || ((options) => require("net").connect(options));
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    let activeSocket = null;
    let retryTimer = null;
    let completed = false;
    const timeoutError = () => new Error(`Timed out waiting for wireproxy at ${host}:${port}`);
    const deadlineTimer = setTimeout(() => {
      if (completed) return;
      completed = true;
      clearTimeout(retryTimer);
      activeSocket?.destroy();
      reject(timeoutError());
    }, timeoutMs);

    function attempt() {
      if (completed) return;
      let settled = false;
      const socket = connectSocket({ host, port });
      activeSocket = socket;
      socket.once("connect", () => {
        if (settled || completed) return;
        settled = true;
        completed = true;
        clearTimeout(deadlineTimer);
        socket.destroy();
        resolve();
      });
      socket.once("error", () => {
        if (settled || completed) return;
        settled = true;
        socket.destroy();
        activeSocket = null;
        if (Date.now() - startedAt >= timeoutMs) {
          completed = true;
          clearTimeout(deadlineTimer);
          reject(timeoutError());
          return;
        }
        retryTimer = setTimeout(attempt, intervalMs);
      });
    }
    attempt();
  });
}

function watchProcessExit(pid, callback, {
  isProcessAlive = (processId) => {
    try {
      process.kill(processId, 0);
      return true;
    } catch {
      return false;
    }
  },
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  intervalMs = 1000,
  onError = () => {},
} = {}) {
  let disposed = false;
  let notified = false;
  const timer = setIntervalFn(async () => {
    if (disposed || notified || isProcessAlive(pid)) return;
    notified = true;
    clearIntervalFn(timer);
    try {
      await callback();
    } catch (error) {
      onError(error);
    }
  }, intervalMs);
  timer?.unref?.();

  return () => {
    if (disposed) return;
    disposed = true;
    clearIntervalFn(timer);
  };
}

function watchPm2ProcessIdentity(processName, pid, callback, {
  runPm2,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  intervalMs = 1000,
  onError = () => {},
} = {}) {
  let disposed = false;
  let notified = false;
  const timer = setIntervalFn(async () => {
    if (disposed || notified) return;
    try {
      const current = await runPm2("describe", [processName]);
      if (current?.status === "online" && current.pid === pid) return;
      notified = true;
      clearIntervalFn(timer);
      await callback();
    } catch (error) {
      onError(error);
    }
  }, intervalMs);
  timer?.unref?.();

  return () => {
    if (disposed) return;
    disposed = true;
    clearIntervalFn(timer);
  };
}

function createWireproxyProcessManager({
  runPm2,
  waitForPort,
  processName,
  binaryPath,
  configPath,
  host,
  port,
}) {
  async function ensure() {
    let process = await runPm2("describe", [processName]);
    if (!process || process.status !== "online") {
      process = await runPm2("start", [binaryPath, "--name", processName, "--", "-c", configPath]);
      if (!process || process.status !== "online" || !process.pid) {
        process = await runPm2("describe", [processName]);
      }
    }
    if (!process || process.status !== "online" || !process.pid) {
      throw new Error(`PM2 did not report "${processName}" online after start`);
    }
    await waitForPort(host, port);
    return { managed: true, pid: process.pid };
  }

  async function stop() {
    await runPm2("stop", [processName]);
  }

  return { ensure, stop };
}

function createMitmWireproxyLifecycle({
  ensureWireproxy,
  stopWireproxy,
  startMitmProcess,
  stopMitmProcess,
  watchMitmExit,
  watchWireproxyExit,
}) {
  let stopMitmWatch = null;
  let stopWireproxyWatch = null;
  let state = "stopped";
  let startPromise = null;
  let activeResult = null;
  let generation = 0;

  function removeWatchers() {
    stopMitmWatch?.();
    stopMitmWatch = null;
    stopWireproxyWatch?.();
    stopWireproxyWatch = null;
  }

  async function rollbackStartedPeers(primaryError, mitmStarted) {
    const normalizedError = primaryError instanceof Error
      ? primaryError
      : new Error(String(primaryError));
    removeWatchers();
    const cleanupErrors = [];
    if (mitmStarted) {
      try {
        await stopMitmProcess();
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    try {
      await stopWireproxy();
    } catch (error) {
      cleanupErrors.push(error);
    }
    if (cleanupErrors.length === 1) normalizedError.cleanupError = cleanupErrors[0];
    if (cleanupErrors.length > 1) normalizedError.cleanupError = new AggregateError(cleanupErrors);
    throw normalizedError;
  }

  async function stop(...stopArgs) {
    if (state === "starting" && startPromise) await startPromise;
    if (state !== "running") return;
    state = "stopping";
    generation += 1;
    let result;
    let primaryError;
    try {
      result = await stopMitmProcess(...stopArgs);
    } catch (error) {
      primaryError = error instanceof Error ? error : new Error(String(error));
    }
    removeWatchers();
    try {
      await stopWireproxy();
    } catch (cleanupError) {
      if (primaryError) primaryError.cleanupError = cleanupError;
      else primaryError = cleanupError;
    } finally {
      state = "stopped";
      activeResult = null;
    }
    if (primaryError) throw primaryError;
    return result;
  }

  async function handleUnexpectedExit(watchedGeneration, stopPeer) {
    if (state !== "running" || watchedGeneration !== generation) return;
    state = "stopping";
    generation += 1;
    removeWatchers();
    try {
      await stopPeer();
    } finally {
      state = "stopped";
      activeResult = null;
    }
  }

  function start(...startArgs) {
    if (state === "running") return Promise.resolve(activeResult);
    if (state === "starting" && startPromise) return startPromise;

    state = "starting";
    startPromise = (async () => {
      let wireproxy;
      let mitm;
      try {
        wireproxy = await ensureWireproxy();
        mitm = await startMitmProcess(...startArgs);
        state = "running";
        generation += 1;
        const watchedGeneration = generation;
        stopMitmWatch = watchMitmExit(
          mitm.pid,
          () => handleUnexpectedExit(watchedGeneration, stopWireproxy),
        );
        stopWireproxyWatch = watchWireproxyExit(
          wireproxy.pid,
          () => handleUnexpectedExit(watchedGeneration, stopMitmProcess),
        );
        activeResult = { mitm, wireproxy };
        return activeResult;
      } catch (error) {
        state = "stopped";
        activeResult = null;
        if (wireproxy) return rollbackStartedPeers(error, Boolean(mitm));
        throw error;
      } finally {
        startPromise = null;
      }
    })();
    return startPromise;
  }

  return { start, stop };
}

module.exports = {
  rollbackPreservingError,
  createPm2CliAdapter,
  waitForTcpPort,
  watchProcessExit,
  watchPm2ProcessIdentity,
  createWireproxyProcessManager,
  createMitmWireproxyLifecycle,
};
