/**
 * OpenCode Go usage — GET https://opencode.ai/zen/go/v1/usage
 * Auth: Bearer <apiKey> (same Go key used for chat/completions — no session cookie)
 *
 * Shipped 2026-08-11 (anomalyco/opencode#16513, reshaped by d4704347). Not in the
 * public docs yet, so the response shape below is taken from the deployed endpoint:
 *
 *   { "usage": {
 *       "rolling": { "status": "ok", "percent": 0,  "resetsAt": "2026-08-12T20:23:13.083Z" },
 *       "weekly":  { "status": "ok", "percent": 0,  "resetsAt": "2026-08-17T00:00:00.083Z" },
 *       "monthly": { "status": "ok", "percent": 91, "resetsAt": "2026-08-25T01:33:44.083Z" } } }
 *
 * `status` is "ok" | "rate-limited"; `percent` is a floored integer 0-100. The server
 * exposes no dollar amounts — it holds limits in micro-cents internally and only ever
 * returns the percentage, so these quotas are percent-only.
 */

import { proxyAwareFetch } from "../../utils/proxyFetch.js";
import { U, parseResetTime, toFiniteNumber } from "./shared.js";

const USAGE_URL = U("opencode-go").url;

// Provider's own vocabulary from the workspace console. The rolling window length
// is server-configured (limits.rollingWindow) and is NOT echoed in the response,
// so don't label it "(5h)" — only the absolute resetsAt is trustworthy.
const WINDOW_LABELS = {
  rolling: "Rolling",
  weekly: "Weekly",
  monthly: "Monthly",
};

function formatWindow(window) {
  const used = Math.max(0, Math.min(100, toFiniteNumber(window?.percent, 0)));
  return {
    used,
    total: 100,
    // Percent-only: never set absolute `remaining` — QuotaTable reads it as a
    // 0-100 percentage (same trap as Qoder/grok-cli).
    remainingPercentage: 100 - used,
    resetAt: parseResetTime(window?.resetsAt ?? null),
    unlimited: false,
  };
}

/**
 * @param {string|null|undefined} apiKey
 * @param {object|null} proxyOptions
 */
export async function getOpenCodeGoUsage(apiKey = null, proxyOptions = null) {
  if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
    return { message: "OpenCode Go API key not available. Add a key to view usage." };
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

    const data = await response.json().catch(() => null);
    // Errors come back as { type: "error", error: { type, message } }
    const errorType = data?.error?.type || null;
    const errorMessage = data?.error?.message || null;

    if (response.status === 401) {
      return { message: errorMessage || "OpenCode Go authentication failed. Check the API key." };
    }

    // A valid key with no Go subscription 403s — distinct from an auth failure,
    // and not something re-authorizing will fix.
    if (response.status === 403 || errorType === "EntitlementError") {
      return {
        plan: "OpenCode Go",
        message: errorMessage || "OpenCode Go subscription required.",
      };
    }

    if (!response.ok) {
      return {
        plan: "OpenCode Go",
        message: `OpenCode Go usage API error (${response.status})${errorMessage ? `: ${errorMessage}` : ""}`,
      };
    }

    const usage = data?.usage;
    if (!usage || typeof usage !== "object") {
      return { message: "OpenCode Go usage response was not in the expected shape." };
    }

    const quotas = {};
    let limitReached = false;
    for (const [key, label] of Object.entries(WINDOW_LABELS)) {
      const window = usage[key];
      if (!window || typeof window !== "object") continue;
      quotas[label] = formatWindow(window);
      if (window.status === "rate-limited") limitReached = true;
    }

    if (Object.keys(quotas).length === 0) {
      return { plan: "OpenCode Go", message: "OpenCode Go connected. No usage windows reported.", quotas: {} };
    }

    return { plan: "OpenCode Go", limitReached, quotas };
  } catch (error) {
    return { message: `OpenCode Go error: ${error.message}` };
  }
}
