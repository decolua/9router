/**
 * Synthetic usage — GET https://api.synthetic.new/v2/quotas
 * Auth: Bearer <apiKey>
 *
 * Live-verified 2026-11-11 with a real key:
 *   {
 *     "subscription": { "limit": 500, "requests": 0, "renewsAt": "..." },
 *     "search": { "hourly": { "limit": 250, "requests": 0, "renewsAt": "..." } },
 *     "planWeeklyLimit": { "nextRegenAt": "...", "percentRemaining": 84.23, "nextRegenPercent": 2 }
 *   }
 *
 * The two request buckets are absolute counts (used = requests, total = limit).
 * `planWeeklyLimit` is a weekly credit pool that only publishes the percentage
 * still available, so it is surfaced as a 0-100 bar like Ollama/GLM report
 * theirs — the absolute credit count is not exposed by the API.
 */

import { proxyAwareFetch } from "../../utils/proxyFetch.js";
import { parseResetTime, toFiniteNumber, U } from "./shared.js";

const QUOTAS_URL = U("synthetic").url;
const PLAN = "Synthetic";

// Request bucket → display name. Both buckets share one shape
// ({limit, requests, renewsAt}); `search` nests that shape under `hourly`.
const REQUEST_BUCKETS = [
  ["Subscription", "subscription"],
  ["Search (hourly)", "search.hourly"],
];

function pick(obj, path) {
  return path.split(".").reduce((acc, key) => (acc == null ? acc : acc[key]), obj);
}

// Absolute count bucket. Returns null when the vendor omits it or reports a
// non-positive limit — a "0 / 0" row is noise, not a quota.
function countQuota(bucket) {
  if (!bucket || typeof bucket !== "object") return null;
  const total = toFiniteNumber(bucket.limit, 0);
  if (total <= 0) return null;
  const used = Math.max(0, Math.min(total, toFiniteNumber(bucket.requests, 0)));
  return {
    used,
    total,
    // Pin the bar instead of letting the UI derive it from used/total: the
    // dashboard's generic fallback ignores these counts anyway, and an explicit
    // value keeps the row readable wherever it is rendered.
    remainingPercentage: Math.round(((total - used) / total) * 100),
    resetAt: parseResetTime(bucket.renewsAt),
    unlimited: false,
  };
}

// Weekly pool exposes only `percentRemaining` (how much is left). A missing
// value means the plan carries no weekly window (e.g. pay-as-you-go keys), so
// skip the row rather than fabricating 100%.
function weeklyQuota(weekly) {
  if (!weekly || typeof weekly !== "object") return null;
  const raw = weekly.percentRemaining;
  if (raw === undefined || raw === null || raw === "") return null;
  const remainingPercentage = Math.max(0, Math.min(100, toFiniteNumber(raw, 0)));
  return {
    used: Math.round((100 - remainingPercentage) * 100) / 100,
    total: 100,
    remainingPercentage,
    resetAt: parseResetTime(weekly.nextRegenAt),
    unlimited: false,
  };
}

/**
 * @param {string|null|undefined} apiKey
 * @param {object|null} proxyOptions
 */
export async function getSyntheticUsage(apiKey, proxyOptions = null) {
  if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
    return { message: "Synthetic API key not available. Add a key to view usage." };
  }

  try {
    const response = await proxyAwareFetch(
      QUOTAS_URL,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey.trim()}`,
          Accept: "application/json",
        },
      },
      proxyOptions,
    );

    if (response.status === 401 || response.status === 403) {
      return { plan: PLAN, message: "Synthetic authentication failed. Check the API key." };
    }

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      return {
        plan: PLAN,
        message: `Synthetic quotas API error (${response.status})${errText ? `: ${errText.slice(0, 120)}` : ""}`,
      };
    }

    const data = await response.json().catch(() => null);
    if (!data || typeof data !== "object") {
      return { plan: PLAN, message: "Synthetic quotas response was not JSON." };
    }

    const quotas = {};
    for (const [name, path] of REQUEST_BUCKETS) {
      const quota = countQuota(pick(data, path));
      if (quota) quotas[name] = quota;
    }
    const weekly = weeklyQuota(data.planWeeklyLimit);
    if (weekly) quotas["Weekly"] = weekly;

    if (Object.keys(quotas).length === 0) {
      return {
        plan: PLAN,
        message: "Synthetic connected. No quota data reported for this key.",
        quotas: {},
      };
    }

    return { plan: PLAN, quotas };
  } catch (error) {
    return { message: `Synthetic error: ${error.message}` };
  }
}
