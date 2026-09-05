/**
 * Antigravity weekly-quota fetcher + parser
 *
 * Enforces family-level weekly quota visibility (Gemini Models, Claude and GPT models)
 * via Google Cloud Code retrieveUserQuotaSummary RPC.
 * Best-effort, fail-open, and non-blocking.
 */

import crypto from "crypto";
import { ANTIGRAVITY_IDE_BASE_URL, ANTIGRAVITY_IDE_USER_AGENT, ANTIGRAVITY_IDE_VERSION } from "../../providers/shared.js";
import { U, parseResetTime, fetchWithTimeout } from "./shared.js";

const WEEKLY_QUOTA_TTL_MS = 60 * 1000;
const weeklyQuotaCache = new Map();
const inflightRequests = new Map();

/**
 * Generate a collision-resistant, leak-free cache key from projectId and full accessToken hash.
 *
 * @param {string} projectId
 * @param {string} accessToken
 * @returns {string}
 */
export function getWeeklyCacheKey(projectId, accessToken) {
  const tokenHash = crypto
    .createHash("sha256")
    .update(String(accessToken || ""))
    .digest("hex")
    .slice(0, 16);
  return `${projectId}:${tokenHash}`;
}

/**
 * Reset in-memory cache (primarily for unit tests).
 */
export function _resetWeeklyQuotaCacheForTesting() {
  weeklyQuotaCache.clear();
  inflightRequests.clear();
}

/**
 * Parse raw retrieveUserQuotaSummary response into family-level weekly quotas.
 * Supports both top-level groups envelope and nested quotaSummary.groups envelope.
 *
 * @param {object} summaryData - Raw API response JSON
 * @returns {Record<string, object>} Quotas map keyed by gemini_weekly / claude_gpt_weekly
 */
export function parseAntigravityWeeklyQuotas(summaryData) {
  if (!summaryData || typeof summaryData !== "object") return {};

  const groups = Array.isArray(summaryData.groups)
    ? summaryData.groups
    : Array.isArray(summaryData?.quotaSummary?.groups)
    ? summaryData.quotaSummary.groups
    : null;

  if (!groups || groups.length === 0) return {};

  const quotas = {};

  for (const group of groups) {
    if (!group || typeof group !== "object" || !Array.isArray(group.buckets)) continue;

    const displayName = String(group.displayName || "").trim();
    let familyKey = null;
    let familyDisplayName = null;

    if (displayName === "Gemini Models") {
      familyKey = "gemini_weekly";
      familyDisplayName = "Gemini Weekly";
    } else if (displayName === "Claude and GPT models") {
      familyKey = "claude_gpt_weekly";
      familyDisplayName = "Claude & GPT Weekly";
    } else {
      // Ignore unknown Google family groups safely
      continue;
    }

    // Identify weekly bucket:
    // Priority 1: explicit window === "weekly"
    // Priority 2 (fallback): conservative /\bweekly\b/i on bucketId or displayName
    let weeklyBucket = null;

    for (const b of group.buckets) {
      if (!b || typeof b !== "object") continue;
      if (b.window === "weekly") {
        weeklyBucket = b;
        break;
      }
    }

    if (!weeklyBucket) {
      for (const b of group.buckets) {
        if (!b || typeof b !== "object") continue;
        const idMatch = typeof b.bucketId === "string" && /\bweekly\b/i.test(b.bucketId);
        const nameMatch = typeof b.displayName === "string" && /\bweekly\b/i.test(b.displayName);
        if (idMatch || nameMatch) {
          weeklyBucket = b;
          break;
        }
      }
    }

    if (!weeklyBucket) continue;
    if (weeklyBucket.disabled === true) continue;
    if (weeklyBucket.remainingFraction == null) continue;

    const rawFraction = Number(weeklyBucket.remainingFraction);
    if (!Number.isFinite(rawFraction)) continue;

    const remainingFraction = Math.max(0, Math.min(1, rawFraction));
    const remainingPercentage = remainingFraction * 100;

    // Normalize to 0..100 percentage scale (used % / total 100) matching 9Router ratioQuota
    // convention without fabricating an arbitrary request count (such as 1000).
    const total = 100;
    const remaining = Math.round(total * remainingFraction);
    const used = Math.max(0, total - remaining);

    quotas[familyKey] = {
      used,
      total,
      remainingFraction,
      resetAt: parseResetTime(weeklyBucket.resetTime),
      remainingPercentage,
      unlimited: false,
      displayName: familyDisplayName,
    };
  }

  return quotas;
}

/**
 * Fetch and parse Antigravity weekly quotas from Google Cloud Code API.
 * Fail-open: returns empty object on any failure.
 * Cached process-locally for 60s, with immediate bypass on force or exhaustion.
 *
 * @param {string} accessToken - OAuth access token
 * @param {string} projectId - Cloud AI Companion project ID
 * @param {object} proxyOptions - Connection proxy options
 * @param {object} options - Options (e.g. { force: true })
 * @returns {Promise<Record<string, object>>}
 */
export async function fetchAndParseAntigravityWeeklyQuotas(
  accessToken,
  projectId,
  proxyOptions = null,
  options = {}
) {
  if (!accessToken || !projectId) return {};

  const isForce = Boolean(options?.force || proxyOptions?.force);
  const cacheKey = getWeeklyCacheKey(projectId, accessToken);
  const now = Date.now();

  if (isForce) {
    weeklyQuotaCache.delete(cacheKey);
  } else if (weeklyQuotaCache.has(cacheKey)) {
    const cached = weeklyQuotaCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return cached.quotas;
    }
  }

  if (inflightRequests.has(cacheKey)) {
    return await inflightRequests.get(cacheKey);
  }

  const fetchPromise = (async () => {
    try {
      const quotaSummaryUrl =
        U("antigravity")?.quotaSummaryApiUrl ||
        `${ANTIGRAVITY_IDE_BASE_URL}/v1internal:retrieveUserQuotaSummary`;

      const response = await fetchWithTimeout(
        quotaSummaryUrl,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "User-Agent": ANTIGRAVITY_IDE_USER_AGENT,
            "Content-Type": "application/json",
            "X-Client-Name": "antigravity",
            "X-Client-Version": ANTIGRAVITY_IDE_VERSION,
          },
          body: JSON.stringify({ project: projectId }),
        },
        10000,
        proxyOptions
      );

      if (!response || !response.ok) {
        return {};
      }

      const data = await response.json();
      const quotas = parseAntigravityWeeklyQuotas(data);

      // Do not cache exhausted quotas (0% remaining) for 60s to prevent stale green state
      const isExhausted = Object.values(quotas).some(
        (q) => typeof q?.remainingPercentage === "number" && q.remainingPercentage <= 0
      );

      if (!isExhausted && Object.keys(quotas).length > 0) {
        weeklyQuotaCache.set(cacheKey, {
          quotas,
          expiresAt: Date.now() + WEEKLY_QUOTA_TTL_MS,
        });
      } else {
        weeklyQuotaCache.delete(cacheKey);
      }

      // Simple bounded cache cleanup
      if (weeklyQuotaCache.size > 100) {
        const cur = Date.now();
        for (const [k, v] of weeklyQuotaCache) {
          if (v.expiresAt <= cur) weeklyQuotaCache.delete(k);
        }
      }

      return quotas;
    } catch {
      // Fail-open: network failure, timeout, 5xx, or invalid JSON never throw
      return {};
    }
  })().finally(() => {
    inflightRequests.delete(cacheKey);
  });

  inflightRequests.set(cacheKey, fetchPromise);
  return await fetchPromise;
}
