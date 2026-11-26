// Per-API-key spend limit: enforcement (HTTP 429 at the cap) and the status the
// dashboard shows. Called by the gates in keyAccess.js AFTER the allowlist
// passes, so a limit can only ever add a refusal. Dependencies are injectable
// for tests; the defaults load the DB lazily.
import { windowStart, windowReset } from "@/shared/utils/keyLimit.js";
import { unpricedModels } from "@/shared/utils/keyPricing.js";
import { KEY_SPEND_CACHE_TTL_MS, keyLimitReachedMessage } from "@/shared/constants/keyAccess.js";
import { errorResponse } from "open-sse/utils/error.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import * as log from "../utils/logger.js";
import { recordKeyLimitRefused } from "@/lib/observability/metrics.js";

const spendCache = new Map(); // `${keyValue}|${windowStartIso}` -> { at, usd }

/** Test hook. */
export function resetSpendCache() {
  spendCache.clear();
}

export function defaultDeps() {
  return {
    getSpend: async (keyValue, sinceIso) => (await import("@/lib/db/repos/usageRepo.js")).getKeySpendSince(keyValue, sinceIso),
    getCombos: async () => (await import("@/lib/db/repos/combosRepo.js")).getCombos(),
    resolveModel: async (entry) => (await import("./model.js")).getModelInfo(entry),
    getPricing: async (provider, model) => (await import("@/lib/db/repos/pricingRepo.js")).getPricingForModel(provider, model),
  };
}

async function cachedSpend(deps, keyValue, startIso, nowMs) {
  const cacheKey = `${keyValue}|${startIso}`;
  const hit = spendCache.get(cacheKey);
  if (hit && nowMs - hit.at < KEY_SPEND_CACHE_TTL_MS) return hit.usd;
  const usd = await deps.getSpend(keyValue, startIso);
  spendCache.set(cacheKey, { at: nowMs, usd });
  return usd;
}

// How log lines name a key: its name, else its id (never the key value).
function keyLabel(entry) {
  return entry.name || entry.id || "unnamed key";
}

function limitReachedResponse(ctx, entry, resetsAt, spent) {
  const message = keyLimitReachedMessage(entry.limit, resetsAt.toISOString());
  const retryAfter = String(Math.max(1, Math.ceil((resetsAt.getTime() - Date.now()) / 1000)));
  // One line per refusal, greppable by "key-spend-limit" or "REFUSED 429". A refused call never
  // reaches the router, so it has no request line or usage row: this line is its only trace.
  // entry.name is the record's own name (possibly empty): the counter normalises it like the
  // request counters and the gauge do ("unknown-key" when empty); the log falls back to the id.
  recordKeyLimitRefused({ keyName: entry.name, window: entry.limit.window });
  log.warn("AUTH", `key-spend-limit: REFUSED 429 · key "${keyLabel(entry)}" · spent $${Number(spent).toFixed(4)} of $${entry.limit.usd} per ${entry.limit.window} · resets ${resetsAt.toISOString()} · ${ctx.endpoint || "unknown endpoint"}`);
  if (ctx.endpoint?.includes("/v1/messages")) {
    return new Response(
      JSON.stringify({ type: "error", error: { type: "rate_limit_error", message } }),
      { status: HTTP_STATUS.RATE_LIMITED, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Retry-After": retryAfter } }
    );
  }
  return errorResponse(HTTP_STATUS.RATE_LIMITED, message, { "Retry-After": retryAfter });
}

/**
 * @param {{ limits?: {keyValue: string, id?: string, name?: string, access: object, limit: {usd: number, window: string}}[], endpoint?: string }} ctx
 * @returns {Promise<Response|null>} a 429 Response, or null when the request may proceed.
 * Fails OPEN: a broken meter must not take the gateway down.
 */
export async function checkSpendLimit(ctx, deps = defaultDeps(), now = new Date()) {
  for (const entry of ctx?.limits || []) {
    try {
      const priced = await unpricedModels(entry.access, deps);
      if (!priced.eligible) continue; // limit disabled, not enforced
      const start = windowStart(entry.limit.window, now);
      const spent = await cachedSpend(deps, entry.keyValue, start.toISOString(), now.getTime());
      if (spent >= entry.limit.usd) return limitReachedResponse(ctx, entry, windowReset(entry.limit.window, now), spent);
    } catch (error) {
      log.warn("AUTH", `key-spend-limit: could not check key "${keyLabel(entry)}" (${error?.message}); allowing`);
    }
  }
  return null;
}

/**
 * Status for the dashboard and the API. `key` = { access, limit, key }.
 * @returns {Promise<{eligible: boolean, unbounded: boolean, unpriced: string[], effective: boolean, spentUsd: number|null, resetsAt: string|null}>}
 */
export async function getLimitStatus(key, deps = defaultDeps(), now = new Date()) {
  const priced = await unpricedModels(key.access, deps);
  const effective = Boolean(key.limit) && priced.eligible;
  let spentUsd = null;
  let resetsAt = null;
  if (key.limit) {
    const start = windowStart(key.limit.window, now);
    spentUsd = await cachedSpend(deps, key.key, start.toISOString(), now.getTime());
    resetsAt = windowReset(key.limit.window, now).toISOString();
  }
  return { ...priced, effective, spentUsd, resetsAt };
}

/**
 * Share of its limit each limited key has used in its current window, for the
 * ninerouter.key.limit.used_ratio gauge. Uses the same spend query
 * (getKeySpendSince), window start and limit as checkSpendLimit, so the ratio
 * is the number enforcement compares. It does NOT necessarily share the spend
 * cache: Next.js may load this module in several bundles, each with its own
 * cache, so the gauge and enforcement may each be up to the cache TTL (5 s)
 * stale, independently.
 *
 * Every ACTIVE key with a limit (limit.usd > 0) counts, whether or not the limit
 * is enforced. A ratio >= 1 only means requests are refused for keys the limit
 * is enforced on (restricted keys whose reachable models are all priced, see
 * checkSpendLimit); for any other limited key it is spend/limit, nothing more.
 * Inactive keys and keys without a limit are skipped. A failed spend read skips
 * only that key (the gauge then reports it NaN once) and is passed to `onError`
 * (never thrown), so one bad read does not drop the other keys' points.
 * `keys` are apiKeys rows ({ key, name, isActive, limit }).
 * @returns {Promise<{name: string, window: string, ratio: number}[]>}
 */
export async function keyLimitUsage(keys, deps = defaultDeps(), now = new Date(), onError = () => {}) {
  const rows = [];
  for (const key of keys || []) {
    if (key?.isActive === false) continue;
    const usd = Number(key?.limit?.usd);
    if (!Number.isFinite(usd) || usd <= 0) continue;
    try {
      const start = windowStart(key.limit.window, now);
      const spent = await cachedSpend(deps, key.key, start.toISOString(), now.getTime());
      rows.push({ name: key.name, window: key.limit.window, ratio: Number(spent) / usd });
    } catch (error) {
      try { onError(error); } catch { /* reporting must not break the gauge */ }
    }
  }
  return rows;
}
