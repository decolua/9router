// Federation pendingWrites queue (FED-004) — spec §3.4.
//
// The edge's write queue for DEGRADED mode. While the edge cannot reach
// central, mutating dashboard API calls are absorbed locally (idempotency_key
// dedupe) and replayed to central on recovery. The queue is capped at
// FEDERATION_QUEUE_MAX; when full, new writes are rejected with 503.
//
// Wire contract (FED-005 surfaces these):
//   - enqueue returns { ok:true, idempotencyKey, queued:boolean } — queued
//     is false when the key already existed (dedupe hit, no duplicate row).
//   - queue full → { ok:false, status:503, reason:'queue full' }.
//   - payload JSON = { method, path, body } (FED-001 design).
//   - state machine per row: 'pending' → 'done' | 'failed'.
//   - replayBatch: 2xx → done; 409 (stale fence / already applied) → done
//     (never retried); network error → stays pending, batch stops (retried
//     on the next recovery cycle).
//
// The module is framework-free and takes the adapter explicitly so tests can
// drive any SQLite backend (same convention as replication.js).
import { randomUUID } from "node:crypto";
import { getQueueMax, getReplayBatchSize, getToken, getEdgeId } from "./config.js";

// ─── Row helpers ─────────────────────────────────────────────────────────

export function parsePayload(payload) {
  if (!payload) return null;
  try {
    const parsed = typeof payload === "string" ? JSON.parse(payload) : payload;
    if (!parsed || typeof parsed !== "object") return null;
    return {
      method: String(parsed.method || "GET").toUpperCase(),
      path: String(parsed.path || "/"),
      body: parsed.body ?? null,
    };
  } catch {
    return null;
  }
}

// ─── Enqueue ────────────────────────────────────────────────────────────

// Queue one write. Idempotency: INSERT OR IGNORE on idempotency_key — a
// repeat of an existing key returns the existing row's key without creating
// a duplicate (the caller can treat it as already-queued). When no key is
// supplied, a randomUUID is generated. Cap: pending rows >=
// FEDERATION_QUEUE_MAX → { ok:false, status:503, reason:'queue full' }.
// The cap counts PENDING rows only — done/failed rows are historical
// records (FED-005 diagnostics) and must not fill the queue.
export function enqueue(db, { method, path, body, idempotencyKey = null } = {}) {
  const key = idempotencyKey || randomUUID();
  const m = String(method || "GET").toUpperCase();
  const p = String(path || "/");

  const count = db.get(`SELECT COUNT(*) AS c FROM pendingWrites WHERE state = 'pending'`).c;
  const existing = db.get(`SELECT idempotency_key FROM pendingWrites WHERE idempotency_key = ?`, [key]);
  if (!existing && count >= getQueueMax()) {
    return { ok: false, status: 503, reason: "queue full" };
  }

  const payload = JSON.stringify({ method: m, path: p, body: body ?? null });
  const res = db.run(
    `INSERT OR IGNORE INTO pendingWrites(idempotency_key, payload, state, created_at, attempts)
     VALUES(?, ?, 'pending', ?, 0)`,
    [key, payload, new Date().toISOString()]
  );
  const inserted = res?.changes > 0;
  return { ok: true, idempotencyKey: key, queued: inserted };
}

// ─── Listing / marking ──────────────────────────────────────────────────

// Pending rows in FIFO order (created_at, then key for stability), for drain
// batches. Returns rows with parsed payloads.
export function listPending(db, { limit = null } = {}) {
  const rows = db.all(
    `SELECT idempotency_key, payload, state, created_at, attempts, last_error
     FROM pendingWrites WHERE state = 'pending'
     ORDER BY created_at ASC, idempotency_key ASC${limit ? ` LIMIT ${Number(limit)}` : ""}`
  );
  return rows.map((r) => ({ ...r, payload: parsePayload(r.payload) }));
}

export function markDone(db, key) {
  db.run(`UPDATE pendingWrites SET state = 'done' WHERE idempotency_key = ?`, [key]);
}

// Mark a write failed: attempts++ and state='failed' (a failed write is NOT
// retried automatically — it is surfaced via FED-005 diagnostics). The
// error text is kept in last_error (migration 004).
export function markFailed(db, key, error) {
  const msg = error && typeof error === "object" ? error.message || String(error) : String(error || "unknown error");
  db.run(
    `UPDATE pendingWrites SET state = 'failed', attempts = attempts + 1, last_error = ?
     WHERE idempotency_key = ?`,
    [String(msg).slice(0, 2000), key]
  );
}

// ─── Drain / replay ───────────────────────────────────────────────────────

// Replay up to batchSize pending writes to central via POST
// /api/federation/replay (Bearer FEDERATION_TOKEN + x-federation-edge-id +
// the edge's current fencing token). Semantics:
//   - 2xx → markDone (applied or idempotent no-op)
//   - 409 (stale fence) → re-verify ONCE via onStaleFence (returns a fresh
//     fencing token or null) and retry the write once; a second 409 → mark
//     failed with last_error (the write was never applied — marking it done
//     would silently drop it). Never loops.
//   - network error / 5xx → leave pending, STOP the batch (retry next cycle)
// Returns { replayed, done, failed, stopped, remaining }.
export async function replayBatch(db, { fetchImpl = globalThis.fetch, centralUrl = null, batchSize = null, fencingToken = null, onStaleFence = null } = {}) {
  const base = centralUrl;
  if (!base) return { replayed: 0, done: 0, failed: 0, stopped: true, remaining: countPending(db), error: "FEDERATION_CENTRAL_URL is not configured" };

  const size = batchSize ?? getReplayBatchSize();
  const rows = listPending(db, { limit: size });
  if (rows.length === 0) return { replayed: 0, done: 0, failed: 0, stopped: false, remaining: 0 };

  const token = getToken();
  let replayed = 0;
  let done = 0;
  let failed = 0;
  let stopped = false;

  const postReplay = async (row, fenceToken) => {
    return fetchImpl(`${base}/api/federation/replay`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        "x-federation-edge-id": getEdgeId(),
      },
      body: JSON.stringify({
        idempotency_key: row.idempotency_key,
        method: row.payload?.method || "GET",
        path: row.payload?.path || "/",
        body: row.payload?.body ?? null,
        fencing_token: fenceToken ?? null,
      }),
    });
  };

  for (const row of rows) {
    let res;
    try {
      res = await postReplay(row, fencingToken);
    } catch (err) {
      // Network failure: leave pending, stop the batch. The next recovery
      // cycle retries from this row.
      stopped = true;
      break;
    }
    replayed += 1;

    if (res.status === 409 && onStaleFence) {
      // Stale fence (e.g. central restarted between heartbeat and replay):
      // re-verify once for a fresh token and retry ONCE.
      let fresh = null;
      try {
        fresh = await onStaleFence();
      } catch {
        fresh = null;
      }
      if (fresh) {
        try {
          res = await postReplay(row, fresh);
          replayed += 1;
        } catch {
          // Network error on the retry: leave pending, stop the batch.
          stopped = true;
          break;
        }
      }
    }

    if (res.status === 409) {
      // Still stale after re-verify — the write was never applied. Mark
      // failed (surfaced via FED-005), do NOT retry again.
      markFailed(db, row.idempotency_key, "stale fencing token after re-verify (409)");
      failed += 1;
    } else if (res.ok) {
      markDone(db, row.idempotency_key);
      done += 1;
    } else {
      // 4xx/5xx other than 409: mark failed with the server's message.
      let msg = `HTTP ${res.status}`;
      try {
        const j = await res.json();
        if (j?.error) msg = typeof j.error === "string" ? j.error : j.error.message || msg;
      } catch {
        /* non-JSON body — keep the status text */
      }
      markFailed(db, row.idempotency_key, msg);
      failed += 1;
    }
  }

  return { replayed, done, failed, stopped, remaining: countPending(db) };
}

export function countPending(db) {
  const row = db.get(`SELECT COUNT(*) AS c FROM pendingWrites WHERE state = 'pending'`);
  return row?.c ?? 0;
}

// ─── DEGRADED-mode request handling (proxy integration) ──────────────────

// Handle a mutating dashboard API call while DEGRADED: queue the write and
// respond 202 Accepted with X-Federation-State: degraded +
// X-Federation-Queued-Write-Id. Queue full → 503 with X-Federation-State:
// degraded. The response body is JSON so the dashboard can render the
// deferred state (FED-005). Returns true when the response was written
// (caller must NOT fall through to the local handler).
export function handleDegradedWrite(req, res, db, { log = console } = {}) {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    let body = null;
    const raw = Buffer.concat(chunks).toString("utf8");
    if (raw) {
      try {
        body = JSON.parse(raw);
      } catch {
        body = raw; // non-JSON body (form-encoded etc.) — stored verbatim
      }
    }
    const result = enqueue(db, { method: req.method, path: req.url, body });
    if (!result.ok) {
      res.writeHead(503, {
        "Content-Type": "application/json",
        "X-Federation-State": "degraded",
      });
      res.end(JSON.stringify({ error: { message: "Federation write queue is full", code: "FED_QUEUE_FULL" } }));
      return;
    }
    res.writeHead(202, {
      "Content-Type": "application/json",
      "X-Federation-State": "degraded",
      "X-Federation-Queued-Write-Id": result.idempotencyKey,
    });
    res.end(
      JSON.stringify({
        queued: true,
        idempotencyKey: result.idempotencyKey,
        message: "Write queued locally; will be replayed to central on recovery",
      })
    );
  });
  req.on("error", (err) => {
    log.error(`[federation] degraded write queue error: ${err?.message || err}`);
    if (!res.headersSent) {
      try {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: "Failed to queue write", code: "FED_QUEUE_ERROR" } }));
      } catch {
        /* already closed */
      }
    }
  });
  return true;
}
