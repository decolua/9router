/**
 * OpenCode Go usage — GET https://opencode.ai/zen/go/v1/usage
 * Auth: Bearer <apiKey>
 */

import { proxyAwareFetch } from "../../utils/proxyFetch.js";
import { parseResetTime, toFiniteNumber, U } from "./shared.js";

const USAGE_URL = U("opencode-go").url;
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

export async function getOpenCodeGoUsage(apiKey = null, proxyOptions = null) {
  if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
    return {
      message: "OpenCode Go API key not available. Add a key to view usage.",
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
        plan: "OpenCode Go",
        message: "OpenCode Go authentication failed. Check the API key.",
      };
    }

    if (response.status === 403) {
      const error = await response.json().catch(() => null);
      const subscriptionRequired = error?.error?.type === "EntitlementError";
      return {
        plan: "OpenCode Go",
        message: subscriptionRequired
          ? "OpenCode Go subscription required for this API key."
          : "OpenCode Go access forbidden for this API key.",
      };
    }

    if (!response.ok) {
      return {
        plan: "OpenCode Go",
        message: `OpenCode Go usage API error (${response.status}).`,
      };
    }

    const data = await response.json().catch(() => null);
    if (!data?.usage || typeof data.usage !== "object") {
      return {
        plan: "OpenCode Go",
        message: "OpenCode Go usage response did not contain quota data.",
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
        plan: "OpenCode Go",
        message: "OpenCode Go usage response did not contain valid quota data.",
      };
    }

    return { plan: "OpenCode Go", quotas };
  } catch (error) {
    return { message: `OpenCode Go error: ${error.message}` };
  }
}
