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
