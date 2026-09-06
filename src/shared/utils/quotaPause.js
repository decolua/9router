/**
 * Pure per-account quota-pause helpers shared by the routing engine
 * (src/sse/services/quotaGuard.js) and the dashboard UI. No DB/server imports
 * so this is safe to use in client components — it only reads plain fields that
 * already live on the connection object (quotaPauseThresholds, lastQuotaSnapshot).
 *
 * Per-window model: `connection.quotaPauseThresholds` is a map of
 * { [windowKey]: number }. An account pauses for routing when ANY window that has
 * a configured threshold drops to/below it. Windows without a threshold (or
 * unlimited ones) never auto-pause. Paused state is derived, never stored, so an
 * account auto-recovers once the offending window rebounds (e.g. after resetAt).
 *
 * windowKey is the exact key from the provider's usage.quotas (e.g. "session (5h)",
 * "weekly (7d)", "session", "weekly", "chat"), as persisted in lastQuotaSnapshot.
 */

import { USAGE_APIKEY_PROVIDERS } from "@/shared/constants/providers";

export function isQuotaEligible(connection) {
  if (!connection) return false;
  const isOAuth = connection.authType === "oauth";
  const isApikeyAuth =
    connection.authType === "apikey" || connection.authType === "api_key";
  const isApikeyEligible =
    isApikeyAuth && USAGE_APIKEY_PROVIDERS.includes(connection.provider);
  return isOAuth || isApikeyEligible;
}

export function getWindowThresholds(connection) {
  const t = connection?.quotaPauseThresholds;
  return (t && typeof t === "object") ? t : {};
}

export function normalizeWindowThreshold(v) {
  const t = Number(v);
  if (!Number.isFinite(t) || t <= 0 || t > 100) return 0;
  return t;
}

// Returns the window key that triggered a pause, or null when not paused.
// A window triggers when it has a configured threshold (>0), is not unlimited,
// and its remaining % <= that threshold.
export function getPausedWindow(connection) {
  if (!isQuotaEligible(connection)) return null;
  const thresholds = getWindowThresholds(connection);
  const windows = connection?.lastQuotaSnapshot?.windows;
  if (!windows || !Array.isArray(windows) || windows.length === 0) return null;
  let triggered = null;
  for (const w of windows) {
    if (!w || w.unlimited === true) continue;
    const t = normalizeWindowThreshold(thresholds[w.key]);
    if (!t) continue;
    const remaining = Number(w.remainingPercentage);
    if (!Number.isFinite(remaining)) continue;
    if (remaining <= t) {
      // Pick the most-depleted triggering window for the badge.
      if (triggered === null || remaining < Number(triggered.remainingPercentage)) {
        triggered = { key: w.key, remainingPercentage: remaining, threshold: t };
      }
    }
  }
  return triggered;
}

export function isQuotaPaused(connection) {
  return getPausedWindow(connection) !== null;
}

export function getQuotaPauseInfo(connection) {
  const thresholds = getWindowThresholds(connection);
  const windows = connection?.lastQuotaSnapshot?.windows || [];
  const enabled = Object.values(thresholds).some((v) => normalizeWindowThreshold(v) > 0);
  const triggered = getPausedWindow(connection);
  return {
    enabled,
    paused: triggered !== null,
    triggered,
    eligible: isQuotaEligible(connection),
    windows: windows.map((w) => {
      const t = normalizeWindowThreshold(thresholds[w.key]);
      const remaining = Number(w.remainingPercentage);
      return {
        key: w.key,
        remainingPercentage: Number.isFinite(remaining) ? remaining : null,
        threshold: t,
        configured: t > 0,
        paused: t > 0 && !w.unlimited && Number.isFinite(remaining) && remaining <= t,
      };
    }),
  };
}

// ─── Snapshot derivation from raw provider usage ──────────────────────────────
// getUsageForProvider returns { plan, quotas: { name: { used, total, remaining,
// remainingPercentage, resetAt, unlimited }, ... } }. Collapse that into a
// per-window gating snapshot (one entry per quota window).

function pct(used, total) {
  const t = Number(total);
  const u = Number(used);
  if (!Number.isFinite(t) || t <= 0) return null;
  if (!Number.isFinite(u) || u <= 0) return 100;
  if (u >= t) return 0;
  return Math.max(0, Math.min(100, Math.round(((t - u) / t) * 100)));
}

function quotaRemainingPercentage(q) {
  if (q && typeof q.remainingPercentage === "number" && Number.isFinite(q.remainingPercentage)) {
    return Math.max(0, Math.min(100, Math.round(q.remainingPercentage)));
  }
  // Prefer used/total over a bare `remaining` (absolute count for some providers)
  // to avoid misreading it as a percentage.
  return pct(q?.used, q?.total);
}

/**
 * Derive a per-window gating snapshot from raw provider usage.
 * @param {string} provider
 * @param {Object} rawUsage - result of getUsageForProvider
 * @returns {{windows:Array<{key:string, remainingPercentage:number, resetAt:?string, unlimited:boolean}>, fetchedAt:string}|null}
 *   null when there's no usable quota data (caller should fail-open).
 */
export function deriveQuotaSnapshot(provider, rawUsage) {
  if (!rawUsage || typeof rawUsage !== "object" || rawUsage.message || rawUsage.error) return null;
  const quotas = rawUsage.quotas;
  if (!quotas || typeof quotas !== "object") return null;

  const entries = Array.isArray(quotas) ? quotas : Object.entries(quotas);
  if (entries.length === 0) return null;

  const now = new Date().toISOString();
  const windows = [];

  for (const entry of entries) {
    // Array form: [key, quota]; object form: we already have [key, quota].
    const [key, q] = Array.isArray(entry) ? entry : [entry?.name, entry];
    if (!q || typeof q !== "object") continue;
    const remainingPercentage = quotaRemainingPercentage(q);
    if (remainingPercentage == null) continue;
    let resetAt = null;
    if (q.resetAt) {
      const t = new Date(q.resetAt).getTime();
      if (Number.isFinite(t)) resetAt = new Date(t).toISOString();
    }
    windows.push({
      key: String(key ?? q.name ?? "unknown"),
      remainingPercentage,
      resetAt,
      unlimited: q.unlimited === true,
    });
  }

  if (windows.length === 0) return null;
  return { windows, fetchedAt: now };
}
