/**
 * Token Harbor usage — Pass + free-model allowance for the key's account.
 *
 *   GET https://tokenharbor.ai/api/cli/free-tier   (Bearer <apiKey>, read-only, free)
 *   Docs: https://tokenharbor.ai/docs/api/allowance
 *
 * Returns percentages only (no dollar amounts), shared 7-day window.
 * ponytail: wallet balance not exposed by any key-auth endpoint; add a row when Token Harbor ships one.
 */

import { fetchWithTimeout, parseResetTime, toFiniteNumber } from "./shared.js";

const URL = "https://tokenharbor.ai/api/cli/free-tier";
const PLAN = "Token Harbor";

function pctRow(usedPct, exhausted, resetAt) {
  const used = exhausted ? 100 : Math.min(100, Math.max(0, toFiniteNumber(usedPct, 0)));
  return { used, total: 100, remainingPercentage: 100 - used, resetAt, unlimited: false, unit: "%" };
}

export async function getTokenHarborUsage(apiKey, proxyOptions = null) {
  if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
    return { message: "Token Harbor API key not available. Add a key to view usage." };
  }
  try {
    const res = await fetchWithTimeout(
      URL,
      { method: "GET", headers: { Authorization: `Bearer ${apiKey.trim()}`, Accept: "application/json" } },
      10000,
      proxyOptions,
    );
    if (res.status === 401) return { plan: PLAN, message: "Token Harbor authentication failed. Check the API key." };
    if (res.status === 403) return { plan: PLAN, message: "Token Harbor account email not verified." };
    if (!res.ok) return { plan: PLAN, message: `Token Harbor allowance API error (${res.status})` };

    const a = await res.json().catch(() => null);
    if (!a || typeof a !== "object") return { plan: PLAN, message: "Token Harbor response was not JSON." };

    const resetAt = parseResetTime(a.reset_at);
    const quotas = {};
    if (a.on_plan) quotas[`${a.plan_name || "Pass"} weekly allowance`] = pctRow(a.plan_used_pct, a.plan_exhausted, resetAt);
    if (a.models_enabled !== false) quotas["Free model allowance"] = pctRow(a.used_pct, a.exhausted, resetAt);

    return { plan: a.plan_name || "Pay-as-you-go", quotas };
  } catch (error) {
    return { message: `Token Harbor error: ${error.message}` };
  }
}
