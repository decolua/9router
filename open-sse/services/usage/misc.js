/**
 * Misc usage handlers (iFlow, Ollama, GLM, Vercel AI Gateway, Qoder)
 */

import { proxyAwareFetch } from "../../utils/proxyFetch.js";
import { U } from "./shared.js";

export { getGlmUsage } from "./glm.js";


// Vercel AI Gateway credits endpoint
// Returns { balance: "95.50", total_used: "4.50" } (USD as decimal strings).
const VERCEL_AI_GATEWAY_CREDITS_URL = U("vercel-ai-gateway").url;

/**
 * iFlow Usage
 */
export async function getIflowUsage(accessToken) {
  try {
    // iFlow may have usage endpoint
    return { message: "iFlow connected. Usage tracked per request." };
  } catch (error) {
    return { message: "Unable to fetch iFlow usage." };
  }
}

const OLLAMA_LEGACY_WINDOWS = {
  session: "Session (5h)",
  weekly: "Weekly (7d)",
};

/**
 * Ollama Cloud Usage
 * GET https://ollama.com/api/balance — credit-model usage for every plan,
 *   Free included (effective 2026-08-31 pricing redesign). Returns
 *   `included.{balance_usd,allowance_usd,period}` (the plan's monthly
 *   credit pool, remaining balance, and a real reset timestamp) and an
 *   optional `purchased.balance_usd` (unexpired pay-as-you-go top-up).
 *   GET /api/usage (the endpoint this used to call) was repurposed on
 *   2026-10-10 into pure spend-history and no longer reports limits — see
 *   docs.ollama.com/api/balance + docs.ollama.com/api/cloud-usage. A
 *   pre-migration account can still report the legacy
 *   `included.session/weekly.{remaining_percent,resets_at}` shape;
 *   both are handled below.
 * POST https://ollama.com/api/me — plan label (fail-open).
 * Auth: Authorization: Bearer <apiKey>
 */
const OLLAMA_ME_URL = "https://ollama.com/api/me";
const OLLAMA_BALANCE_URL = "https://ollama.com/api/balance";

export async function getOllamaUsage(apiKey, providerSpecificData, proxyOptions = null) {
  if (!apiKey) {
    return { message: "Ollama Cloud API key not available." };
  }

  try {
    const response = await proxyAwareFetch(OLLAMA_BALANCE_URL, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    }, proxyOptions);

    if (response?.status === 401 || response?.status === 403) {
      return { message: "Ollama Cloud API key invalid or expired." };
    }

    if (response && !response.ok) {
      return { message: `Ollama Cloud usage API error (${response.status}).` };
    }

    let data;
    try {
      data = response ? await response.json() : null;
    } catch {
      return { message: "Ollama Cloud usage response was not JSON." };
    }

    // Best-effort plan label from /api/me
    const me = await proxyAwareFetch(OLLAMA_ME_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
        "Content-Length": "0",
      },
    }, proxyOptions).then((r) => (r && r.ok ? r.json() : null)).catch(() => null);

    const planRaw = typeof me?.Plan === "string" ? me.Plan : "";
    const plan = planRaw
      ? planRaw.charAt(0).toUpperCase() + planRaw.slice(1).toLowerCase()
      : "Ollama Cloud";

    const quotas = {};
    const included = data?.included && typeof data.included === "object" ? data.included : null;

    if (included) {
      const allowance = Number(included.allowance_usd);
      const balance = Number(included.balance_usd);
      if (Number.isFinite(allowance) && allowance > 0 && Number.isFinite(balance)) {
        const used = Math.max(0, allowance - balance);
        quotas.Monthly = {
          used: Math.round(used * 100) / 100,
          total: allowance,
          remainingPercentage: Math.max(0, Math.min(100, Math.round((balance / allowance) * 10000) / 100)),
          resetAt: included.period?.until || null,
          unlimited: false,
        };
      } else {
        // Legacy pre-credit-model shape, still seen on un-migrated accounts.
        for (const [key, label] of Object.entries(OLLAMA_LEGACY_WINDOWS)) {
          const window = included[key];
          const remainingPct = Number(window?.remaining_percent);
          if (!window || !Number.isFinite(remainingPct)) continue;
          quotas[label] = {
            used: Math.round((100 - remainingPct) * 100) / 100,
            total: 100,
            remainingPercentage: Math.max(0, Math.min(100, remainingPct)),
            resetAt: window.resets_at || null,
            unlimited: false,
          };
        }
      }
    }

    // Unexpired pay-as-you-go top-up — a separate pool with no reset cycle,
    // rendered as a credit balance (💰) rather than a used/total bar.
    const purchasedBalance = Number(data?.purchased?.balance_usd);
    if (Number.isFinite(purchasedBalance) && purchasedBalance > 0) {
      quotas["Purchased credit"] = {
        used: 0,
        total: purchasedBalance,
        isCreditBalance: true,
        currency: "USD",
        resetAt: null,
        unlimited: false,
      };
    }

    if (Object.keys(quotas).length === 0) {
      return {
        plan,
        message: "Ollama Cloud connected. No usage limits reported.",
        quotas: {},
      };
    }

    return { plan, quotas };
  } catch (error) {
    return { message: `Ollama Cloud error: ${error.message}` };
  }
}

/**
 * Vercel AI Gateway usage — credit balance for the API key
 *
 * Calls GET /v1/credits which returns:
 *   { "balance": "95.50", "total_used": "4.50" }   (USD as decimal strings)
 *
 * We surface this as a single "Balance ($)" quota row so the existing
 * QuotaTable / progress-bar UI can render it. used = total_used,
 * total = balance + total_used (the original credit allotment), so the
 * remaining percentage equals balance / total.
 *
 * Docs: https://vercel.com/docs/ai-gateway/usage
 */
export async function getVercelAiGatewayUsage(apiKey, proxyOptions = null) {
  if (!apiKey) {
    return { message: "Vercel AI Gateway API key not available." };
  }

  try {
    const response = await proxyAwareFetch(VERCEL_AI_GATEWAY_CREDITS_URL, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    }, proxyOptions);

    if (response.status === 401 || response.status === 403) {
      return { message: "Vercel AI Gateway API key invalid or expired." };
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      const trimmed = errorText ? `: ${errorText.slice(0, 200)}` : "";
      return { message: `Vercel AI Gateway credits API error (${response.status})${trimmed}` };
    }

    const data = await response.json();

    // Vercel returns numeric strings; coerce safely.
    const balance = Number(data?.balance) || 0;
    const totalUsed = Number(data?.total_used) || 0;

    // Vercel gives $5/month free credit. The API doesn't return the
    // monthly allocation so we use the known constant as the denominator.
    const MONTHLY_CREDIT = 5;
    const remainingPercentage = (balance / MONTHLY_CREDIT) * 100;

    if (balance <= 0 && totalUsed <= 0) {
      return {
        plan: "Pay-as-you-go",
        message: "Vercel AI Gateway connected. No credit allocation found (BYOK or unfunded account).",
        quotas: {},
      };
    }

    // "Used (USD)": how much has been spent this month (no fixed cap → unlimited).
    // "Remaining (USD)": balance remaining out of the $5 monthly allocation.
    return {
      plan: "Pay-as-you-go",
      quotas: {
        "Used (USD)": {
          used: totalUsed,
          total: 0,
          remaining: 0,
          remainingPercentage: 100,
          unlimited: true,
        },
        "Remaining (USD)": {
          used: balance,
          total: MONTHLY_CREDIT,
          remaining: balance,
          remainingPercentage,
          unlimited: false,
        },
      },
    };
  } catch (error) {
    return { message: `Vercel AI Gateway error: ${error.message}` };
  }
}

export async function getQoderUsage(accessToken, proxyOptions = null, providerId = "qoder") {
  if (!accessToken) {
    return { message: "Qoder usage unavailable: no access token" };
  }
  try {
    const response = await proxyAwareFetch(
      U(providerId).url,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
      },
      proxyOptions,
    );
    if (!response.ok) {
      return { message: `Qoder connected. Usage fetch returned ${response.status}.` };
    }
    const body = await response.json().catch(() => null);
    if (!body) {
      return { message: "Qoder connected. Usage response was not JSON." };
    }
    // Quota records live under `quotas`; scalar metadata
    // (totalUsagePercentage, isQuotaExceeded, expiresAt) are surfaced as
    // siblings so the dashboard parser doesn't try to render them as rows.
    const userQuota = body.userQuota || {};
    const orgQuota = body.orgResourcePackage || {};
    // Add-on credits (free grants / promos). Qoder emits this block only when
    // the account actually holds a grant — an account that never redeemed one,
    // or consumed it, omits the key entirely. Verified against both regions:
    // qoder CN returns it (e.g. 2200 total) after redeeming the free-credit
    // promo, while an intl account without a grant has no such key. Gating on
    // total > 0 keeps the intl/no-grant shape byte-identical to before.
    const addOnQuota = body.addOnQuota || {};
    const addOnTotal = Number(addOnQuota.total) || 0;
    // Qoder publishes a single absolute reset timestamp (`expiresAt` in ms);
    // surface it on every quota record as ISO so the table can render
    // "resets at" alongside used/total. 253402214400000 (9999-12-31T00:00:00Z)
    // is Qoder's "never expires" sentinel, returned by both regions for
    // open-ended plans — rendering a reset date in the year 9999 is noise, so
    // flag it instead and let the tracker word it as "Never expires".
    const expiresAtMs = Number.isFinite(Number(body.expiresAt)) && Number(body.expiresAt) > 0
      ? Number(body.expiresAt)
      : null;
    const NO_RESET_SENTINEL_MS = 253402214400000;
    const neverExpires = expiresAtMs === NO_RESET_SENTINEL_MS;
    const resetAt = expiresAtMs && !neverExpires ? new Date(expiresAtMs).toISOString() : null;
    const quotas = {
      user: {
        total: Number(userQuota.total) || 0,
        used: Number(userQuota.used) || 0,
        remaining: Number(userQuota.remaining) || 0,
        unit: userQuota.unit || "credits",
        resetAt,
        neverExpires,
      },
      organization: {
        total: Number(orgQuota.total) || 0,
        used: Number(orgQuota.used) || 0,
        remaining: Number(orgQuota.remaining) || 0,
        unit: orgQuota.unit || "credits",
        resetAt,
        neverExpires,
      },
    };
    if (addOnTotal > 0) {
      quotas.addOn = {
        total: addOnTotal,
        used: Number(addOnQuota.used) || 0,
        remaining: Number(addOnQuota.remaining) || 0,
        unit: addOnQuota.unit || "credits",
        // The add-on block carries no expiry of its own in this API. Qoder's
        // web console lists every redeemed resource package with its own
        // deadline (check-in bonuses do expire, typically ~30 days), but
        // openapi only exposes the account-level `expiresAt` sentinel above,
        // which describes the plan, not the grants — reusing it here would
        // advertise "never expires" for credits that actually expire. So
        // leave the reset date unset and let the row link to Qoder's own
        // usage page (detailUrl) where the per-package dates live.
        resetAt: null,
        neverExpires: false,
        detailUrl: addOnQuota.detailUrl || null,
      };
    }
    return {
      quotas,
      totalUsagePercentage: Number(body.totalUsagePercentage) || 0,
      isQuotaExceeded: !!body.isQuotaExceeded,
      expiresAt: expiresAtMs,
    };
  } catch (error) {
    return { message: `Qoder connected. Unable to fetch usage: ${error.message}` };
  }
}
