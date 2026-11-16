/**
 * Per-API-key usage, for the API Key Usage page.
 *
 * usageRepo.js already aggregates per key for the table; this file adds the
 * time series that table has never had, and owns the one definition of a key's
 * bucket identity so the chart and the table cannot key differently.
 *
 * Kept out of usageRepo.js deliberately: that file is at its 800-line ceiling.
 */

import { createHash } from "node:crypto";
import { getAdapter } from "../driver.js";
import { parseJson } from "../helpers/jsonCol.js";

/**
 * The displayable stand-in for a key, for UI *display* only (e.g.
 * `apiKeyMasked` in usageRepo.js's stats values). Deliberately a second copy
 * of the rule usageRepo.js:6-10 applies privately, not an import of it:
 * usageRepo imports apiKeyBucketId from this file, so importing maskApiKey
 * back out of usageRepo would close a cycle between the two modules. Eleven
 * lines of duplication beats a circular import that works until the load
 * order changes.
 *
 * If the two ever have to diverge, that is the bug — they describe one rule.
 *
 * Not safe as an *identity*, which is why apiKeyBucketId below does not use
 * it for a deleted key: 9Router keys are `sk-${machineId}-${keyId}-${crc}`
 * (generateApiKeyWithMachine, shared/utils/apiKey.js), and machineId is
 * constant for an install, so the first 8 characters are the *same* for every
 * key on that machine. Upstream (v0.5.91) added the last 4 characters so
 * masked keys stay visually distinguishable, but 4 characters is a display
 * hint, not a collision-free id.
 */
export function maskApiKey(key) {
  if (!key || typeof key !== "string") return null;
  if (key.length <= 12) return key.charAt(0) + "***";
  // Keep the tail: keys sharing a machine-id prefix (team keys) must not collide.
  return key.slice(0, 8) + "***" + key.slice(-4);
}

/**
 * Deleted-key fallback for apiKeyBucketId, not maskApiKey: distinct per key
 * (unlike the masked form, which is identical for every key on an install —
 * see maskApiKey's docblock), stable across calls, and reveals nothing about
 * the raw key. Not exported itself — apiKeyBucketId and deletedKeyLabel below
 * are the two public functions built on it; nothing outside this file should
 * need a raw key's hash directly.
 */
function hashApiKeyId(rawKey) {
  if (typeof rawKey !== "string") return null;
  return createHash("sha256").update(rawKey).digest("hex").slice(0, 8);
}

/**
 * The human-readable label for a deleted key, everywhere one is shown: the
 * API Key Usage table's `keyName` (usageRepo.js) and this file's own chart
 * legend (getApiKeyUsageSeries below, whose `keys` map already builds this
 * same string from an id that IS this hash — see there for why it isn't
 * called from here too). One definition so the table row and the chart
 * legend read identically for the same deleted key, not just the same bucket
 * id underneath: `maskApiKey`'s collapsed masked form used to appear as a
 * `keyName` too (see maskApiKey's docblock), which merged every deleted key's
 * table row into one group even after apiKeyBucketId told them apart.
 *
 * @param {string|null|undefined} rawKey
 * @returns {string|null} null when rawKey isn't a usable string — the caller
 *   decides what a no-key label should be, since "no key" and "unhashable
 *   key" are different situations
 */
export function deletedKeyLabel(rawKey) {
  const hash = hashApiKeyId(rawKey);
  return hash ? `(deleted) ${hash}` : null;
}

/**
 * Which bucket a raw key belongs to.
 *
 * Never the raw key itself: this value becomes a JSON property name in the
 * /api/usage/stats response and a series key in /api/usage/api-keys, both of
 * which reach the browser.
 *
 * A live key's id is already unique (a UUID from apiKeysRepo). A deleted key
 * has no record to join against, so it falls back to hashApiKeyId, not
 * maskApiKey — see maskApiKey's docblock for why the masked form can't tell
 * two deleted keys on the same install apart.
 *
 * @param {string|null|undefined} rawKey  the key as stored in usageHistory
 * @param {Record<string, {name: string, id: string}>} apiKeyMap  rawKey → record
 * @returns {string}
 */
export function apiKeyBucketId(rawKey, apiKeyMap) {
  if (!rawKey) return "local-no-key";
  return (apiKeyMap || {})[rawKey]?.id || hashApiKeyId(rawKey) || "local-no-key";
}

/**
 * Fold usage rows into fixed buckets, one token total per key per bucket.
 *
 * Pure: the caller decides the bucket boundaries, so the same function serves
 * the hourly and the daily path and can be tested without a database. A row
 * outside every bucket is dropped rather than clamped into the nearest one —
 * a misplaced request is a wrong chart, a dropped one is a short chart.
 *
 * @param {Array<{timestamp: string, apiKey: string|null, promptTokens: number, completionTokens: number}>} rows
 * @param {Array<{label: string, start: number, end: number}>} buckets  end exclusive, epoch ms
 * @param {Record<string, {id: string, name: string}>} apiKeyMap
 * @returns {Array<{label: string, byKey: Record<string, number>}>}
 */
export function bucketApiKeyRows(rows, buckets, apiKeyMap) {
  const out = buckets.map((b) => ({ label: b.label, byKey: {} }));

  for (const r of Array.isArray(rows) ? rows : []) {
    const t = new Date(r.timestamp).getTime();
    if (!Number.isFinite(t)) continue;
    const index = buckets.findIndex((b) => t >= b.start && t < b.end);
    if (index === -1) continue;

    const id = apiKeyBucketId(r.apiKey, apiKeyMap);
    const tokens = (r.promptTokens || 0) + (r.completionTokens || 0);
    const bucket = out[index];
    bucket.byKey = { ...bucket.byKey, [id]: (bucket.byKey[id] || 0) + tokens };
  }

  return out;
}

const HOUR_MS = 3600000;
const DAY_MS = 86400000;

function dateKeyOf(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * The bucket boundaries for a period, mirroring getChartData's boundaries
 * (usageRepo.js:688) — the date ranges, not the lookup — so this chart lines
 * up with every other chart on the dashboard. getChartData resolves each day
 * through a `dateKey → data` map (usageRepo.js:746-747), never by epoch-range
 * containment; the containment check (`findIndex(b => t >= b.start && t <
 * b.end)`) belongs to bucketApiKeyRows above, applied to the boundaries this
 * function returns. The two never call each other — they land on the same
 * calendar days only because both derive local midnight the same way, which
 * is why the DST fix below (setDate, not `+ DAY_MS`) had to get that
 * derivation exactly right rather than "whatever getChartData does".
 *
 * today / 24h are hourly, because usageDaily is per-day and would draw a single
 * bar for them. Everything else is daily.
 *
 * Exported so the DST boundary invariant (daily buckets partition time with no
 * gap or overlap, even across a spring-forward transition) can be tested
 * directly, rather than re-derived by the test.
 */
export function bucketsFor(period, earliestDateKey) {
  if (period === "today") {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    return { hourly: true, buckets: Array.from({ length: 24 }, (_, i) => {
      const s = start.getTime() + i * HOUR_MS;
      return { label: new Date(s).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false }), start: s, end: s + HOUR_MS };
    }) };
  }
  if (period === "24h") {
    const end = Date.now();
    const start = end - 24 * HOUR_MS;
    return { hourly: true, buckets: Array.from({ length: 24 }, (_, i) => {
      const s = start + i * HOUR_MS;
      return { label: new Date(s).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false }), start: s, end: s + HOUR_MS };
    }) };
  }

  const today = new Date(); today.setHours(0, 0, 0, 0);
  let count;
  if (period === "all") {
    const earliest = earliestDateKey ? new Date(`${earliestDateKey}T00:00:00`) : today;
    count = Math.max(1, Math.round((today - earliest) / DAY_MS) + 1);
  } else {
    count = period === "7d" ? 7 : period === "30d" ? 30 : 60;
  }

  const first = new Date(today);
  first.setDate(first.getDate() - count + 1);
  return { hourly: false, buckets: Array.from({ length: count }, (_, i) => {
    const d = new Date(first); d.setDate(d.getDate() + i);
    // Next local midnight via setDate, not `+ DAY_MS`: on a DST spring-forward
    // day the wall-clock day is 23h, so a fixed 24h offset overshoots into the
    // next day and both days' buckets would claim rows stamped at that day's
    // midnight — findIndex takes the first (wrong) match, leaving the next
    // bucket empty. setDate recomputes the epoch from calendar fields, so it
    // tracks the DST-adjusted day length instead of assuming a fixed one.
    const next = new Date(d); next.setDate(next.getDate() + 1);
    return { label: dateKeyOf(d), start: d.getTime(), end: next.getTime() };
  }) };
}

/**
 * The per-key series the API Key Usage chart draws, plus the display name for
 * each series so the legend has something to say.
 *
 * @param {string} period  today | 24h | 7d | 30d | 60d | all
 * @returns {Promise<{series: Array<{label: string, byKey: Record<string, number>}>, keys: Record<string, string>}>}
 */
export async function getApiKeyUsageSeries(period = "7d") {
  const db = await getAdapter();
  const { getApiKeys } = await import("./apiKeysRepo.js");

  let allApiKeys = [];
  try { allApiKeys = await getApiKeys(); } catch { /* no keys yet */ }
  const apiKeyMap = {};
  for (const k of allApiKeys) apiKeyMap[k.key] = { name: k.name, id: k.id };

  let earliest = null;
  if (period === "all") {
    const first = db.all(`SELECT dateKey FROM usageDaily ORDER BY dateKey ASC LIMIT 1`);
    earliest = first?.[0]?.dateKey || null;
  }
  const { hourly, buckets } = bucketsFor(period, earliest);
  if (!buckets.length) return { series: [], keys: {} };

  let rows;
  if (hourly) {
    rows = db.all(
      `SELECT timestamp, apiKey, promptTokens, completionTokens FROM usageHistory WHERE timestamp >= ?`,
      [new Date(buckets[0].start).toISOString()]
    );
  } else {
    // usageDaily holds one JSON blob per day, whose byApiKey buckets are keyed
    // `${rawKey}|${model}|${provider}` and carry the raw key in `.apiKey`.
    // Flattened to row shape so one bucketer serves both paths.
    const dayRows = db.all(
      `SELECT dateKey, data FROM usageDaily WHERE dateKey >= ? ORDER BY dateKey ASC`,
      [dateKeyOf(new Date(buckets[0].start))]
    );
    rows = [];
    for (const dr of dayRows) {
      const day = parseJson(dr.data, {}) || {};
      const at = new Date(`${dr.dateKey}T00:00:00`).toISOString();
      for (const ak of Object.values(day.byApiKey || {})) {
        rows.push({
          timestamp: at, apiKey: ak.apiKey || null,
          promptTokens: ak.promptTokens || 0, completionTokens: ak.completionTokens || 0,
        });
      }
    }
  }

  const series = bucketApiKeyRows(rows, buckets, apiKeyMap);

  const keys = {};
  for (const bucket of series) {
    for (const id of Object.keys(bucket.byKey)) {
      if (keys[id]) continue;
      if (id === "local-no-key") { keys[id] = "Local (No API Key)"; continue; }
      const match = allApiKeys.find((k) => k.id === id);
      // Not deletedKeyLabel(rawKey) here (see its docblock's promise): the raw
      // key is gone by this point, only `id` survives bucketApiKeyRows, and
      // for a deleted key `id` already IS hashApiKeyId(rawKey) via
      // apiKeyBucketId's fallback. Re-deriving it from a raw key we no longer
      // have would just reproduce this same string.
      keys[id] = match ? match.name : `(deleted) ${id}`;
    }
  }

  return { series, keys };
}
