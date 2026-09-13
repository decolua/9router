/**
 * Antigravity quota summary — best-effort retrieval from retrieveUserQuotaSummary.
 * Failure never breaks existing per-model quota display.
 *
 * Google meters Antigravity quota in TWO SHARED POOLS per account:
 *   - "Gemini Models"      → all gemini-* models (incl. image & pro-agent)
 *   - "Claude and GPT models" → claude-* and gpt-oss-* models
 * Each pool can have up to two windows, each a bucket in the summary:
 *   - Weekly window  (all tiers)
 *   - 5-hour window  (paid tiers; reported disabled=true when the weekly
 *     window is exhausted — its reading is then meaningless until the weekly
 *     refresh, so the weekly resetAt must win)
 *
 * Tier detection: loadCodeAssist returns currentTier.id="free-tier" for ALL
 * accounts (even paid ones) — the real subscription lives in paidTier.id:
 *   free-tier | g1-plus-tier | g1-pro-tier | g1-ultra-tier
 */

import { U, parseResetTime, fetchWithTimeout } from "./shared.js";
import { ANTIGRAVITY_IDE_USER_AGENT, ANTIGRAVITY_IDE_VERSION } from "../../providers/shared.js";

// — Quota summary config ——————————————————————————————
const WEEKLY_CONFIG = {
  ...U("antigravity"),
  userAgent: ANTIGRAVITY_IDE_USER_AGENT,
};

// — Cache: TTL + in-flight dedup per project ———————————————
const WEEKLY_CACHE_TTL_MS = 180_000; // 3 minutes
const weeklyCache = new Map(); // cacheKey -> { result, expiresAt } | { promise }

function cacheKey(accessToken, projectId) {
  return `${accessToken}::${projectId || ""}`;
}

// Exported for tests only
export function _clearWeeklyCache() {
  weeklyCache.clear();
}

// — Group-name to stable key mapping ——————————————————————
const GROUP_MATCHERS = [
  { pattern: /gemini/i, key: "gemini", displayName: "Gemini" },
  { pattern: /claude|gpt/i, key: "claude_gpt", displayName: "Claude & GPT" },
];

// — Window detection inside a pool group ————————————————
// Buckets carry their window in bucketId/displayName ("weekly", "five hour"/"5h").
function detectWindow(bucketText) {
  if (bucketText.includes("weekly")) return "weekly";
  if (bucketText.includes("five") || bucketText.includes("5h") || bucketText.includes("5-hour")) return "5h";
  return null;
}

// — paidTier.id → human tier label ————————————————————————
const TIER_LABELS = [
  [/^free/i, "Free"],
  [/plus/i, "Plus"],
  [/pro/i, "Pro"],
  [/ultra/i, "Ultra"],
];

export function tierFromPaidTierId(paidTierId) {
  if (!paidTierId || typeof paidTierId !== "string") return null;
  for (const [pattern, label] of TIER_LABELS) {
    if (pattern.test(paidTierId)) return label;
  }
  return null;
}

/**
 * Parse a retrieveUserQuotaSummary response into normalized pool quotas.
 * Pure function — safe to unit-test without network.
 *
 * Emits BOTH shapes so callers can pick what they need:
 *  - Legacy flat keys (backward compat with the old weekly-only parser):
 *      gemini_weekly, claude_gpt_weekly
 *  - Pool-scoped window keys (routing + grouped dashboard):
 *      gemini_5h, claude_gpt_5h
 *
 * Disabled 5h buckets (weekly exhausted upstream) are parsed but flagged
 * `disabled: true` so routing can prefer the weekly resetAt.
 *
 * @param {Object|null} data  Raw JSON response
 * @returns {Object}  e.g. { gemini_weekly: {...}, gemini_5h: {...}, claude_gpt_weekly: {...} }
 */
export function parseWeeklyQuotaSummary(data) {
  if (!data || typeof data !== "object") return {};

  // Groups may live at data.groups or data.quotaSummary.groups
  const groups = Array.isArray(data.groups)
    ? data.groups
    : Array.isArray(data.quotaSummary?.groups)
      ? data.quotaSummary.groups
      : null;

  if (!groups) return {};

  const result = {};

  for (const group of groups) {
    if (!group || typeof group !== "object") continue;
    const displayName = group.displayName || "";

    const buckets = Array.isArray(group.buckets) ? group.buckets : [];
    for (const bucket of buckets) {
      if (!bucket || typeof bucket !== "object") continue;

      const bucketText = `${bucket.bucketId || ""} ${bucket.displayName || ""}`.toLowerCase();
      const window = detectWindow(bucketText);
      if (!window) continue;

      const remainingFraction = Number(bucket.remainingFraction);
      if (!Number.isFinite(remainingFraction)) continue;

      // Match group to a known family
      for (const matcher of GROUP_MATCHERS) {
        if (!matcher.pattern.test(displayName)) continue;

        const total = 1000;
        const remaining = Math.round(total * remainingFraction);
        const used = Math.max(0, total - remaining);

        result[`${matcher.key}_${window}`] = {
          used,
          total,
          resetAt: parseResetTime(bucket.resetTime),
          remainingPercentage: remainingFraction * 100,
          unlimited: false,
          disabled: bucket.disabled === true,
          displayName: `${matcher.displayName} (${window === "weekly" ? "Weekly" : "5h"})`,
        };
        break; // first matching bucket per family wins
      }
    }
  }

  return result;
}

/**
 * Fetch quota summary — cached, deduped, never throws.
 */
export async function fetchAntigravityWeeklyQuota(accessToken, projectId, proxyOptions = null) {
  const key = cacheKey(accessToken, projectId);

  // Serve in-flight or cached
  const hit = weeklyCache.get(key);
  if (hit?.promise) return hit.promise;
  if (hit && hit.expiresAt > Date.now()) return hit.result;

  const promise = (async () => {
    try {
      const url = WEEKLY_CONFIG.quotaSummaryApiUrl;
      if (!url) return {};

      const response = await fetchWithTimeout(url, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "User-Agent": WEEKLY_CONFIG.userAgent,
          "Content-Type": "application/json",
          "X-Client-Name": "antigravity",
          "X-Client-Version": ANTIGRAVITY_IDE_VERSION,
        },
        body: JSON.stringify({
          ...(projectId ? { project: projectId } : {}),
        }),
      }, 10000, proxyOptions);

      if (!response.ok) return {};

      const data = await response.json();
      return parseWeeklyQuotaSummary(data);
    } catch {
      return {};
    }
  })();

  weeklyCache.set(key, { promise });

  try {
    const result = await promise;
    if (result && Object.keys(result).length > 0) {
      weeklyCache.set(key, { result, expiresAt: Date.now() + WEEKLY_CACHE_TTL_MS });
    } else {
      weeklyCache.delete(key);
    }
    return result;
  } catch {
    weeklyCache.delete(key);
    return {};
  }
}
