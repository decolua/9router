// Federation failover state machine (FED-004) — spec §3.4.
//
// LINKED → DEGRADED → RECOVERING → LINKED, persisted in
// federation_meta.last_state (via state.js).
//
//   LINKED:      proxy-up; heartbeat GET /api/federation/verify every
//                FEDERATION_HEARTBEAT_INTERVAL_MS. After consecutive
//                failures spanning FEDERATION_OUTAGE_THRESHOLD_MS (with
//                ±20% jitter + reconnect backoff to avoid thundering herd)
//                → DEGRADED. A proxy-side 502/timeout flips immediately
//                (see flipToDegraded, used by proxy.js).
//   DEGRADED:    heartbeat keeps running; on success → RECOVERING, drain
//                pendingWrites (replayBatch), catch up deltas
//                (edgeClient.pullOnce), then LINKED.
//   RECOVERING:  forwarding is NOT paused (proxy.js forwards any state
//                !== 'degraded'); idempotency keys dedupe any overlap
//                between live forwarding and the drain.
//
// No self-promotion: edges never become central — this module only ever
// writes last_state, never role.
//
// Testability: every knob is injectable — fetchImpl, centralUrl, intervalMs,
// thresholdMs, jitter (a function returning a multiplier in [0.8, 1.2]),
// now (clock), and the DB adapter. Tests use fake timers + a fake clock;
// no real sleeps.
import { getAdapter } from "../db/driver.js";
import { isStandalone, isEdge, getCentralUrl, getEdgeId, getHeartbeatIntervalMs, getOutageThresholdMs, getToken } from "./config.js";
import { STATES } from "./constants.js";
import { getEdgeState, setEdgeState } from "./state.js";
import { replayBatch } from "./queue.js";

const FETCH_TIMEOUT_MS = 15000;
// Reconnect backoff: after a failed heartbeat the next attempt is delayed by
// backoffBase * 2^consecutiveFailures, capped at BACKOFF_CAP_MS. The cap
// keeps the edge probing often enough to notice recovery promptly while
// still damping a thundering herd.
const BACKOFF_BASE_MS = 1000;
const BACKOFF_CAP_MS = 30000;

// Default jitter: uniform multiplier in [0.8, 1.2] (spec §3.4 ±20%).
export function defaultJitter() {
  return 0.8 + Math.random() * 0.4;
}

// ─── Heartbeat ──────────────────────────────────────────────────────────

// One heartbeat: GET {centralUrl}/api/federation/verify with
// Authorization: Bearer <FEDERATION_TOKEN> + x-federation-edge-id. Returns
// { ok:true, ...payload } (payload carries role/schemaVersion/revision and,
// since FED-004, leaseOwner/leaseExpiry/fencing_token) or { ok:false,
// error }. NEVER throws — the poll loop must survive transient failures.
export async function heartbeatOnce({ fetchImpl = globalThis.fetch, centralUrl = null, token = null } = {}) {
  const base = centralUrl || getCentralUrl();
  if (!base) return { ok: false, error: "FEDERATION_CENTRAL_URL is not configured" };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetchImpl(`${base}/api/federation/verify`, {
      method: "GET",
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${token || getToken() || ""}`,
        "x-federation-edge-id": getEdgeId(),
      },
    });
    if (!res.ok) {
      return { ok: false, error: `GET /api/federation/verify → HTTP ${res.status}` };
    }
    const payload = await res.json();
    return { ok: true, ...payload };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  } finally {
    clearTimeout(timeout);
  }
}

// ─── Immediate flip (proxy integration) ───────────────────────────────────

// Flip the edge to DEGRADED immediately (spec §3.4: "A proxy-side
// 502/timeout can flip immediately"). Used by proxy.js's onUpstreamFailure
// hook. Never throws; returns the new state (or the current state when the
// edge is already DEGRADED/RECOVERING — a 502 during RECOVERING must not
// yank the state back; the recovery cycle owns the transition).
export async function flipToDegraded({ db = null } = {}) {
  try {
    const adapter = db || (await getAdapter());
    const current = getEdgeState(adapter);
    if (current === STATES.DEGRADED || current === STATES.RECOVERING) return current;
    setEdgeState(adapter, STATES.DEGRADED);
    return STATES.DEGRADED;
  } catch (err) {
    console.warn(`[federation] flipToDegraded failed: ${err?.message || err}`);
    return null;
  }
}

// ─── Recovery ─────────────────────────────────────────────────────────────

// One recovery cycle: drain the pendingWrites queue (batched, idempotent,
// 409-stale rejected), then catch up deltas via edgeClient.pullOnce, then
// LINKED. Returns a status object for tests/diagnostics. Never throws.
export async function recover({ fetchImpl = globalThis.fetch, centralUrl = null, db = null, fencingToken = null } = {}) {
  const adapter = db || (await getAdapter());
  const base = centralUrl || getCentralUrl();
  const out = { drained: 0, done: 0, failed: 0, caughtUp: false, linked: false, error: null };

  if (!base) {
    out.error = "FEDERATION_CENTRAL_URL is not configured";
    return out;
  }

  // 1. Drain the queue (batched; network errors stop the batch and the
  //    remaining rows stay pending for the next cycle). A 409 (stale fence)
  //    triggers one re-verify for a fresh token and a single retry; a
  //    second 409 marks the write failed (never loops).
  const drain = await replayBatch(adapter, {
    fetchImpl,
    centralUrl: base,
    fencingToken,
    onStaleFence: async () => {
      const hb = await heartbeatOnce({ fetchImpl, centralUrl: base });
      return hb.ok ? hb.fencing_token || null : null;
    },
  });
  out.drained = drain.replayed;
  out.done = drain.done;
  out.failed = drain.failed;
  out.stopped = drain.stopped;
  if (drain.stopped) {
    out.error = drain.error || "replay stopped (network error)";
    return out; // stay RECOVERING — retry next cycle
  }

  // 2. Catch up deltas (snapshot when lastAppliedRevision is 0).
  const { pullOnce } = await import("./edgeClient.js");
  const pull = await pullOnce({ fetchImpl, centralUrl: base });
  if (!pull.ok) {
    out.error = pull.error || "delta catch-up failed";
    return out; // stay RECOVERING — retry next cycle
  }
  out.caughtUp = true;

  // 3. LINKED.
  setEdgeState(adapter, STATES.LINKED);
  out.linked = true;
  return out;
}

// ─── Poll loop ───────────────────────────────────────────────────────────

// Start the heartbeat poll loop. Mirrors edgeClient.start()'s shape:
// standalone → warn + return null; non-edge → warn + return null;
// timer.unref(). Tracks consecutive failures; flips to DEGRADED when
// failures span thresholdMs (jittered ±20%, applied to the threshold, plus
// bounded reconnect backoff). On success while DEGRADED → RECOVERING →
// drain → catch up → LINKED. On success while LINKED → reset the streak.
//
// Injectable: fetchImpl, centralUrl, intervalMs, thresholdMs, jitter
// (fn → multiplier), now (clock fn → ms), db. Returns the timer handle or
// null when the loop must not run.
export function start({
  fetchImpl = globalThis.fetch,
  centralUrl = null,
  intervalMs = null,
  thresholdMs = null,
  jitter = defaultJitter,
  now = () => Date.now(),
  db = null,
  backoffBaseMs = BACKOFF_BASE_MS,
  backoffCapMs = BACKOFF_CAP_MS,
} = {}) {
  if (isStandalone()) {
    console.warn("[federation] failover.start() called in standalone mode — failover disabled (zero drift).");
    return null;
  }
  if (!isEdge()) {
    console.warn("[federation] failover.start() called in non-edge mode — failover disabled.");
    return null;
  }

  const interval = intervalMs ?? getHeartbeatIntervalMs();
  const threshold = thresholdMs ?? getOutageThresholdMs();
  let consecutiveFailures = 0;
  let firstFailureAt = null;
  let lastFencingToken = null;

  const tick = async () => {
    let adapter;
    try {
      adapter = db || (await getAdapter());
    } catch (err) {
      console.error("[federation] failover: DB unavailable:", err?.message || err);
      return;
    }

    const result = await heartbeatOnce({ fetchImpl, centralUrl });
    const current = getEdgeState(adapter);

    if (result.ok) {
      // Remember the fencing token central issued (replays must present it).
      if (result.fencing_token) {
        lastFencingToken = result.fencing_token;
        try {
          adapter.run(
            `INSERT INTO federation_meta(id, fencing_token) VALUES(1, ?)
             ON CONFLICT(id) DO UPDATE SET fencing_token = excluded.fencing_token`,
            [result.fencing_token]
          );
        } catch {
          /* non-fatal — in-memory copy still works for this process */
        }
      }
      consecutiveFailures = 0;
      firstFailureAt = null;

      if (current === STATES.DEGRADED) {
        // Heartbeat succeeded → RECOVERING → drain → catch up → LINKED.
        setEdgeState(adapter, STATES.RECOVERING);
        const rec = await recover({ fetchImpl, centralUrl, db: adapter, fencingToken: lastFencingToken });
        if (!rec.linked) {
          console.warn(`[federation] recovery incomplete (${rec.error || "unknown"}); staying RECOVERING — retry next cycle.`);
        }
      } else if (current === STATES.RECOVERING) {
        // A previous recovery cycle was interrupted; finish it.
        const rec = await recover({ fetchImpl, centralUrl, db: adapter, fencingToken: lastFencingToken });
        if (!rec.linked) {
          console.warn(`[federation] recovery incomplete (${rec.error || "unknown"}); staying RECOVERING — retry next cycle.`);
        }
      }
      // LINKED: nothing to do — streak already reset.
      return;
    }

    // Heartbeat failed.
    const t = now();
    if (firstFailureAt === null) firstFailureAt = t;
    consecutiveFailures += 1;

    if (current === STATES.DEGRADED || current === STATES.RECOVERING) {
      // Already out of LINKED — the outage continues; nothing to flip.
      return;
    }

    // Jittered threshold: the flip happens once the failure span reaches
    // threshold * jitter() (jitter in [0.8, 1.2]).
    const jitteredThreshold = threshold * jitter();
    if (t - firstFailureAt >= jitteredThreshold) {
      setEdgeState(adapter, STATES.DEGRADED);
      console.warn(
        `[federation] heartbeat failed ${consecutiveFailures}x over ${Math.round(t - firstFailureAt)}ms ` +
          `(threshold ${Math.round(jitteredThreshold)}ms) — edge DEGRADED.`
      );
    }
  };

  // First heartbeat on the next macrotask (delay 0), then poll on the
  // interval with bounded reconnect backoff after failures (spec §3.4:
  // "backoff to avoid thundering herd"). Self-scheduling setTimeout (not
  // setInterval) so the backoff delay is exact and fake timers can drive it
  // deterministically. The returned handle is always the CURRENT pending
  // timer (replaced on every reschedule).
  let timer = null;
  const loop = () => {
    if (consecutiveFailures > 0) {
      const backoff = Math.min(backoffBaseMs * 2 ** Math.min(consecutiveFailures - 1, 5), backoffCapMs);
      schedule(backoff);
      return;
    }
    schedule(interval);
  };
  const schedule = (delay) => {
    timer = setTimeout(() => {
      tick().then(loop, loop);
    }, delay);
    if (typeof timer.unref === "function") timer.unref();
  };
  schedule(0);
  return timer;
}
