// Single process-lifecycle owner. Modules register ordered, idempotent shutdown
// steps here instead of attaching their own SIGINT/SIGTERM listeners, so an
// async flush (request-details Timslite drain + SQLite pointer write) can finish
// before any database handle is closed or the process exits.

export const ShutdownPhase = Object.freeze({
  FLUSH: 0,
  CLOSE: 100,
  CLEANUP: 200,
});

const SIGNALS = ["SIGINT", "SIGTERM"];

const g = (global.__shutdownCoordinator ??= {
  installed: false,
  signalWrappers: null,
  steps: new Map(),
  seq: 0,
  running: null,
  signalExitPromise: null,
  lastReason: null,
});

function errorMessage(error) {
  if (error && typeof error.message === "string") return error.message;
  return String(error);
}

function orderedSteps() {
  return [...g.steps.values()].sort((a, b) => (a.phase - b.phase) || (a.seq - b.seq));
}

export function registerShutdownStep(name, fn, { phase = ShutdownPhase.CLOSE } = {}) {
  if (typeof fn !== "function") {
    throw new TypeError(`[shutdownCoordinator] step "${name}" must be a function`);
  }
  const existing = g.steps.get(name);
  const step = { name, fn, phase, seq: existing ? existing.seq : ++g.seq };
  g.steps.set(name, step);
  return () => {
    if (g.steps.get(name) === step) g.steps.delete(name);
  };
}

export function hasShutdownStep(name) {
  return g.steps.has(name);
}

export function isShuttingDown() {
  return g.running !== null;
}

export function runShutdown(reason = "manual") {
  if (g.running) return g.running;
  g.lastReason = reason;
  const steps = orderedSteps();
  g.running = (async () => {
    for (const step of steps) {
      try {
        await step.fn();
      } catch (error) {
        console.error(`[shutdown] step "${step.name}" failed: ${errorMessage(error)}`);
      }
    }
  })();
  return g.running;
}

export function handleSignal(signal) {
  if (g.signalExitPromise) return g.signalExitPromise;
  g.signalExitPromise = (async () => {
    await runShutdown(signal);
    process.exit(0);
  })();
  return g.signalExitPromise;
}

export function installProcessSignalHandlers() {
  if (g.installed) return;
  g.installed = true;
  g.signalWrappers = {
    beforeExit: () => { runShutdown("beforeExit"); },
    ...Object.fromEntries(SIGNALS.map((signal) => [
      signal,
      () => { handleSignal(signal).catch((error) => console.error(`[shutdown] ${signal} handler failed: ${errorMessage(error)}`)); },
    ])),
  };
  process.on("beforeExit", g.signalWrappers.beforeExit);
  for (const signal of SIGNALS) process.on(signal, g.signalWrappers[signal]);
}

export function uninstallProcessSignalHandlers() {
  if (!g.installed) return;
  if (g.signalWrappers) {
    process.off("beforeExit", g.signalWrappers.beforeExit);
    for (const signal of SIGNALS) process.off(signal, g.signalWrappers[signal]);
  }
  g.signalWrappers = null;
  g.installed = false;
}

export const __test__ = {
  reset() {
    uninstallProcessSignalHandlers();
    g.steps.clear();
    g.seq = 0;
    g.running = null;
    g.signalExitPromise = null;
    g.lastReason = null;
  },
  snapshot: () => orderedSteps().map(({ name, phase }) => ({ name, phase })),
  getLastReason: () => g.lastReason,
};
