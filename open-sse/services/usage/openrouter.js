/**
 * OpenRouter usage — account balance plus per-key spend and budgets.
 *   GET https://openrouter.ai/api/v1/credits → { data: { total_credits, total_usage } }
 *   GET https://openrouter.ai/api/v1/key     → { data: { usage_daily, usage_weekly, usage_monthly, limit, limit_remaining, budgets[] } }
 * Both accept a normal inference key (Bearer).
 */

import { proxyAwareFetch } from "../../utils/proxyFetch.js";
import { toFiniteNumber } from "./shared.js";

const CREDITS_URL = "https://openrouter.ai/api/v1/credits";
const KEY_URL = "https://openrouter.ai/api/v1/key";

const usd = (n) => Math.round(n * 100) / 100;

async function getJson(url, apiKey, proxyOptions) {
  const res = await proxyAwareFetch(
    url,
    { method: "GET", headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" } },
    proxyOptions,
  );
  if (res.status === 401 || res.status === 403) throw Object.assign(new Error("auth"), { auth: true });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json().catch(() => null);
  return body?.data && typeof body.data === "object" ? body.data : null;
}

export async function getOpenRouterUsage(apiKey = null, proxyOptions = null) {
  if (!apiKey || typeof apiKey !== "string" || !apiKey.trim()) {
    return { message: "OpenRouter API key not available. Add a key to view usage." };
  }
  const key = apiKey.trim();

  const [credits, keyInfo] = await Promise.allSettled([
    getJson(CREDITS_URL, key, proxyOptions),
    getJson(KEY_URL, key, proxyOptions),
  ]);
  if ([credits, keyInfo].every((r) => r.status === "rejected")) {
    const err = credits.reason;
    return err?.auth
      ? { plan: "OpenRouter", message: "OpenRouter authentication failed. Check the API key." }
      : { plan: "OpenRouter", message: `OpenRouter usage API error: ${err?.message}` };
  }

  const quotas = {};
  const c = credits.status === "fulfilled" ? credits.value : null;
  if (c) {
    const balance = toFiniteNumber(c.total_credits, 0) - toFiniteNumber(c.total_usage, 0);
    quotas["Balance (USD)"] = {
      used: 0, total: usd(Math.max(0, balance)), resetAt: null,
      remainingPercentage: balance > 0 ? 100 : 0, isCreditBalance: true, currency: "USD",
    };
  }

  const k = keyInfo.status === "fulfilled" ? keyInfo.value : null;
  if (k) {
    // Key-level hard limit (set on the key itself).
    const limit = toFiniteNumber(k.limit, 0);
    if (limit > 0) {
      quotas["Key limit (USD)"] = {
        used: usd(limit - toFiniteNumber(k.limit_remaining, 0)), total: limit,
        resetAt: null, unit: "USD",
      };
    }
    // Workspace guardrail budgets: keep the tightest one per reset interval.
    const budgets = Array.isArray(k.budgets) ? k.budgets : [];
    const tightest = {};
    for (const b of budgets) {
      const cap = toFiniteNumber(b?.limit_usd, 0);
      if (cap <= 0) continue;
      const left = toFiniteNumber(b.remaining_usd, cap);
      const slot = b.reset_interval || "total";
      if (!tightest[slot] || left < tightest[slot].left) tightest[slot] = { cap, left, resetAt: b.resets_at || null };
    }
    for (const [slot, b] of Object.entries(tightest)) {
      const label = slot[0].toUpperCase() + slot.slice(1);
      quotas[`${label} budget (USD)`] = { used: usd(b.cap - b.left), total: b.cap, resetAt: b.resetAt, unit: "USD" };
    }
    // Spend counters (no cap) — shown as "X used · Unlimited".
    for (const [label, field] of [["Spent today", "usage_daily"], ["Spent this week", "usage_weekly"], ["Spent this month", "usage_monthly"]]) {
      quotas[`${label} (USD)`] = { used: usd(toFiniteNumber(k[field], 0)), total: 0, resetAt: null, unlimited: true };
    }
  }

  return {
    plan: k?.is_free_tier ? "OpenRouter (Free tier)" : "OpenRouter",
    quotas,
  };
}
