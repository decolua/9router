// Privacy & DLP masking statistics. One row per masking event (request mask,
// response mask — non-streaming and streaming), only when matched > 0.
// Mirrors the usageHistory/usageDaily pattern: events feed daily/hourly buckets
// for the usage dashboard, exactly like the token chart.
//
// Fail-open by design: collection must never break or slow the request path.

import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

const RETENTION_DAYS = 90;
const PERIOD_MS = { "24h": 86400000, "7d": 604800000, "30d": 2592000000, "60d": 5184000000 };

function getLocalDateKey(timestamp) {
  const d = timestamp ? new Date(timestamp) : new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function getCutoffIso(period) {
  const now = Date.now();
  if (period === "today") {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }
  const ms = PERIOD_MS[period] || PERIOD_MS["7d"];
  return new Date(now - ms).toISOString();
}

function addToBucket(bucket, r) {
  bucket.masked += r.matched || 0;
  if (r.scope === "request") bucket.requests += 1;
  else bucket.responses += 1;
}

function topCategoryOf(byType) {
  let top = null;
  for (const [k, v] of Object.entries(byType || {})) {
    if (!top || v > top.count) top = { name: k, count: v };
  }
  return top;
}

function emptyAgg() {
  return { totalMatched: 0, maskedRequests: 0, maskedResponses: 0, byType: {} };
}

async function pruneOldEvents(db) {
  try {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 86400000).toISOString();
    db.run(`DELETE FROM dlpEvents WHERE timestamp < ?`, [cutoff]);
  } catch {
    /* retention is best-effort */
  }
}

/**
 * Record one masking event. Never throws — callers must treat this as
 * fire-and-forget (await + .catch(() => {}) or void).
 */
export async function recordDlpMasks({ scope = "request", mode = "redact", matched = 0, byType = {}, timestamp = new Date().toISOString() } = {}) {
  if (!matched || !["request", "response"].includes(scope)) return;
  try {
    const db = await getAdapter();
    db.run(
      `INSERT INTO dlpEvents(timestamp, scope, mode, matched, byType) VALUES(?, ?, ?, ?, ?)`,
      [timestamp, scope, mode, matched, stringifyJson(byType || {})]
    );
    await pruneOldEvents(db);
  } catch {
    /* fail-open: stats collection must never break the request path */
  }
}

/** Aggregated totals for the period. */
export async function getDlpStats(period = "7d") {
  try {
    const db = await getAdapter();
    const cutoff = getCutoffIso(period);
    const rows = db.all(`SELECT scope, mode, matched, byType FROM dlpEvents WHERE timestamp >= ?`, [cutoff]);
    const agg = emptyAgg();
    let lastMode = null;
    for (const r of rows) {
      agg.totalMatched += r.matched || 0;
      if (r.scope === "request") agg.maskedRequests += 1;
      else agg.maskedResponses += 1;
      if (r.mode) lastMode = r.mode;
      const bt = parseJson(r.byType, {});
      for (const [k, v] of Object.entries(bt)) {
        agg.byType[k] = (agg.byType[k] || 0) + v;
      }
    }
    return { ...agg, mode: lastMode, topCategory: topCategoryOf(agg.byType) };
  } catch {
    return { ...emptyAgg(), mode: null, topCategory: null };
  }
}

/** Bucketed series for the chart — same shapes/labels as getChartData (tokens). */
export async function getDlpChartData(period = "7d") {
  try {
    const db = await getAdapter();
    const cutoff = getCutoffIso(period);
    const rows = db.all(
      `SELECT timestamp, scope, matched FROM dlpEvents WHERE timestamp >= ? ORDER BY timestamp ASC`,
      [cutoff]
    );

    const hourly = (startTime, endTime, bucketCount) => {
      const bucketMs = 3600000;
      const labelFn = (ts) =>
        new Date(ts).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
      const buckets = Array.from({ length: bucketCount }, (_, i) => ({
        label: labelFn(startTime + i * bucketMs),
        requests: 0,
        responses: 0,
        masked: 0,
      }));
      for (const r of rows) {
        const t = new Date(r.timestamp).getTime();
        if (t < startTime || t >= endTime) continue;
        const idx = Math.min(Math.floor((t - startTime) / bucketMs), bucketCount - 1);
        if (idx >= 0) addToBucket(buckets[idx], r);
      }
      return buckets;
    };

    if (period === "today") {
      const bucketCount = 24;
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const startTime = startOfDay.getTime();
      return hourly(startTime, startTime + bucketCount * 3600000, bucketCount);
    }

    if (period === "24h") {
      const bucketCount = 24;
      const startTime = Date.now() - bucketCount * 3600000;
      return hourly(startTime, Date.now(), bucketCount);
    }

    const bucketCount = period === "7d" ? 7 : period === "30d" ? 30 : 60;
    const today = new Date();
    const labelFn = (d) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const byDay = {};
    for (const r of rows) {
      const key = getLocalDateKey(r.timestamp);
      if (!byDay[key]) byDay[key] = { requests: 0, responses: 0, masked: 0 };
      addToBucket(byDay[key], r);
    }
    return Array.from({ length: bucketCount }, (_, i) => {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (bucketCount - 1 - i));
      const key = getLocalDateKey(d.toISOString());
      return { label: labelFn(d), ...(byDay[key] || { requests: 0, responses: 0, masked: 0 }) };
    });
  } catch {
    return [];
  }
}