import { proxyAwareFetch } from "../../utils/proxyFetch.js";
import { U } from "./shared.js";

export async function getOpenRouterUsage(apiKey, proxyOptions = null) {
  if (typeof apiKey !== "string" || !apiKey.trim()) return { message: "OpenRouter API key not available." };
  try {
    const response = await proxyAwareFetch(U("openrouter").url, {
      headers: { Authorization: `Bearer ${apiKey.trim()}`, Accept: "application/json" },
    }, proxyOptions);
    if (!response.ok) return { message: `OpenRouter usage API error (${response.status}).` };
    const { data } = await response.json();
    const quotas = {};
    const valid = (n) => typeof n === "number" && Number.isFinite(n) && n >= 0;
    // ponytail: account credits need a management key; retain other quotas when access is denied.
    try {
      const creditsResponse = await proxyAwareFetch(U("openrouter").creditsUrl, {
        headers: { Authorization: `Bearer ${apiKey.trim()}`, Accept: "application/json" },
      }, proxyOptions);
      const credits = creditsResponse.ok ? (await creditsResponse.json())?.data : null;
      if (valid(credits?.total_credits) && valid(credits?.total_usage)) {
        quotas["Account credit balance"] = { used: 0, total: credits.total_credits - credits.total_usage, isCreditBalance: true, currency: "USD" };
      } else {
        quotas["Account credit balance"] = { unavailable: true, emptyMessage: creditsResponse.status === 403 ? "Requires management key" : "Unavailable" };
      }
    } catch {
      quotas["Account credit balance"] = { unavailable: true, emptyMessage: "Unavailable" };
    }
    const budgets = Array.isArray(data?.budgets) && data.budgets.length ? data.budgets : data?.effective_budget ? [data.effective_budget] : [];
    for (const [index, budget] of budgets.entries()) {
      if (!budget || !valid(budget.limit_usd) || !valid(budget.spend_usd)) continue;
      quotas[`Budget ${index + 1} (${budget.scope || "unknown"})`] = {
        used: budget.spend_usd, total: budget.limit_usd, unit: "USD", resetAt: budget.resets_at,
        emptyMessage: budget.reset_interval ? `Resets ${budget.reset_interval}` : "Never resets",
      };
    }
    if (valid(data?.limit) && typeof data?.limit_remaining === "number" && Number.isFinite(data.limit_remaining) && !budgets.some((budget) => budget?.scope === "key_limit")) {
      quotas["Key spending limit"] = {
        used: Math.max(0, data.limit - data.limit_remaining), total: data.limit, unit: "USD",
        emptyMessage: data.limit_reset ? `Resets ${data.limit_reset}` : "Never resets",
      };
    }
    const daily = data?.free_model_daily_requests;
    if (daily && valid(daily.used) && valid(daily.limit)) {
      quotas["Free models daily (tier policy)"] = {
        used: daily.used, total: daily.limit, unit: "requests",
        resetAt: new Date(Math.floor(Date.now() / 86400000) * 86400000 + 86400000).toISOString(),
      };
    }
    return Object.keys(quotas).length ? { plan: "OpenRouter", quotas } : { message: "OpenRouter response did not contain limit data." };
  } catch {
    return { message: "Unable to fetch OpenRouter limits." };
  }
}