// Federation loop starter (FED-013).
//
// Starts the replication pull loop (edgeClient.start) and the failover
// heartbeat loop (failover.start) from REAL entry points — custom-server.js
// on "listening" and instrumentation.js register(). Before FED-013 only the
// e2e harness (tests/federation/e2e-child.mjs) called them, so a real edge
// deployment never replicated (empty replica) and never recovered from a
// central outage (stuck DEGRADED, pendingWrites never drained).
//
// Zero drift: standalone/central modes start NOTHING (returns
// { started:false, ... }) without importing the loop modules. The
// underlying start() functions self-gate too; the mode check here exists so
// non-edge deployments never even pay the import.
//
// Fail-open everywhere: an import failure (deployment image without
// src/lib/federation) or a throwing start() logs and continues — this must
// never crash a listening server.
//
// Double-start safe: a module-level guard returns the existing handles on
// repeat calls (custom-server's listening hook AND instrumentation's
// register() can both fire in the same process).
//
// Intervals: when intervalMs/thresholdMs are not provided, the loops use
// the env-driven config defaults (FEDERATION_SYNC_INTERVAL_MS=5000,
// FEDERATION_HEARTBEAT_INTERVAL_MS=2000, FEDERATION_OUTAGE_THRESHOLD_MS=
// 15000) via edgeClient/failover themselves — no duplicated defaults here.
import { isEdge } from "./config.js";

let _handles = null;

export async function startFederationLoops({
  edgeClient = null,
  failover = null,
  fetchImpl = undefined,
  centralUrl = null,
  intervalMs = null,
  thresholdMs = null,
  edgeClientOptions = {},
  failoverOptions = {},
} = {}) {
  if (!isEdge()) {
    // standalone/central → zero drift: nothing starts, nothing is imported.
    return { started: false, edgeClient: null, failover: null };
  }
  if (_handles) return _handles; // double-start guard

  let ec = edgeClient;
  let fo = failover;
  if (!ec || !fo) {
    try {
      if (!ec) ec = await import("./edgeClient.js");
      if (!fo) fo = await import("./failover.js");
    } catch (e) {
      // Fail-open: the modules may be absent from the deployment image.
      // NOT cached in _handles — a later call may retry.
      console.error("[federation] loop modules unavailable:", e && e.message ? e.message : e);
      return { started: false, edgeClient: null, failover: null };
    }
  }

  const handles = { started: false, edgeClient: null, failover: null };
  try {
    handles.edgeClient = ec.start({ fetchImpl, centralUrl, intervalMs, ...edgeClientOptions });
  } catch (e) {
    console.error("[federation] edgeClient.start failed:", e && e.message ? e.message : e);
  }
  try {
    handles.failover = fo.start({ fetchImpl, centralUrl, intervalMs, thresholdMs, ...failoverOptions });
  } catch (e) {
    console.error("[federation] failover.start failed:", e && e.message ? e.message : e);
  }
  handles.started = handles.edgeClient !== null || handles.failover !== null;
  if (handles.started) {
    console.warn("[federation] replication + failover loops started (edge mode).");
  }
  _handles = handles;
  return handles;
}
