import { getAdapter } from "../driver.js";
import crypto from "node:crypto";

// Error telemetry. Upstream failures never reach usageHistory (which only
// records successes), so a 429 storm leaves zero evidence behind. These rows
// are what makes "was this real quota exhaustion, or request-shape bucketing?"
// answerable after the fact.
//
// Written from the error path, so it is fire-and-forget and buffered: telemetry
// must never add latency to, or fail, the request that produced it.

const MAX_RECORDS = parseInt(process.env.ERROR_EVENTS_MAX_RECORDS || "2000", 10);
const BATCH_SIZE = 25;
const FLUSH_INTERVAL_MS = 3000;

let buffer = [];
let timer = null;
let flushing = false;

/**
 * Redact an account identifier to a stable, non-reversible reference.
 * The raw email/connection id never lands in the table.
 */
export function accountRefOf(value) {
  if (!value) return null;
  return crypto.createHash("sha256").update(String(value).toLowerCase()).digest("hex").slice(0, 16);
}

async function flush() {
  if (flushing || buffer.length === 0) return;
  flushing = true;
  try {
    while (buffer.length > 0) {
      const items = buffer.splice(0, buffer.length);
      const db = await getAdapter();
      db.transaction(() => {
        for (const it of items) {
          db.run(
            `INSERT INTO errorEvents(timestamp, provider, model, connectionId, accountRef, status,
               upstreamStatus, reason, quotaResetDelay, quotaResetTimeStamp, retryDelay,
               hasMetadata, classifiedAs, cooldownMs, message)
             VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              it.timestamp || new Date().toISOString(),
              it.provider || null,
              it.model || null,
              it.connectionId || null,
              it.accountRef || null,
              it.status ?? null,
              it.upstreamStatus || null,
              it.reason || null,
              it.quotaResetDelay || null,
              it.quotaResetTimeStamp || null,
              it.retryDelay || null,
              it.hasMetadata ? 1 : 0,
              it.classifiedAs || null,
              it.cooldownMs || 0,
              typeof it.message === "string" ? it.message.slice(0, 1000) : null,
            ]
          );
        }
        const cnt = db.get(`SELECT COUNT(*) as c FROM errorEvents`);
        if (cnt && cnt.c > MAX_RECORDS) {
          db.run(
            `DELETE FROM errorEvents WHERE id IN (SELECT id FROM errorEvents ORDER BY id ASC LIMIT ?)`,
            [cnt.c - MAX_RECORDS]
          );
        }
      });
    }
  } catch (e) {
    // Telemetry must never break the request path.
    console.error("[errorEventsRepo] write failed:", e?.message || e);
  } finally {
    flushing = false;
  }
}

/**
 * Record one upstream error. Never throws, never blocks.
 * @param {object} ev
 */
export function recordErrorEvent(ev) {
  try {
    buffer.push({ ...ev, timestamp: ev.timestamp || new Date().toISOString() });
    if (buffer.length >= BATCH_SIZE) {
      if (timer) { clearTimeout(timer); timer = null; }
      flush().catch(() => {});
    } else if (!timer) {
      timer = setTimeout(() => { timer = null; flush().catch(() => {}); }, FLUSH_INTERVAL_MS);
      if (timer.unref) timer.unref();
    }
  } catch {
    /* swallow — telemetry is best-effort */
  }
}

export async function getErrorEvents(filter = {}) {
  const db = await getAdapter();
  const conds = [];
  const params = [];
  if (filter.provider) { conds.push("provider = ?"); params.push(filter.provider); }
  if (filter.model) { conds.push("model = ?"); params.push(filter.model); }
  if (filter.reason) { conds.push("reason = ?"); params.push(filter.reason); }
  if (filter.classifiedAs) { conds.push("classifiedAs = ?"); params.push(filter.classifiedAs); }
  if (filter.since) { conds.push("timestamp >= ?"); params.push(new Date(filter.since).toISOString()); }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const limit = Math.min(filter.limit || 200, 2000);
  return db.all(`SELECT * FROM errorEvents ${where} ORDER BY id DESC LIMIT ?`, [...params, limit]);
}

export async function getErrorSummary(sinceMs = 24 * 60 * 60 * 1000) {
  const db = await getAdapter();
  const since = new Date(Date.now() - sinceMs).toISOString();
  return db.all(
    `SELECT provider, model, reason, classifiedAs, COUNT(*) as n,
            SUM(hasMetadata) as withMetadata, MAX(timestamp) as lastSeen
       FROM errorEvents WHERE timestamp >= ?
      GROUP BY provider, model, reason, classifiedAs ORDER BY n DESC`,
    [since]
  );
}

export const __test__ = { accountRefOf };
