// Federation edge client (FED-002).
//
// Pull + poll loop: the edge bootstraps with a full snapshot (when
// lastAppliedRevision is null/0), then polls deltas every
// FEDERATION_SYNC_INTERVAL_MS. Progress is persisted in
// federation_meta.lastAppliedRevision — the single source of truth for edge
// progress (spec §3.3).
//
// Hard gate: the client MUST NOT start when FEDERATION_MODE is standalone
// (standalone = zero drift). start() returns null and logs instead of
// throwing, so a misconfigured deployment degrades to a warning rather than
// crashing the process.
//
// Schema gating: when the central advertises a schemaVersion newer than the
// edge's local migration version, apply throws SchemaBlockedError; the loop
// records the blocked state in federation_meta (schemaBlocked=1) and pauses
// — it does NOT apply anything and does NOT advance lastAppliedRevision.
// Once the edge is upgraded (new migration lands), the next poll resumes
// from the same lastAppliedRevision.
//
// Auth (FED-004): fetch() calls carry `Authorization: Bearer
// <FEDERATION_TOKEN>` + `x-federation-edge-id` — FED-003's roleGuard.js
// guards ALL federation routes with the token in non-standalone modes, so
// unauthenticated pulls would 401 in a real edge deployment.
import { getAdapter } from "../db/driver.js";
import { latestVersion } from "../db/migrations/index.js";
import { isStandalone, isEdge, getCentralUrl, getEdgeId, getSyncIntervalMs, getToken } from "./config.js";
import { applyRevisionBatch, readLastAppliedRevision, SchemaBlockedError } from "./replication.js";

const FETCH_TIMEOUT_MS = 15000;

// One pull cycle: fetch snapshot (when lastAppliedRevision is 0) or delta,
// apply transactionally, persist the new watermark. Returns a status object
// for tests and diagnostics. Never throws for network/schema failures —
// returns { ok:false, error } so the poll loop can keep running.
export async function pullOnce({ fetchImpl = globalThis.fetch, centralUrl = null } = {}) {
  const base = centralUrl || getCentralUrl();
  if (!base) {
    return { ok: false, error: "FEDERATION_CENTRAL_URL is not configured" };
  }
  const db = await getAdapter();
  const current = readLastAppliedRevision(db);

  let payload;
  try {
    if (current <= 0) {
      payload = await fetchJson(fetchImpl, `${base}/api/federation/snapshot?since=0`);
    } else {
      payload = await fetchJson(fetchImpl, `${base}/api/federation/delta?since=${current}`);
    }
  } catch (err) {
    // Network/HTTP failures must not kill the poll loop — report and let the
    // caller (start()) schedule the next tick.
    return { ok: false, error: err.message };
  }

  try {
    const result = applyRevisionBatch(db, payload);
    return { ok: true, applied: result.applied, lastAppliedRevision: result.lastAppliedRevision, schemaVersion: payload.schemaVersion };
  } catch (err) {
    if (err instanceof SchemaBlockedError) {
      markSchemaBlocked(db, true);
      return { ok: false, blocked: true, error: err.message, schemaVersion: payload.schemaVersion };
    }
    throw err;
  }
}

// Start the poll loop. Returns the timer handle (or null when standalone).
// The loop is intentionally fire-and-forget: each tick runs pullOnce and
// schedules the next tick after the configured interval. Unhandled errors
// are logged and the loop continues (a transient failure must not kill the
// edge's replication).
export function start({ fetchImpl = globalThis.fetch, centralUrl = null, intervalMs = null } = {}) {
  if (isStandalone()) {
    console.warn("[federation] edgeClient.start() called in standalone mode — replication disabled (zero drift).");
    return null;
  }
  if (!isEdge()) {
    console.warn("[federation] edgeClient.start() called in non-edge mode — replication disabled.");
    return null;
  }
  const interval = intervalMs ?? getSyncIntervalMs();
  const tick = async () => {
    try {
      // Record the edge role + identity in federation_meta (idempotent) so
      // /api/federation/status and diagnostics reflect the deployment.
      const db = await getAdapter();
      db.run(
        `INSERT INTO federation_meta(id, role, edgeId, schemaVersion) VALUES(1, 'edge', ?, ?)
         ON CONFLICT(id) DO UPDATE SET role = 'edge', edgeId = excluded.edgeId, schemaVersion = excluded.schemaVersion`,
        [getEdgeId(), latestVersion()]
      );
      const result = await pullOnce({ fetchImpl, centralUrl });
      if (!result.ok) {
        console.warn(`[federation] pull failed: ${result.error}`);
      } else if (result.blocked) {
        console.warn(`[federation] pull blocked: ${result.error}`);
      }
    } catch (err) {
      console.error("[federation] pull error:", err);
    }
  };
  // First pull immediately, then poll on the interval.
  tick();
  const timer = setInterval(tick, interval);
  if (typeof timer.unref === "function") timer.unref();
  return timer;
}

// Mark/clear the schema-blocked flag (informational — FED-005 surfaces it as
// the "upgrade edge" banner). Stored in the app's _meta kv table: the
// federation_meta table has no such column (migration 002), and adding one
// would mean editing an already-landed migration.
export function markSchemaBlocked(db, blocked) {
  db.run(
    `INSERT INTO _meta(key, value) VALUES('federation_schemaBlocked', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [blocked ? "1" : "0"]
  );
}

async function fetchJson(fetchImpl, url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, {
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${getToken() || ""}`,
        "x-federation-edge-id": getEdgeId(),
      },
    });
    if (!res.ok) {
      throw new Error(`GET ${url} → HTTP ${res.status}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}
