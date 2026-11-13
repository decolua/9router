const state = globalThis.__9routerShutdownState ??= {
  flushers: new Set(),
  priorities: new Map(),
  shutdownPromise: null,
  signalHandler: null,
  beforeExitHandler: null,
};

export function registerShutdownFlusher(flush, priority = 0) {
  if (typeof flush !== "function") throw new TypeError("shutdown flusher must be a function");
  state.flushers.add(flush);
  state.priorities.set(flush, Number.isFinite(priority) ? priority : 0);
  installShutdownHandlers();
  return () => {
    state.flushers.delete(flush);
    state.priorities.delete(flush);
  };
}

export function runShutdownFlushers() {
  if (state.shutdownPromise) return state.shutdownPromise;
  state.shutdownPromise = (async () => {
    const groups = new Map();
    for (const flush of state.flushers) {
      const priority = state.priorities.get(flush) ?? 0;
      if (!groups.has(priority)) groups.set(priority, []);
      groups.get(priority).push(flush);
    }
    for (const priority of [...groups.keys()].sort((left, right) => left - right)) {
      const results = await Promise.allSettled(groups.get(priority).map((flush) => Promise.resolve().then(flush)));
      for (const result of results) {
        if (result.status === "rejected") {
          console.error("[Shutdown] flusher failed:", result.reason?.message || result.reason);
        }
      }
    }
  })();
  return state.shutdownPromise;
}

export async function shutdownProcess(exitCode = 0) {
  await runShutdownFlushers();
  process.exit(exitCode);
}

function installShutdownHandlers() {
  state.signalHandler ??= () => shutdownProcess(0);
  state.beforeExitHandler ??= () => runShutdownFlushers();
  if (!process.listeners("SIGINT").includes(state.signalHandler)) process.once("SIGINT", state.signalHandler);
  if (!process.listeners("SIGTERM").includes(state.signalHandler)) process.once("SIGTERM", state.signalHandler);
  if (!process.listeners("beforeExit").includes(state.beforeExitHandler)) {
    process.once("beforeExit", state.beforeExitHandler);
  }
}
