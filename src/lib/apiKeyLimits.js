// Per-API-key limits. Called by every /v1 handler right after API key validation.
//
// - RPM is an in-memory sliding window (single process), so it is exact.
// - Token/request/cost limits are computed from usageHistory, which is written
//   AFTER a response completes. A request that starts while under the limit is
//   allowed to finish, so these limits can overshoot by in-flight requests.
// - Day/month boundaries follow server local time, same as usageDaily.
import { getApiKeyByKey, getApiKeyUsageTotals, statsEmitter } from "@/lib/db/index.js";
import { errorResponse } from "open-sse/utils/error.js";

const RPM_WINDOW_MS = 60 * 1000;
const KEY_CACHE_TTL_MS = 5 * 1000;
const USAGE_CACHE_TTL_MS = 10 * 1000;
const HTTP_TOO_MANY_REQUESTS = 429;

const METRICS = {
  tokens: { label: "tokens", read: (u) => u.inputTokens + u.outputTokens },
  inputTokens: { label: "input tokens", read: (u) => u.inputTokens },
  outputTokens: { label: "output tokens", read: (u) => u.outputTokens },
  requests: { label: "requests", read: (u) => u.requests },
  cost: { label: "budget", read: (u) => u.cost, money: true },
};

// Usage-based limits, checked in this order. `field` is the apiKeys column.
// `always` = shown on the dashboard even without a limit set.
export const USAGE_LIMITS = [
  { field: "dailyTokenLimit", period: "day", metric: "tokens", label: "Tokens today", always: true },
  { field: "dailyInputTokenLimit", period: "day", metric: "inputTokens", label: "Input tokens today" },
  { field: "dailyOutputTokenLimit", period: "day", metric: "outputTokens", label: "Output tokens today" },
  { field: "monthlyTokenLimit", period: "month", metric: "tokens", label: "Tokens this month" },
  { field: "monthlyInputTokenLimit", period: "month", metric: "inputTokens", label: "Input tokens this month" },
  { field: "monthlyOutputTokenLimit", period: "month", metric: "outputTokens", label: "Output tokens this month" },
  { field: "monthlyRequestLimit", period: "month", metric: "requests", label: "Requests this month" },
  { field: "monthlyBudget", period: "month", metric: "cost", label: "Cost this month", always: true },
];

const PERIOD_TEXT = { day: "daily", month: "monthly" };
const RESET_TEXT = { day: "Resets at local midnight.", month: "Resets on the 1st of next month." };

// Shared across Next.js module instances (same pattern as usageRepo)
if (!global._apiKeyLimitState) {
  global._apiKeyLimitState = { keys: new Map(), usage: new Map(), hits: new Map(), listening: false };
}
const state = global._apiKeyLimitState;

if (!state.listening) {
  statsEmitter.on("apiKeyUsage", (apiKey) => state.usage.delete(apiKey));
  state.listening = true;
}

export function invalidateApiKeyLimitCache(apiKey) {
  if (apiKey) state.keys.delete(apiKey);
  else state.keys.clear();
}

function periodBounds(now = new Date()) {
  return {
    day: new Date(now.getFullYear(), now.getMonth(), now.getDate()),
    nextDay: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1),
    month: new Date(now.getFullYear(), now.getMonth(), 1),
    nextMonth: new Date(now.getFullYear(), now.getMonth() + 1, 1),
  };
}

const resetOf = (period, bounds) => (period === "day" ? bounds.nextDay : bounds.nextMonth);

async function getKeyRecord(apiKey) {
  const cached = state.keys.get(apiKey);
  if (cached && Date.now() - cached.ts < KEY_CACHE_TTL_MS) return cached.record;
  const record = await getApiKeyByKey(apiKey);
  state.keys.set(apiKey, { record, ts: Date.now() });
  return record;
}

async function getUsage(apiKey, bounds) {
  const dayKey = bounds.day.toISOString();
  const cached = state.usage.get(apiKey);
  if (cached && cached.dayKey === dayKey && Date.now() - cached.ts < USAGE_CACHE_TTL_MS) return cached.totals;
  const totals = await getApiKeyUsageTotals(apiKey, dayKey, bounds.month.toISOString());
  state.usage.set(apiKey, { totals, dayKey, ts: Date.now() });
  return totals;
}

function recentHits(apiKey, now = Date.now()) {
  const hits = (state.hits.get(apiKey) || []).filter((t) => now - t < RPM_WINDOW_MS);
  if (hits.length) state.hits.set(apiKey, hits);
  else state.hits.delete(apiKey);
  return hits;
}

function secondsUntil(date) {
  return Math.max(1, Math.ceil((date.getTime() - Date.now()) / 1000));
}

function formatValue(value, money) {
  return money ? `$${value.toFixed(2)}` : Math.round(value).toLocaleString("en-US");
}

/**
 * Check limits for an API key and count the request toward its RPM window.
 * @returns {Promise<null | { message: string, retryAfter: number }>} null when allowed
 */
export async function checkApiKeyLimits(apiKey) {
  if (!apiKey) return null;
  try {
    const record = await getKeyRecord(apiKey);
    if (!record) return null;

    const bounds = periodBounds();
    const active = USAGE_LIMITS.filter((def) => record[def.field]);
    if (active.length) {
      const usage = await getUsage(apiKey, bounds);
      for (const def of active) {
        const metric = METRICS[def.metric];
        const used = metric.read(usage[def.period]);
        const limit = record[def.field];
        if (used >= limit) {
          return {
            message: `API key ${PERIOD_TEXT[def.period]} ${metric.label} limit reached (${formatValue(used, metric.money)}/${formatValue(limit, metric.money)}). ${RESET_TEXT[def.period]}`,
            retryAfter: secondsUntil(resetOf(def.period, bounds)),
          };
        }
      }
    }

    const now = Date.now();
    const hits = recentHits(apiKey, now);
    if (record.rpmLimit && hits.length >= record.rpmLimit) {
      return {
        message: `API key rate limit exceeded (${record.rpmLimit} requests/minute).`,
        retryAfter: Math.max(1, Math.ceil((hits[0] + RPM_WINDOW_MS - now) / 1000)),
      };
    }
    hits.push(now);
    state.hits.set(apiKey, hits);
    return null;
  } catch (error) {
    // Fail-open: a limits bug must never take the gateway down
    console.warn("[apiKeyLimits] check failed:", error?.message);
    return null;
  }
}

/**
 * Handler helper: returns a 429 Response when a limit is hit, otherwise null.
 */
export async function enforceApiKeyLimits(apiKey) {
  const limited = await checkApiKeyLimits(apiKey);
  if (!limited) return null;
  const res = errorResponse(HTTP_TOO_MANY_REQUESTS, limited.message);
  res.headers.set("Retry-After", String(limited.retryAfter));
  return res;
}

/**
 * Current usage vs limits for the dashboard.
 */
export async function getApiKeyLimitStatus(record) {
  const bounds = periodBounds();
  const usage = await getApiKeyUsageTotals(record?.key, bounds.day.toISOString(), bounds.month.toISOString());
  return {
    rpm: { used: record?.key ? recentHits(record.key).length : 0, limit: record?.rpmLimit ?? null },
    limits: USAGE_LIMITS.map((def) => ({
      field: def.field,
      label: def.label,
      money: !!METRICS[def.metric].money,
      always: !!def.always,
      used: METRICS[def.metric].read(usage[def.period]),
      limit: record?.[def.field] ?? null,
      resetAt: resetOf(def.period, bounds).toISOString(),
    })),
    today: usage.day,
    month: usage.month,
  };
}
