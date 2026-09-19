// Background credential health sweep — the dashboard's connection dot reflects
// reality without clicks or configuration (spec docs/orchestration/OMNIROUTE-DIFF.md T-A).
//
// testSingleConnection already persists testStatus on the manual-test path, so the
// sweep only schedules probes and stamps lastTested; UI components read the
// persisted fields straight from /api/providers, hence no cache/API merge is needed.
//
// Fail-open everywhere: tick errors, probe throws and write failures never kill
// the scheduler. Logs carry id + provider + verdict only — never error text or
// credential material.

export const DEFAULT_INTERVAL_MS = 60 * 60 * 1000;
export const BACKOFF_MS = [5, 10, 30, 120].map((m) => m * 60 * 1000);
export const INCONCLUSIVE_MIN_MS = 30 * 60 * 1000;
export const CONCURRENCY = 5;

const TICK_MS = 5 * 60 * 1000;
const STARTUP_DELAY_MS = 90 * 1000;

const runtime = new Map(); // connectionId -> { nextCheckAt, backoffLevel }
let started = false;
let tickRunning = false;
let initialHandle = null;
let intervalHandle = null;

// providerSpecificData.healthCheckInterval is in minutes; 0 disables the sweep
// for that connection; anything non-numeric falls back to the global default.
export function resolveIntervalMs(connection) {
  const raw = connection?.providerSpecificData?.healthCheckInterval;
  if (raw === undefined || raw === null || raw === "") return DEFAULT_INTERVAL_MS;
  const minutes = Number(raw);
  if (!Number.isFinite(minutes) || minutes < 0) return DEFAULT_INTERVAL_MS;
  return minutes === 0 ? null : minutes * 60 * 1000;
}

function isDue(connection, now) {
  const intervalMs = resolveIntervalMs(connection);
  if (intervalMs === null) return false;
  const state = runtime.get(connection.id);
  if (state) return now >= state.nextCheckAt;
  // No in-memory state (fresh boot): fall back to the persisted stamp.
  const lastTested = Date.parse(connection.lastTested || "");
  return !Number.isFinite(lastTested) || now - lastTested >= intervalMs;
}

function classify(result) {
  if (!result) return "error";
  if (result.error === "Connection not found") return "missing";
  if (!result.valid) return "error";
  return result.error || result.warning ? "inconclusive" : "ok";
}

function nextDelayMs(kind, intervalMs, backoffLevel) {
  if (kind === "error") return BACKOFF_MS[Math.min(backoffLevel, BACKOFF_MS.length - 1)];
  if (kind === "inconclusive") return Math.max(intervalMs, INCONCLUSIVE_MIN_MS);
  return intervalMs;
}

async function defaultLoad() {
  // Dynamic import keeps the sqlite/providers graph out of module load.
  const { getProviderConnections } = await import("@/lib/localDb");
  return getProviderConnections({ isActive: true });
}

async function defaultTest(id) {
  const { testSingleConnection } = await import("@/app/api/providers/[id]/test/testUtils.js");
  return testSingleConnection(id);
}

async function defaultPersist(id, lastTested) {
  const { updateProviderConnection } = await import("@/lib/localDb");
  await updateProviderConnection(id, { lastTested });
}

async function mapWithConcurrency(items, limit, fn) {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      await fn(items[index]);
    }
  });
  await Promise.all(runners);
}

/**
 * One sweep pass. Injectable deps keep it testable without DB or network.
 * @param {{ loadConnections?: Function, testConnection?: Function,
 *           persistLastTested?: Function, now?: Function }} [deps]
 */
export async function runCredentialHealthTick(deps = {}) {
  if (tickRunning) return { skipped: true, tested: 0 };
  tickRunning = true;
  try {
    const load = deps.loadConnections || defaultLoad;
    const test = deps.testConnection || defaultTest;
    const persist = deps.persistLastTested || defaultPersist;
    const now = typeof deps.now === "function" ? deps.now() : Date.now();

    const connections = await load();
    const active = new Set();
    const due = [];
    for (const connection of connections || []) {
      if (!connection || !connection.id) continue;
      active.add(connection.id);
      if (isDue(connection, now)) due.push(connection);
    }
    for (const id of runtime.keys()) {
      if (!active.has(id)) runtime.delete(id);
    }
    if (!due.length) return { tested: 0 };

    await mapWithConcurrency(due, CONCURRENCY, async (connection) => {
      let result;
      try {
        result = await test(connection.id, connection);
      } catch (err) {
        result = { valid: false, error: err?.message };
      }
      const kind = classify(result);
      if (kind === "missing") {
        runtime.delete(connection.id);
        return;
      }
      const intervalMs = resolveIntervalMs(connection) ?? DEFAULT_INTERVAL_MS;
      const state = runtime.get(connection.id) || { nextCheckAt: 0, backoffLevel: 0 };
      if (kind === "ok") state.backoffLevel = 0;
      state.nextCheckAt = now + nextDelayMs(kind, intervalMs, state.backoffLevel);
      if (kind === "error") state.backoffLevel = Math.min(state.backoffLevel + 1, BACKOFF_MS.length - 1);
      runtime.set(connection.id, state);
      try {
        await persist(connection.id, new Date(now).toISOString());
      } catch { /* fail-open: next tick retries the stamp */ }
      console.log(`[credentialHealth] ${connection.provider} ${connection.id} -> ${kind}`);
    });
    return { tested: due.length };
  } catch (err) {
    console.log(`[credentialHealth] tick failed (swallowed): ${err?.message || err}`);
    return { tested: 0 };
  } finally {
    tickRunning = false;
  }
}

// Conservative: any NEXT_PHASE that is not a known server phase (dev or prod
// server) — e.g. production-build / phase-production-build / phase-export —
// must never arm background probes.
function isNonServerProcess() {
  if (typeof window !== "undefined") return true;
  const phase = String(process.env.NEXT_PHASE || "");
  if (!phase) return false;
  return phase !== "phase-production-server" && phase !== "phase-development-server";
}

/**
 * Arm the sweep. Idempotent; disabled by CREDENTIAL_HEALTH=off or during build.
 * @param {{ tickMs?: number, startupDelayMs?: number }} [opts]
 * @returns {boolean} true if this call started the scheduler
 */
export function startCredentialHealth({ tickMs, startupDelayMs } = {}) {
  if (started) return false;
  if (String(process.env.CREDENTIAL_HEALTH || "").toLowerCase() === "off") return false;
  if (isNonServerProcess()) return false;
  started = true;

  const safeTick = () => {
    runCredentialHealthTick().catch((err) => {
      console.log(`[credentialHealth] unhandled tick rejection (swallowed): ${err?.message || err}`);
    });
  };

  const delay = Number.isFinite(startupDelayMs) && startupDelayMs >= 0 ? startupDelayMs : STARTUP_DELAY_MS;
  const period = Number.isFinite(tickMs) && tickMs > 0 ? tickMs : TICK_MS;

  initialHandle = setTimeout(safeTick, delay);
  initialHandle.unref?.();
  intervalHandle = setInterval(safeTick, period);
  intervalHandle.unref?.();
  return true;
}

export function stopCredentialHealth() {
  if (initialHandle) {
    clearTimeout(initialHandle);
    initialHandle = null;
  }
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
  started = false;
}
