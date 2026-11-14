/**
 * Synthetic usage — GET https://api.synthetic.new/v2/quotas
 * Auth: Bearer <apiKey>. The call itself does not count against the quota.
 * Docs: https://dev.synthetic.new/docs/synthetic/quotas
 *
 * Response: { subscription: { limit, requests, renewsAt } }
 */

import { U, fetchWithTimeout, parseResetTime, toFiniteNumber } from "./shared.js";

const QUOTAS_URL = U("synthetic").url || "https://api.synthetic.new/v2/quotas";

/**
 * @param {string|null|undefined} apiKey
 * @param {object|null} proxyOptions
 */
export async function getSyntheticUsage(apiKey = null, proxyOptions = null) {
  if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
    return { message: "Synthetic API key not available. Add a key to view usage." };
  }

  try {
    const response = await fetchWithTimeout(
      QUOTAS_URL,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey.trim()}`,
          Accept: "application/json",
        },
      },
      10000,
      proxyOptions,
    );

    if (response.status === 401 || response.status === 403) {
      return { plan: "Synthetic", message: "Synthetic authentication failed. Check the API key." };
    }
    if (!response.ok) {
      return { plan: "Synthetic", message: `Synthetic usage API error (${response.status})` };
    }

    const data = await response.json().catch(() => ({}));
    // Weekly credit pool (what synthetic.new/billing shows). `subscription` is the retired counter.
    const weekly = [data?.planWeeklyLimit, data?.weeklyTokenLimit].find(
      (w) => w && Number.isFinite(Number(w.percentRemaining)),
    );
    if (weekly) {
      const left = Math.min(100, Math.max(0, Number(weekly.percentRemaining)));
      const used = Math.round((100 - left) * 100) / 100;
      return {
        plan: "Synthetic",
        quotas: {
          Weekly: {
            name: "Weekly credits",
            used,
            total: 100,
            percentage: Math.round(used),
            colorPercentage: Math.round(left),
            percentageIsUsed: true,
            remaining: Math.round(left * 100) / 100,
            unlimited: false,
            // Next 2% regen tick, not a full reset.
            resetAt: parseResetTime(weekly.nextRegenAt),
          },
        },
      };
    }

    const sub = data?.subscription;
    if (!sub || typeof sub !== "object") {
      return { plan: "Synthetic", message: "Synthetic returned no subscription quota." };
    }

    const total = toFiniteNumber(sub.limit, 0);
    if (total <= 0) {
      return { plan: "Synthetic", message: "No Synthetic subscription quota found for this key." };
    }
    const used = toFiniteNumber(sub.requests, 0);
    const remaining = Math.max(0, total - used);

    return {
      plan: "Synthetic",
      quotas: {
        Requests: {
          name: "Subscription requests",
          used,
          total,
          percentage: Math.round((used / total) * 100),
          colorPercentage: Math.round((remaining / total) * 100),
          percentageIsUsed: true,
          remaining,
          unlimited: false,
          resetAt: parseResetTime(sub.renewsAt),
        },
      },
    };
  } catch (error) {
    return { plan: "Synthetic", message: `Synthetic error: ${error.message}` };
  }
}
