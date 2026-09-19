// T3.3 — proactive OAuth refresh sweep (spec docs/orchestration/OMNIROUTE-DIFF.md
// T-C, ported from OmniRoute tokenHealthCheck.ts). Renews OAuth access tokens
// BEFORE they expire so requests never ride on a dead token, with a persisted
// error circuit so a broken credential is not hammered.
//
// Design constraints (verified against the code, F26/F27 neighbourhood):
//  * Refresh goes through open-sse oauthCredentialManager.refreshProviderCredentials,
//    which already wraps `withCredentialRefreshLock` (single-flight key
//    provider:connectionId + ALS reentrancy). The F26 reactive 401 path in
//    chatCore takes the SAME lock with the SAME key, so a sweep attempt and a
//    concurrent request refresh coalesce into one upstream POST instead of
//    racing to replay a rotating refresh_token. No new lock is implemented here.
//  * Multi-process locking is explicitly OUT of scope (DECISIONS backlog).
//  * Failure patches never include `refreshToken` (truthy-only persistence via
//    updateProviderCredentials on success, delta-only patches on failure) — an
//    invalid_grant can never null-wipe a rotating provider's RT.
//  * The expired mark only ever patches testStatus/lastError/providerSpecificData.
//    modelLock_* keys are never written from here: resetHealthStateOnActivation
//    (connectionsRepo) only wipes them for testStatus:"active" patches, which
//    this sweep never sends.
//
// Fail-open everywhere: tick errors, refresh throws and write failures never
// kill the scheduler. Logs carry id + provider + verdict only — never error
// text or credential material.

import {
  REFRESH_WINDOW_MS,
  EXPIRED_BUDGET_FAILURES,
  canRefreshNow,
  isOAuthRefreshCandidate,
  nextFailureCircuit,
  expiryMarkCircuit,
  buildSuccessPersistPayload,
  pruneFailureWindow,
} from "./refreshCircuit.js";

export const TICK_MS = 60 * 1000;
export const STARTUP_DELAY_MS = 90 * 1000;
const STAGGER_MS = 1500;
const EXPIRED_MARK_ERROR = "token refresh failed (proactive sweep)";

// Lazy graph holders — module load stays free of the sqlite/providers chain,
// mirroring the T3.1 credentialHealth scheduler.
let corePromise = null;
function loadCore() {
  if (!corePromise) {
    const p = Promise.all([
      import("open-sse/services/oauthCredentialManager.js"),
      import("open-sse/services/tokenRefresh.js"),
    ]).then(([manager, refresher]) => ({
      shouldRefreshCredentials: manager.shouldRefreshCredentials,
      getCredentialExpiryMs: manager.getCredentialExpiryMs,
      refreshProviderCredentials: manager.refreshProviderCredentials,
      isUnrecoverableRefreshError: refresher.isUnrecoverableRefreshError,
    }));
    corePromise = p;
    p.catch(() => {
      if (corePromise === p) corePromise = null;
    });
  }
  return corePromise;
}

async function defaultLoad() {
  const { getProviderConnections } = await import("@/lib/localDb");
  return getProviderConnections({ isActive: true });
}

async function defaultRefresh(connection, core) {
  const { refreshProviderCredentials } = core;
  const log = await import("@/sse/utils/logger.js");
  // refreshProviderCredentials takes the credential-refresh lock internally
  // (single-flight with the F26 reactive path) — do not wrap it again.
  return refreshProviderCredentials(
    connection.provider,
    { ...connection, connectionId: connection.id },
    log
  );
}

async function defaultPersist(id, connection, refreshed) {
  const { getProviderConnectionById } = await import("@/lib/localDb");
  const { updateProviderCredentials } = await import("@/sse/services/tokenRefresh.js");
  // Re-read the row so a concurrent reactive persist is not clobbered by our
  // (possibly stale) in-memory providerSpecificData snapshot.
  const fresh = await getProviderConnectionById(id);
  const base = fresh?.providerSpecificData || connection.providerSpecificData || {};
  // updateProviderCredentials writes truthy credential fields only (it can
  // never null-wipe a rotating refreshToken) and returns false on failure.
  return updateProviderCredentials(id, buildSuccessPersistPayload(base, refreshed));
}

async function defaultPatch(id, patch) {
  const { getProviderConnectionById, updateProviderConnection } = await import("@/lib/localDb");
  let finalPatch = patch;
  if (patch && patch.providerSpecificData) {
    // Patches carry the providerSpecificData DELTA only; merge over the
    // freshest stored object so sibling keys (copilotToken, chatgptAccountId…)
    // are not lost to our stale snapshot.
    const fresh = await getProviderConnectionById(id);
    finalPatch = {
      ...patch,
      providerSpecificData: {
        ...(fresh?.providerSpecificData || {}),
        ...patch.providerSpecificData,
      },
    };
  }
  return updateProviderConnection(id, finalPatch);
}

let tickRunning = false;
let started = false;
let initialHandle = null;
let intervalHandle = null;
const failureWindow = new Map(); // connectionId -> [failureTs] for the 3×/5min budget

function classifyOutcome(result, core) {
  if (result && core.isUnrecoverableRefreshError(result)) return "unrecoverable";
  if (result && (result.accessToken || result.apiKey || result.token || result.copilotToken)) return "ok";
  return "failed";
}

/**
 * One sweep pass. Injectable deps keep it testable without DB or network.
 * @param {{ loadConnections?: Function, refresh?: Function,
 *           persistCredentials?: Function, patchConnection?: Function,
 *           sleep?: Function, now?: Function }} [deps]
 */
export async function runTokenHealthTick(deps = {}) {
  if (tickRunning) return { skipped: true, attempted: 0, refreshed: 0, failed: 0 };
  tickRunning = true;
  try {
    const now = typeof deps.now === "function" ? deps.now() : Date.now();
    const load = deps.loadConnections || defaultLoad;
    const connections = await load();

    const candidates = [];
    const alive = new Set();
    for (const connection of connections || []) {
      if (!connection || !connection.id) continue;
      alive.add(connection.id);
      if (!isOAuthRefreshCandidate(connection)) continue;
      if (!canRefreshNow(connection, now)) continue; // persisted backoff window
      candidates.push(connection);
    }
    for (const id of failureWindow.keys()) {
      if (!alive.has(id)) failureWindow.delete(id);
    }
    if (!candidates.length) return { attempted: 0, refreshed: 0, failed: 0 };

    const core = await loadCore();
    const refresh = deps.refresh || ((conn) => defaultRefresh(conn, core));
    const persist = deps.persistCredentials || defaultPersist;
    const patch = deps.patchConnection || defaultPatch;
    const sleep = deps.sleep || ((ms) => new Promise((res) => setTimeout(res, ms)));

    let attempted = 0;
    let refreshed = 0;
    let failed = 0;

    for (const conn of candidates) {
      // Renew before expiry: provider lead (shouldRefreshCredentials) or the
      // 10-minute proactive window; an already-expired token also qualifies.
      let expiresAtMs = null;
      try {
        expiresAtMs = core.getCredentialExpiryMs(conn);
      } catch { /* fail-open: treated as unknown expiry below */ }
      const remainingMs = expiresAtMs === null ? null : expiresAtMs - now;
      const alreadyExpired = remainingMs !== null && remainingMs <= 0;
      let due = false;
      try {
        due = core.shouldRefreshCredentials(conn.provider, conn, now);
      } catch { /* fail-open: fall back to window check */ }
      if (!due) due = remainingMs !== null && remainingMs < REFRESH_WINDOW_MS;
      if (!due) continue;

      let failures = pruneFailureWindow(failureWindow.get(conn.id) || [], now);
      if (alreadyExpired && failures.length >= EXPIRED_BUDGET_FAILURES) continue; // budget spent, awaiting circuit/mark

      if (attempted > 0) {
        try { await sleep(STAGGER_MS); } catch { /* fail-open */ }
      }
      attempted++;

      let outcome;
      let result;
      try {
        result = await refresh(conn);
        outcome = classifyOutcome(result, core);
      } catch {
        outcome = "failed";
      }

      if (outcome === "ok") {
        let ok = true;
        try {
          ok = await persist(conn.id, conn, result);
        } catch {
          ok = false;
        }
        if (ok === false) {
          // Refresh itself worked but the write hiccuped: leave the failure
          // window untouched, the next tick re-reads and retries.
          console.log(`[tokenHealth] ${conn.provider} ${conn.id} -> persist_failed`);
          continue;
        }
        refreshed++;
        failureWindow.delete(conn.id);
        console.log(`[tokenHealth] ${conn.provider} ${conn.id} -> refreshed`);
        continue;
      }

      failed++;
      failures = [...failures, now];
      failureWindow.set(conn.id, failures);

      if (alreadyExpired && failures.length >= EXPIRED_BUDGET_FAILURES) {
        // 3 failures within 5 minutes on an already-expired token: mark the
        // connection expired (minimal patch — testStatus/lastError/PSD delta
        // only; no refreshToken, no modelLock_* keys, never testStatus:"active")
        // and open the circuit at the longest backoff step.
        try {
          await patch(conn.id, {
            testStatus: "expired",
            lastError: EXPIRED_MARK_ERROR,
            lastErrorAt: new Date(now).toISOString(),
            providerSpecificData: expiryMarkCircuit(conn, now),
          });
        } catch { /* fail-open: budget stays spent for the next 5min window */ }
        failureWindow.delete(conn.id);
        console.log(`[tokenHealth] ${conn.provider} ${conn.id} -> marked_expired`);
        continue;
      }

      if (!alreadyExpired) {
        // Pre-expiry failures get the persisted 5→10→30→120min backoff ladder.
        // Expired tokens below budget just retry on the next tick (60s) — the
        // 3×/5min window IS their pacing before the expired mark.
        try {
          await patch(conn.id, {
            providerSpecificData: nextFailureCircuit(conn, now),
          });
        } catch { /* fail-open: next tick retries without the stamp */ }
      }
      console.log(`[tokenHealth] ${conn.provider} ${conn.id} -> ${outcome === "unrecoverable" ? "refresh_unrecoverable" : "refresh_failed"}`);
    }

    return { attempted, refreshed, failed };
  } catch (err) {
    console.log(`[tokenHealth] tick failed (swallowed): ${err?.message || err}`);
    return { attempted: 0, refreshed: 0, failed: 0 };
  } finally {
    tickRunning = false;
  }
}

// Conservative: any NEXT_PHASE that is not a known server phase (dev or prod
// server) — e.g. production-build / phase-production-build / phase-export —
// must never arm background refreshes. Mirrors the T3.1 guard.
function isNonServerProcess() {
  if (typeof window !== "undefined") return true;
  const phase = String(process.env.NEXT_PHASE || "");
  if (!phase) return false;
  return phase !== "phase-production-server" && phase !== "phase-development-server";
}

/**
 * Arm the sweep. Idempotent; disabled by TOKEN_HEALTH=off or during build.
 * @param {{ tickMs?: number, startupDelayMs?: number }} [opts]
 * @returns {boolean} true if this call started the scheduler
 */
export function startTokenHealth({ tickMs, startupDelayMs } = {}) {
  if (started) return false;
  if (String(process.env.TOKEN_HEALTH || "").toLowerCase() === "off") return false;
  if (isNonServerProcess()) return false;
  started = true;

  const safeTick = () => {
    runTokenHealthTick().catch((err) => {
      console.log(`[tokenHealth] unhandled tick rejection (swallowed): ${err?.message || err}`);
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

export function stopTokenHealth() {
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
