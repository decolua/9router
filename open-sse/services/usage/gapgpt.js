/**
 * GapGPT (GapCode) usage handler
 */

import { proxyAwareFetch } from "../../utils/proxyFetch.js";
import { U, parseResetTime, toFiniteNumber } from "./shared.js";

// GapGPT usage API configuration
const GAPGPT_CONFIG = {
  usageUrl: U("gapgpt").url || "https://gapgpt.app/api/v1/api/codex/usage",
};

function formatQuotaWindow(window) {
  const used = Math.max(0, Math.min(100, toFiniteNumber(window?.used_percent ?? window?.percent_used ?? window?.used, 0)));
  const remaining = typeof window?.remaining_percent === "number"
    ? Math.max(0, Math.min(100, window.remaining_percent))
    : Math.max(0, 100 - used);
  return {
    used,
    total: 100,
    remaining,
    resetAt: parseResetTime(window?.reset_at ?? window?.resets_at ?? window?.resetAt ?? null),
    unlimited: false,
  };
}

export async function getGapGptUsage(accessToken, proxyOptions = null) {
  if (!accessToken) {
    return { message: "GapGPT API key / access token required to fetch usage" };
  }

  try {
    const response = await proxyAwareFetch(GAPGPT_CONFIG.usageUrl, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Accept": "application/json",
      },
    }, proxyOptions);

    if (!response.ok) {
      return { message: `GapGPT connected. Usage API temporarily unavailable (${response.status}).` };
    }

    const data = await response.json();
    const rateLimit = data.rate_limit || data.rate_limits || data;
    const quotas = {};

    if (rateLimit?.primary_window || rateLimit?.primary || rateLimit?.session) {
      quotas["session"] = formatQuotaWindow(rateLimit.primary_window || rateLimit.primary || rateLimit.session);
    }
    if (rateLimit?.secondary_window || rateLimit?.secondary || rateLimit?.weekly) {
      quotas["weekly"] = formatQuotaWindow(rateLimit.secondary_window || rateLimit.secondary || rateLimit.weekly);
    }

    return {
      plan: data.plan_type || data.plan || "GapGPT",
      limitReached: rateLimit?.limit_reached || false,
      credits: data.credits || null,
      quotas,
    };
  } catch (error) {
    throw new Error(`Failed to fetch GapGPT usage: ${error.message}`);
  }
}

