/**
 * Pure per-account quota-pause helpers shared by the routing engine
 * (src/sse/services/quotaGuard.js) and the dashboard UI. No DB/server imports
 * so this is safe to use in client components — it only reads plain fields that
 * already live on the connection object (quotaPauseThreshold, lastQuotaSnapshot).
 *
 * Paused state is derived, never stored: once remaining% climbs back above the
 * threshold (e.g. after resetAt) the account auto-recovers for routing.
 */

import { USAGE_APIKEY_PROVIDERS } from "@/shared/constants/providers";

export function normalizeThreshold(connection) {
  const t = Number(connection?.quotaPauseThreshold);
  if (!Number.isFinite(t) || t <= 0 || t > 100) return 0;
  return t;
}

export function isQuotaEligible(connection) {
  if (!connection) return false;
  const isOAuth = connection.authType === "oauth";
  const isApikeyAuth =
    connection.authType === "apikey" || connection.authType === "api_key";
  const isApikeyEligible =
    isApikeyAuth && USAGE_APIKEY_PROVIDERS.includes(connection.provider);
  return isOAuth || isApikeyEligible;
}

export function isQuotaPaused(connection) {
  const threshold = normalizeThreshold(connection);
  if (!threshold) return false;
  if (!isQuotaEligible(connection)) return false;
  const snapshot = connection.lastQuotaSnapshot || null;
  if (!snapshot) return false;
  if (snapshot.unlimited) return false;
  const remaining = Number(snapshot.remainingPercentage);
  if (!Number.isFinite(remaining)) return false;
  return remaining <= threshold;
}

export function getQuotaPauseInfo(connection) {
  const threshold = normalizeThreshold(connection);
  if (!threshold) {
    return {
      enabled: false,
      paused: false,
      threshold: 0,
      remainingPercentage: null,
      resetAt: null,
      unlimited: false,
      eligible: isQuotaEligible(connection),
    };
  }
  const snapshot = connection.lastQuotaSnapshot || null;
  const remainingPercentage = snapshot ? Number(snapshot.remainingPercentage) : null;
  return {
    enabled: true,
    paused: isQuotaPaused(connection),
    threshold,
    remainingPercentage: Number.isFinite(remainingPercentage) ? remainingPercentage : null,
    resetAt: snapshot?.resetAt || null,
    unlimited: Boolean(snapshot?.unlimited),
    eligible: isQuotaEligible(connection),
  };
}

// ─── Snapshot derivation from raw provider usage ──────────────────────────────
// getUsageForProvider returns { plan, quotas: { name: { used, total, remaining,
// remainingPercentage, resetAt, unlimited }, ... } }. There is NO top-level
// remainingPercentage — it lives inside each quota window. Collapse that into a
// single gating snapshot for the per-account pause threshold.

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
  // Prefer used/total over a bare `remaining` (which is an absolute count for
  // some providers, e.g. Qoder/Codex credits/requests) to avoid misreading it as %.
  return pct(q?.used, q?.total);
}

/**
 * Derive a single gating snapshot from raw provider usage.
 * @param {string} provider
 * @param {Object} rawUsage - result of getUsageForProvider
 * @returns {{remainingPercentage:number, resetAt:?string, unlimited:boolean, fetchedAt:string}|null}
 *   null when there's no usable quota data (caller should fail-open).
 */
export function deriveQuotaSnapshot(provider, rawUsage) {
  if (!rawUsage || typeof rawUsage !== "object" || rawUsage.message || rawUsage.error) return null;
  const quotas = rawUsage.quotas;
  if (!quotas || typeof quotas !== "object") return null;

  const entries = Array.isArray(quotas) ? quotas : Object.values(quotas);
  if (entries.length === 0) return null;

  const now = new Date().toISOString();
  const pcts = [];
  let allUnlimited = true;
  let earliestReset = null;

  for (const q of entries) {
    if (!q || typeof q !== "object") continue;
    if (q.unlimited === true) continue; // unlimited windows don't deplete
    allUnlimited = false;
    const p = quotaRemainingPercentage(q);
    if (p != null) pcts.push(p);
    if (q.resetAt) {
      const t = new Date(q.resetAt).getTime();
      if (Number.isFinite(t) && (earliestReset == null || t < earliestReset)) earliestReset = t;
    }
  }

  // No finite quotas at all (e.g. all windows unlimited) → treat as unlimited.
  if (pcts.length === 0) {
    return { remainingPercentage: 100, resetAt: earliestReset ? new Date(earliestReset).toISOString() : null, unlimited: true, fetchedAt: now };
  }

  return {
    remainingPercentage: Math.min(...pcts),
    resetAt: earliestReset ? new Date(earliestReset).toISOString() : null,
    unlimited: false,
    fetchedAt: now,
  };
}
