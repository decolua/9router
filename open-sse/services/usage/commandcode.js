/**
 * Command Code usage — credit balances, plan windows and billing-period totals.
 *
 * Auth: Bearer <apiKey> (the CLI's `user_...` key). This talks to the same
 * alpha API the `/alpha/generate` endpoint uses; the CLI is only one client of
 * it, so the data is reachable without shelling out to `cmdc`.
 *
 * Endpoints (all GET):
 *   /alpha/whoami             → { user, org }   (org.id feeds ?orgId= below)
 *   /alpha/billing/credits    → { credits, windowLimits }
 *   /alpha/usage/summary      → billing-period totals
 *
 * Cloudflare fronting this API fingerprints requests and answers
 * `403 error code: 1010` when the CLI identity headers are absent, so the
 * version/user-agent headers below are required, not cosmetic.
 */

import { proxyAwareFetch } from "../../utils/proxyFetch.js";
import { parseResetTime, toFiniteNumber } from "./shared.js";

const API_BASE = "https://api.commandcode.ai";
const WHOAMI_URL = `${API_BASE}/alpha/whoami`;
const CREDITS_URL = `${API_BASE}/alpha/billing/credits`;
const SUMMARY_URL = `${API_BASE}/alpha/usage/summary`;
const SUBSCRIPTIONS_URL = `${API_BASE}/alpha/billing/subscriptions`;

// Announced CLI version. Kept in sync with the provider registry transport
// header so upstream sees one consistent client identity.
const CLI_VERSION = "0.25.7";

function buildHeaders(apiKey) {
  return {
    Authorization: `Bearer ${apiKey}`,
    Accept: "application/json",
    "x-command-code-version": CLI_VERSION,
    "x-cli-environment": "cli",
    "user-agent": `command-code/${CLI_VERSION}`,
  };
}

function buildUrl(endpoint, orgId) {
  if (!orgId) return endpoint;
  return `${endpoint}?orgId=${encodeURIComponent(orgId)}`;
}

async function getJson(url, apiKey, proxyOptions) {
  const response = await proxyAwareFetch(
    url,
    { method: "GET", headers: buildHeaders(apiKey) },
    proxyOptions,
  );
  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    return { error: { status: response.status, body: errText.slice(0, 160) } };
  }
  const data = await response.json().catch(() => null);
  if (!data || typeof data !== "object") {
    return { error: { status: response.status, body: "non-JSON response" } };
  }
  return { data };
}

function toPercent(used, total) {
  if (!(total > 0)) return 0;
  return Math.max(0, Math.min(100, Math.round(((total - used) / total) * 100)));
}

// Credit amounts are fractional USD (e.g. 1.261 of a 16 cap). The dashboard
// renders `used`/`total` with the viewer's own locale, and in most of
// Europe/Indonesia a comma is the decimal separator — so a numeric 1.261 is
// shown as "1,261" and reads as one thousand two hundred sixty-one against a
// cap of 16. Formatting here (dot decimal, fixed 2dp) keeps the figure
// unambiguous regardless of the viewer's locale.
function formatCredit(value, decimals = 2) {
  return toFiniteNumber(value, 0).toFixed(decimals);
}

/**
 * Build a window quota entry from the upstream windowLimits shape.
 * `used`/`cap` are USD credits. The dashboard renders `remainingPercentage`
 * (0–100) — an absolute `remaining` would be read as a percentage, so it is
 * deliberately never set here.
 */
function windowQuota(window) {
  if (!window || typeof window !== "object") return null;
  const used = Math.max(0, toFiniteNumber(window.used, 0));
  const cap = Math.max(0, toFiniteNumber(window.cap, 0));
  return {
    used: formatCredit(used),
    total: formatCredit(cap),
    remainingPercentage: toPercent(used, cap),
    resetAt: parseResetTime(window.resetAt),
  };
}

/**
 * @param {string|null|undefined} apiKey
 * @param {object|null} proxyOptions
 */
export async function getCommandCodeUsage(apiKey = null, proxyOptions = null) {
  if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
    return {
      message: "Command Code API key not available. Add a key to view usage.",
    };
  }

  const key = apiKey.trim();

  try {
    // whoami is best-effort: it only supplies the optional orgId scope.
    const whoami = await getJson(WHOAMI_URL, key, proxyOptions);
    if (whoami.error && whoami.error.status === 401) {
      return {
        plan: "Command Code",
        message: "Command Code authentication failed. Check the API key.",
      };
    }
    const orgId = whoami.data?.org?.id ?? null;

    const credits = await getJson(
      buildUrl(CREDITS_URL, orgId),
      key,
      proxyOptions,
    );
    if (credits.error) {
      const { status, body } = credits.error;
      if (status === 401 || status === 403) {
        return {
          plan: "Command Code",
          message:
            "Command Code rejected the request. Check the API key (Cloudflare blocks requests without the CLI identity headers).",
        };
      }
      return {
        plan: "Command Code",
        message: `Command Code credits API error (${status})${body ? `: ${body}` : ""}`,
      };
    }

    const quotaMap = {};
    const windowLimits = credits.data?.windowLimits || null;

    const fiveHour = windowQuota(windowLimits?.fiveHour);
    if (fiveHour) quotaMap["5-hour"] = fiveHour;

    const weekly = windowQuota(windowLimits?.weekly);
    if (weekly) quotaMap["Weekly"] = weekly;

    // Plan + current billing period. Best-effort: failures must not hide the
    // window quotas above.
    const subscription = await getJson(SUBSCRIPTIONS_URL, key, proxyOptions);
    if (subscription.error && subscription.error.status === 401) {
      return {
        plan: "Command Code",
        message: "Command Code authentication failed. Check the API key.",
      };
    }

    const balance = credits.data?.credits;
    if (balance) {
      // `monthlyCredits` is the plan's REMAINING allowance for the current
      // billing period (not a cap), so usage is `allowance - remaining`.
      const remaining = Math.max(0, toFiniteNumber(balance.monthlyCredits, 0));
      const sum = await getJson(buildUrl(SUMMARY_URL, orgId), key, proxyOptions);
      const spent = sum.error
        ? 0
        : Math.max(0, toFiniteNumber(sum.data?.totalCost, 0));
      const allowance = remaining + spent;
      if (allowance > 0) {
        quotaMap["Monthly credits"] = {
          used: formatCredit(spent),
          total: formatCredit(allowance),
          remainingPercentage: toPercent(spent, allowance),
          resetAt: parseResetTime(
            subscription.data?.data?.currentPeriodEnd ??
              subscription.data?.currentPeriodEnd,
          ),
        };
      }
    }

    if (Object.keys(quotaMap).length === 0) {
      return {
        plan: "Command Code",
        message: "Command Code connected. No credit or window data returned.",
      };
    }

    const exceeded = windowLimits?.exceeded;
    const limited = windowLimits?.limited === true;
    const planId = subscription.data?.data?.planId || null;

    const planLabel = planId ? `Command Code (${planId})` : "Command Code";
    return {
      plan: limited && exceeded ? `${planLabel} — limit exceeded` : planLabel,
      quotas: quotaMap,
    };
  } catch (error) {
    return { message: `Command Code error: ${error.message}` };
  }
}
