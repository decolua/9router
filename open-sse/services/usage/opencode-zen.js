/**
 * OpenCode Zen usage — GET https://opencode.ai/zen/v1/usage
 * Auth: Bearer <apiKey>
 */

import { proxyAwareFetch } from "../../utils/proxyFetch.js";
import { parseResetTime, toFiniteNumber, U } from "./shared.js";

const USAGE_URL = U("opencode-zen").url;
const QUOTA_NAMES = {
  rolling: "Rolling",
  weekly: "Weekly",
  monthly: "Monthly",
};

function parsePercent(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export async function getOpenCodeZenUsage(apiKey = null, proxyOptions = null) {
  if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
    return {
      message: "OpenCode Zen API key not available. Add a key to view usage.",
    };
  }

  try {
    const response = await proxyAwareFetch(
      USAGE_URL,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey.trim()}`,
          Accept: "application/json",
        },
      },
      proxyOptions,
    );

    if (response.status === 401) {
      return {
        plan: "OpenCode Zen",
        message: "OpenCode Zen authentication failed. Check the API key.",
      };
    }

    if (response.status === 403) {
      const error = await response.json().catch(() => null);
      const subscriptionRequired = error?.error?.type === "EntitlementError";
      return {
        plan: "OpenCode Zen",
        message: subscriptionRequired
          ? "OpenCode Zen billing required for this API key."
          : "OpenCode Zen access forbidden for this API key.",
      };
    }

    if (!response.ok) {
      return {
        plan: "OpenCode Zen",
        message: `OpenCode Zen usage API error (${response.status}).`,
      };
    }

    const data = await response.json().catch(() => null);
    if (!data?.usage || typeof data.usage !== "object") {
      return {
        plan: "OpenCode Zen",
        message: "OpenCode Zen usage response did not contain quota data.",
      };
    }

    const quotas = {};
    for (const [period, name] of Object.entries(QUOTA_NAMES)) {
      const quota = data.usage[period];
      if (!quota || typeof quota !== "object") continue;
      const percent = parsePercent(quota.percent);
      if (percent === null) continue;
      const used = Math.max(0, Math.min(100, toFiniteNumber(percent, 0)));
      quotas[name] = {
        used,
        total: 100,
        remaining: 100 - used,
        remainingPercentage: 100 - used,
        resetAt: parseResetTime(quota.resetsAt),
        unlimited: false,
      };
    }


    if (Object.keys(quotas).length === 0) {
      return {
        plan: "OpenCode Zen",
        message: "OpenCode Zen usage response did not contain valid quota data.",
      };
    }

    return { plan: "OpenCode Zen", quotas };
  } catch (error) {
    return { message: `OpenCode Zen error: ${error.message}` };
  }
}
