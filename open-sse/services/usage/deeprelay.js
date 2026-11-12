/**
 * DeepRelay usage — prepaid balance plus per-day spend.
 *
 *   GET https://api.deeprelay.ai/v1/billing/balance  → primary source
 *   GET https://api.deeprelay.ai/v1/usage?bucket=day → optional spend history
 *   Auth: Bearer <apiKey>
 *
 * Live-verified 2026-11-11 with a real `deeprelay_*` key:
 *   balance → { "balance_cents": 445, "balance_dollars": 4.45, "auto_pay_enabled": false,
 *               "auto_pay_threshold_cents": 0, "auto_pay_amount_cents": 0, "burn_cents_per_hour": 0 }
 *   usage   → { "data": [], "next_cursor": null }   (empty for every key so far)
 *
 * DeepRelay bills per token with no cap, so there is no "quota" to drain — the
 * dashboard rows are informational: the remaining wallet balance, the hourly
 * burn rate when the account reports one, and the spend history once the
 * vendor starts populating it.
 */

import { proxyAwareFetch } from "../../utils/proxyFetch.js";
import { parseResetTime, toFiniteNumber } from "./shared.js";

const BALANCE_URL = "https://api.deeprelay.ai/v1/billing/balance";
const USAGE_URL = "https://api.deeprelay.ai/v1/usage?bucket=day";
const PLAN = "DeepRelay";
// The usage endpoint is a best-effort extra: it must never delay or fail the
// balance row the user actually came for.
const USAGE_TIMEOUT_MS = 5000;
// Vendor returns ISO timestamps but does not promise it; `parseResetTime`
// throws away anything it cannot parse, which is exactly what we want here.
function centsToUsd(cents) {
  return Math.round(toFiniteNumber(cents, 0)) / 100;
}

function authHeaders(apiKey) {
  return { Authorization: `Bearer ${apiKey.trim()}`, Accept: "application/json" };
}

// Pull the vendor's error slug so the UI can say *why* a 403 happened.
function readErrorCode(body) {
  return body?.error?.code || body?.error?.type || body?.code || null;
}

/**
 * Sum `data[].cost_cents` into one spend row. Returns null for an empty (or
 * unreadable) history: rendering "0.00 USD spent" for an account that has no
 * usage records at all is misleading, so the row is simply omitted.
 */
function spendQuota(usageBody) {
  const rows = Array.isArray(usageBody?.data) ? usageBody.data : [];
  if (rows.length === 0) return null;

  let totalCents = 0;
  let earliest = null;
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    totalCents += toFiniteNumber(row.cost_cents, 0);
    const bucketStart = parseResetTime(row.bucket_start);
    if (bucketStart && (earliest === null || bucketStart < earliest)) earliest = bucketStart;
  }

  return {
    used: Math.round(totalCents) / 100,
    total: 0,
    // No cap on a per-token gateway, so the row renders as "N used · Unlimited".
    remainingPercentage: 100,
    resetAt: null,
    unlimited: true,
    unit: "USD",
    windowStart: earliest,
  };
}

async function fetchUsageSpend(apiKey, proxyOptions) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), USAGE_TIMEOUT_MS);
  try {
    const response = await proxyAwareFetch(
      USAGE_URL,
      { method: "GET", headers: authHeaders(apiKey), signal: controller.signal },
      proxyOptions,
    );
    if (!response.ok) return null;
    return spendQuota(await response.json().catch(() => null));
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {string|null|undefined} apiKey
 * @param {object|null} proxyOptions
 */
export async function getDeepRelayUsage(apiKey, proxyOptions = null) {
  if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
    return { message: "DeepRelay API key not available. Add a key to view usage." };
  }

  try {
    const response = await proxyAwareFetch(
      BALANCE_URL,
      { method: "GET", headers: authHeaders(apiKey) },
      proxyOptions,
    );

    if (response.status === 401) {
      return { plan: PLAN, message: "DeepRelay authentication failed. Check the API key." };
    }

    if (response.status === 403) {
      const body = await response.json().catch(() => null);
      // Keys are scope-limited; without `billing:read` the wallet is invisible
      // even though the key itself is perfectly usable for chat calls.
      return {
        plan: PLAN,
        message: readErrorCode(body) === "insufficient_scope"
          ? "DeepRelay key is missing the billing:read scope needed to read the wallet."
          : "DeepRelay access forbidden for this API key.",
      };
    }

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      return {
        plan: PLAN,
        message: `DeepRelay balance API error (${response.status})${errText ? `: ${errText.slice(0, 120)}` : ""}`,
      };
    }

    const balance = await response.json().catch(() => null);
    if (!balance || typeof balance !== "object") {
      return { plan: PLAN, message: "DeepRelay balance response was not JSON." };
    }

    const dollars = balance.balance_dollars !== undefined
      ? toFiniteNumber(balance.balance_dollars, 0)
      : centsToUsd(balance.balance_cents);

    // `used`/`total` are inverted relative to a usage bar: the wallet is money
    // still available, so it drains from 100% towards 0% as credits are spent.
    const quotas = {
      "Balance ($)": {
        used: 0,
        total: Math.max(0, Math.round(dollars * 100) / 100),
        remainingPercentage: dollars > 0 ? 100 : 0,
        resetAt: null,
        unlimited: false,
        unit: "USD",
      },
    };

    // Burn rate only means something when the account actually reports one;
    // 0 would render as a permanent "0 used · Unlimited" row.
    const burnPerHour = centsToUsd(balance.burn_cents_per_hour);
    if (burnPerHour > 0) {
      quotas["Burn rate ($/h)"] = {
        used: burnPerHour,
        total: 0,
        remainingPercentage: 100,
        resetAt: null,
        unlimited: true,
        unit: "USD",
      };
    }

    const spend = await fetchUsageSpend(apiKey.trim(), proxyOptions);
    if (spend) quotas["Spend (30d)"] = spend;

    return { plan: PLAN, quotas };
  } catch (error) {
    return { message: `DeepRelay error: ${error.message}` };
  }
}
