// Single owner of SIGINT/SIGTERM for the server process.
//
// Why this module exists: adapters used to call process.exit(0) on SIGTERM, and
// request handlers persist usage fire-and-forget, so an orderly shutdown could
// drop writes that were already admitted (the SQLite driver being synchronous
// does not make the whole persist synchronous — it awaits the adapter and the
// cost lookup first). This coordinator drains persistence, bounded by a timeout,
// then runs every registered cleanup and exits.
//
// Installed from src/instrumentation.js (server boot, before the first request)
// and again — additively — from initializeApp(), which contributes the tunnel /
// DNS / bridge teardown once it owns those resources.
//
// Explicit limits: this protects an ORDERLY shutdown only. SIGKILL, power loss
// and disk failure are out of scope, and the timeout means a wedged write is
// abandoned rather than waited for forever.

const DEFAULT_DRAIN_TIMEOUT_MS = 3000;
// The hard watchdog must never fire at the same instant as the drain deadline:
// with a zero margin it wins the race and exits before cleanup + closeAdapter
// (the WAL checkpoint) get a turn. The margin is what buys them that turn.
const WATCHDOG_MARGIN_MS = 2000;
// One shutdown delivers the SAME signal more than once: systemd signals every
// process in the cgroup (KillMode=control-group) and the CLI launcher signals
// the server's process group on top of that. Those arrive microseconds apart
// and must NOT read as "the user asked again" — that would abort the drain the
// moment it started. A genuinely repeated signal (a second Ctrl-C) comes later.
const REPEAT_SIGNAL_GRACE_MS = 1000;

const state = global.__shutdownCoordinator ??= {
  installed: false,
  started: false,
  shuttingDown: false,
  inflightCount: 0,
  servers: new Set(),
  inflightWaiters: new Set(),
  // Cleanups are additive: the coordinator is installed early (instrumentation,
  // before the first request) and initializeApp registers the tunnel/DNS/bridge
  // teardown later, once it owns those resources.
  cleanups: new Set(),
  drainTimeoutMs: DEFAULT_DRAIN_TIMEOUT_MS,
};
if (!state.cleanups) state.cleanups = new Set();
if (!state.drainTimeoutMs) state.drainTimeoutMs = DEFAULT_DRAIN_TIMEOUT_MS;

export function isShuttingDown() {
  return !!state.shuttingDown;
}

export function stopAdmission() {
  state.shuttingDown = true;
  for (const server of state.servers) {
    try {
      if (typeof server.close === "function") {
        server.close();
      }
    } catch {}
  }
}

export function registerHttpServer(server) {
  if (server) state.servers.add(server);
}

export function trackHttpRequest(req, res, handlerPromise) {
  if (state.shuttingDown) return false;
  state.inflightCount++;
  let decremented = false;
  let resDone = false;
  let promiseDone = !handlerPromise || typeof handlerPromise.then !== "function";

  const onEnd = () => {
    if (!decremented) {
      decremented = true;
      state.inflightCount = Math.max(0, state.inflightCount - 1);
      if (state.inflightCount === 0) {
        for (const fn of state.inflightWaiters) {
          try { fn(); } catch {}
        }
        state.inflightWaiters.clear();
      }
    }
  };

  const checkDone = () => {
    if (resDone && promiseDone) {
      onEnd();
    }
  };

  const onResEnd = () => {
    resDone = true;
    checkDone();
  };

  res.once("finish", onResEnd);
  res.once("close", onResEnd);

  if (!promiseDone) {
    // then(onSettle, onSettle) rather than finally(): finally() forwards the
    // rejection into a new promise nobody awaits, i.e. an unhandled rejection
    // every time a request handler throws during shutdown.
    const onSettle = () => {
      promiseDone = true;
      checkDone();
    };
    handlerPromise.then(onSettle, onSettle);
  }

  return true;
}

// Wire CJS-compatible global functions
state.isShuttingDown = isShuttingDown;
state.stopAdmission = stopAdmission;
state.registerServer = registerHttpServer;
state.trackRequest = trackHttpRequest;

async function awaitInflightHttpRequests(timeoutMs) {
  if (state.inflightCount <= 0) return true;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      state.inflightWaiters.delete(onDone);
      resolve(false);
    }, Math.max(10, timeoutMs));

    function onDone() {
      clearTimeout(timer);
      resolve(true);
    }
    state.inflightWaiters.add(onDone);
  });
}

/**
 * Drain in-flight usage persistences and buffered request details.
 * Whole execution is bounded by timeoutMs.
 * Never throws; returns what it observed so callers can log/report.
 */
export async function drainPersistenceNow({ timeoutMs = DEFAULT_DRAIN_TIMEOUT_MS } = {}) {
  const t0 = Date.now();
  state.shuttingDown = true;
  stopAdmission();

  let timedOut = false;
  let usage = { admitted: 0, pending: 0, failed: 0, failedTotal: 0, timedOut: false, drained: 0 };
  let detailsBuffered = 0;

  const performDrain = async () => {
    const elapsed = () => Date.now() - t0;
    const remaining = () => Math.max(50, timeoutMs - elapsed());

    // Step 1: Await inflight HTTP requests
    if (state.inflightCount > 0) {
      await awaitInflightHttpRequests(remaining());
    }

    // Step 2 & 3: Drain usage persistence and flush request details
    try {
      const { drainPendingUsage, flushRequestDetailsNow } = await import("@/lib/usageDb.js");
      usage = await drainPendingUsage({ timeoutMs: remaining() });
      detailsBuffered = await flushRequestDetailsNow();
    } catch (e) {
      console.error("[Shutdown] persistence drain failed:", e?.message || e);
    }
  };

  let timer;
  const timeoutPromise = new Promise((resolve) => {
    timer = setTimeout(() => {
      timedOut = true;
      resolve();
    }, timeoutMs);
  });

  try {
    await Promise.race([performDrain(), timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }

  if (timedOut) {
    // The outer deadline can beat drainPendingUsage's own: then `usage` is still
    // the zeroed placeholder and would under-report the loss. Read the live
    // in-flight set (usageRepo's own global) so the log and the exit code
    // describe what is actually still parked.
    const stillInFlight = global._pendingUsagePersists?.inflight?.size ?? 0;
    if (stillInFlight > usage.pending) {
      usage = { ...usage, pending: stillInFlight, timedOut: true };
    }
    console.warn(`[Shutdown] whole drain timed out after ${timeoutMs}ms (inflightHttp=${state.inflightCount}, usagePending=${usage.pending})`);
  } else {
    console.log(
      `[Shutdown] persistence drained in ${Date.now() - t0}ms ` +
      `(usage drained=${usage.drained} pending=${usage.pending} failed=${usage.failed}, details buffered=${detailsBuffered})`,
    );
  }

  return { usage, detailsBuffered, timedOut };
}

/**
 * Register teardown work to run after the drain, without taking ownership of the
 * signal handlers. Safe to call before or after installShutdownCoordinator().
 */
export function registerShutdownCleanup(cleanup) {
  if (typeof cleanup === "function") state.cleanups.add(cleanup);
  return () => state.cleanups.delete(cleanup);
}

/**
 * Install the process signal handlers once. `cleanup` runs after the drain
 * (removeAllDNSEntriesSync, killAllBridges, killCloudflared…).
 * A repeated signal forces an immediate exit instead of draining again.
 *
 * Idempotent and additive: the first caller wins the handlers, every caller's
 * cleanup is kept. That is what lets instrumentation.js install the coordinator
 * at server boot — before any request can be served — while initializeApp still
 * contributes its tunnel/DNS teardown when it runs later.
 */
export function installShutdownCoordinator({ drainTimeoutMs, cleanup } = {}) {
  if (typeof cleanup === "function") state.cleanups.add(cleanup);
  if (Number.isFinite(drainTimeoutMs) && drainTimeoutMs > 0) state.drainTimeoutMs = drainTimeoutMs;
  if (state.installed) return false;
  state.installed = true;

  const handle = async (signal) => {
    if (state.started) {
      if (Date.now() - (state.startedAt || 0) < REPEAT_SIGNAL_GRACE_MS) {
        // Duplicate delivery of the same shutdown — keep draining.
        return;
      }
      console.warn(`[Shutdown] repeated ${signal} — forcing immediate exit`);
      process.exit(1);
    }
    state.started = true;
    state.startedAt = Date.now();
    state.shuttingDown = true;
    stopAdmission();

    const budgetMs = state.drainTimeoutMs;
    const watchdog = setTimeout(() => {
      console.error(`[Shutdown] HARD TIMEOUT after ${budgetMs + WATCHDOG_MARGIN_MS}ms — forcing exit(1)`);
      process.exit(1);
    }, budgetMs + WATCHDOG_MARGIN_MS);
    watchdog.unref?.();

    let exitCode = 0;
    try {
      const res = await drainPersistenceNow({ timeoutMs: budgetMs });
      const lostDetails = res.detailsBuffered > 0;
      if (res.timedOut || lostDetails || (res.usage && (res.usage.pending > 0 || res.usage.failed > 0))) {
        console.warn(`[Shutdown] persistence incomplete (pending=${res.usage?.pending || 0}, failed=${res.usage?.failed || 0}, detailsBuffered=${res.detailsBuffered || 0}, timedOut=${res.timedOut}) — exit code 1`);
        exitCode = 1;
      }
    } catch (e) {
      console.error("[Shutdown] drain step error:", e?.message || e);
      exitCode = 1;
    }

    for (const fn of state.cleanups) {
      try { await Promise.resolve(fn()); } catch (e) {
        console.error("[Shutdown] cleanup error:", e?.message || e);
        exitCode = 1;
      }
    }
    try {
      const { closeAdapter } = await import("@/lib/usageDb.js");
      await closeAdapter();
    } catch (e) {
      console.error("[Shutdown] closeAdapter error:", e?.message || e);
      exitCode = 1;
    }

    clearTimeout(watchdog);
    process.exit(exitCode);
  };

  process.on("SIGINT", () => { handle("SIGINT").catch(() => process.exit(1)); });
  process.on("SIGTERM", () => { handle("SIGTERM").catch(() => process.exit(1)); });
  return true;
}

