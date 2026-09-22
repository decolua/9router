/**
 * Antigravity live quota cache — in-memory, refreshed on demand.
 * Used by auth.js pre-filter to skip accounts with exhausted model quota.
 * Also triggered by 409/429 error handler to sync exact resetAt from upstream.
 */

import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";
import { getAntigravityUsage } from "open-sse/services/usage/google.js";
import { getAntigravityQuotaPool, findPoolBlockForModel, synthesizePoolBlock } from "./antigravityQuotaPools.js";
import * as log from "../utils/logger.js";

// In-memory cache: connectionId → { [modelId]: { remainingPercentage, resetAt } }
const quotaCache = new Map();
// Track last refresh per connection to avoid hammering
const lastRefreshAt = new Map();
// In-flight refresh promises — dedup concurrent 409/429 bursts
const inflightRefresh = new Map();

const MIN_REFRESH_INTERVAL_MS = 30_000; // 30s between refreshes per connection

// Strike-based circuit breaker (#3681): Google's quota API can report remaining
// quota while generation endpoints keep returning 429 (sprint/weekly dual-pool
// mismatch). After STRIKE_THRESHOLD 429s within the window for the same
// connection+model, treat the optimistic quota reading as untrusted and
// cache-block that pair instead of retry-storming upstream.
const STRIKE_WINDOW_MS = 60_000; // strikes older than this reset the count
const STRIKE_THRESHOLD = 3;
const STRIKE_BLOCK_MS = 15 * 60_000;
const strikeCounts = new Map(); // "connectionId|model" → { count, windowStart (anchored at first strike) }
const strikeBlocks = new Map(); // "connectionId|model" → blockedUntil ms

/**
 * Re-apply active strike blocks onto a fresh quotas snapshot so the auth
 * pre-filter (which reads this cache) keeps skipping the blocked pair across
 * requests until the block expires — same channel as the exhausted-0% path.
 */
function applyActiveStrikeBlocks(connectionId, quotas) {
  const now = Date.now();
  for (const [key, until] of strikeBlocks) {
    if (!key.startsWith(`${connectionId}|`)) continue;
    if (until <= now) {
      strikeBlocks.delete(key);
      continue;
    }
    quotas[key.slice(connectionId.length + 1)] = {
      remainingPercentage: 0,
      resetAt: new Date(until).toISOString(),
    };
  }
  return quotas;
}

/**
 * Clear strike state for a connection|model after a successful request, so
 * "consecutive" strikes means consecutive. Only removes a synthesized cache
 * entry (resetAt == our block deadline); a real upstream 0% reading stays.
 */
export function clearAntigravityStrikes(connectionId, model) {
  const key = `${connectionId}|${model}`;
  strikeCounts.delete(key);
  const until = strikeBlocks.get(key);
  if (until === undefined) return;
  strikeBlocks.delete(key);
  const cached = quotaCache.get(connectionId);
  if (cached?.[model]?.resetAt === new Date(until).toISOString()) {
    delete cached[model];
    quotaCache.set(connectionId, cached);
  }
}

/**
 * Pool-aware block check for the auth pre-filter.
 *
 * Extends the exact-model cache check with a pool-level check: when every
 * metering entry of the model's quota pool (per-model entries + the pool's
 * weekly summary) reports 0% remaining with a future resetAt, the account is
 * exhausted for the WHOLE pool — skip it without another upstream probe.
 * Sibling models in the OTHER pool stay selectable (the 2-pool split is
 * exactly why a "quota exhausted" account can still serve other models).
 *
 * @param {object} quotas  cached quotas map for one connection
 * @param {string} model    requested model id
 * @returns {{ blocked: boolean, resetAt: string|null, reason: string|null }}
 */
export function isAntigravityPoolBlocked(quotas, model) {
  // Pool-level check first: when every meter of the model's pool reports 0%
  // with a future resetAt, the account is exhausted for the whole pool.
  // (Runs before the exact-model check so a pool-wide exhaustion is reported
  // as such even when the requested model's own entry also reads 0%.)
  const pool = findPoolBlockForModel(quotas, model);
  if (pool.blocked) {
    return { blocked: true, resetAt: pool.resetAt, reason: `pool:${getAntigravityQuotaPool(model)}` };
  }
  // Exact-model entry still carries a block of its own (e.g. 5h window).
  const exact = quotas?.[model];
  if (exact && Number(exact.remainingPercentage) <= 0 && exact.resetAt
      && Date.parse(exact.resetAt) > Date.now()) {
    return { blocked: true, resetAt: exact.resetAt, reason: `model:${model}` };
  }
  return { blocked: false, resetAt: null, reason: null };
}

/**
 * Get the quota cache (read-only reference for auth.js pre-filter).
 */
export function getAntigravityQuotaCache() {
  return quotaCache;
}

/**
 * Refresh quota for a single antigravity connection from upstream API.
 * Updates in-memory cache only. Cache expiry is the upstream model resetAt.
 * @returns {object|null} quotas map or null on failure
 */
export async function refreshAntigravityQuota(connectionId, accessToken, providerSpecificData) {
  const now = Date.now();
  // Coalesce concurrent refreshes before applying the interval gate.
  const inflight = inflightRefresh.get(connectionId);
  if (inflight) return inflight;

  const lastRefresh = lastRefreshAt.get(connectionId) || 0;
  if (now - lastRefresh < MIN_REFRESH_INTERVAL_MS) {
    log.debug("AG_QUOTA", `${connectionId.slice(0, 8)} | skip refresh (${Math.round((now - lastRefresh) / 1000)}s ago)`);
    return quotaCache.get(connectionId) || null;
  }

  // Record every attempt so failed quota calls cannot amplify an upstream 429 burst.
  lastRefreshAt.set(connectionId, now);
  const promise = _doRefresh(connectionId, accessToken, providerSpecificData, now);
  inflightRefresh.set(connectionId, promise);
  try {
    return await promise;
  } finally {
    inflightRefresh.delete(connectionId);
  }
}

/**
 * Ingest an externally-fetched Antigravity quota snapshot (e.g. from the
 * dashboard Quota Tracker / /api/usage) into the routing cache. This warms
 * the pool-aware pre-filter WITHOUT waiting for a first 429 per account —
 * the cache-block path then skips exhausted pools before any upstream probe.
 *
 * Applies the same pool-exhausted guard as _doRefresh so an exhausted pool
 * propagates to every sibling model in one shot. Never throws.
 */
export function ingestAntigravityQuotaSnapshot(connectionId, quotas) {
  if (!connectionId || !quotas || typeof quotas !== "object") return false;

  let next = quotas;
  for (const poolModel of ["gemini-3.8-flash-high", "claude-sonnet-4-6"]) {
    const probe = findPoolBlockForModel(next, poolModel);
    if (probe.blocked && probe.resetAt) {
      const before = Object.keys(next).length;
      next = synthesizePoolBlock(next, poolModel, probe.resetAt);
      if (Object.keys(next).length > before) {
        log.info("AG_QUOTA", `${connectionId.slice(0, 8)} | POOL_EXHAUSTED ${getAntigravityQuotaPool(poolModel)} (ingest) — block pool until ${probe.resetAt}`);
      }
    }
  }

  quotaCache.set(connectionId, applyActiveStrikeBlocks(connectionId, next));
  return true;
}

async function _doRefresh(connectionId, accessToken, providerSpecificData, now) {
  try {
    const proxyCfg = await resolveConnectionProxyConfig(providerSpecificData || {});
    const proxyOptions = {
      connectionProxyEnabled: proxyCfg.connectionProxyEnabled === true,
      connectionProxyUrl: proxyCfg.connectionProxyUrl || "",
      connectionNoProxy: proxyCfg.connectionNoProxy || "",
      vercelRelayUrl: proxyCfg.vercelRelayUrl || "",
      strictProxy: proxyCfg.strictProxy === true,
    };

    const usage = await getAntigravityUsage(accessToken, providerSpecificData, proxyOptions);
    // 401/403 usage responses can contain an empty quotas object plus message.
    // Preserve known cache instead of replacing it with an upstream error response.
    if (!usage?.quotas || usage.message) return null;

    let quotas = usage.quotas;

    // Pool-aware guard: if the refresh proves a pool is exhausted (weekly at
    // 0% with a future resetAt — the binding window for every tier),
    // propagate the block pool-wide right away so sibling models are skipped
    // without waiting for their own 429. One probe model per pool is enough:
    // the summary windows are pool-level, not model-level.
    for (const poolModel of ["gemini-3.8-flash-high", "claude-sonnet-4-6"]) {
      const probe = findPoolBlockForModel(quotas, poolModel);
      if (probe.blocked && probe.resetAt) {
        const before = Object.keys(quotas).length;
        quotas = synthesizePoolBlock(quotas, poolModel, probe.resetAt);
        if (Object.keys(quotas).length > before) {
          log.info("AG_QUOTA", `${connectionId.slice(0, 8)} | POOL_EXHAUSTED ${getAntigravityQuotaPool(poolModel)} — block pool until ${probe.resetAt}`);
        }
      }
    }

    // Update in-memory cache. Caller logs CACHE_BLOCK only if requested model is exhausted.
    // Strike blocks are re-asserted after every refresh so an optimistic
    // upstream reading cannot resurrect a pair we just circuit-broke.
    quotaCache.set(connectionId, applyActiveStrikeBlocks(connectionId, quotas));

    return usage.quotas;
  } catch (e) {
    log.warn("AG_QUOTA", `${connectionId.slice(0, 8)} | refresh failed: ${e.message}`);
    return null;
  }
}

/**
 * Handle Antigravity 409/429 — refresh RAM cache and return model resetAt when exhausted.
 * Called from chat handler error path.
 * @returns {number|null} resetAt timestamp ms (for resetsAtMs passthrough) or null
 */
export async function handleAntigravityQuotaError(connectionId, status, model, accessToken, providerSpecificData) {
  log.info("AG_QUOTA", `${connectionId.slice(0, 8)} | ${status} on ${model} — refreshing quota`);

  // Throttle applies to error paths too: one quota request per account/30s.
  // The first 409/429 populates cache; concurrent or repeated errors reuse it.
  const quotas = await refreshAntigravityQuota(connectionId, accessToken, providerSpecificData);
  const quota = quotas?.[model];

  // 503 MODEL_CAPACITY_EXHAUSTED is an authoritative "doesn't fit" signal,
  // regardless of the remaining percentage: upstream rejected THIS request
  // because the account's pool cannot fit it, so a follow-up request of the
  // same task (agent turns are similarly sized) will not fit either. Block
  // the whole pool for this account immediately after one probe — no
  // threshold guessing, no repeated 503 round-trips per prompt turn.
  // Prefer the pool's own resetAt from the refreshed snapshot (weekly for
  // free/plus accounts, weekly/5h for pro); fall back to a short block when
  // the reading carries no usable reset time.
  if (status === 503) {
    const pool = getAntigravityQuotaPool(model);
    const candidates = [
      quota,
      pool ? quotas?.[`${pool}_weekly`] : null,
      pool ? quotas?.[`${pool}_5h`] : null,
    ].filter(q => q?.resetAt && Date.parse(q.resetAt) > Date.now());
    const resetCandidate = candidates.sort((a, b) => Date.parse(b.resetAt) - Date.parse(a.resetAt))[0];
    const resetAt = resetCandidate?.resetAt || new Date(Date.now() + STRIKE_BLOCK_MS).toISOString();

    strikeCounts.delete(`${connectionId}|${model}`);
    const cached = synthesizePoolBlock(quotaCache.get(connectionId), model, resetAt);
    quotaCache.set(connectionId, cached);
    const reading = resetCandidate ? `reading ${Math.round(resetCandidate.remainingPercentage ?? 0)}%` : "no reading";
    log.warn("AG_QUOTA", `${connectionId.slice(0, 8)} | UPSTREAM_503 ${model} — capacity exceeded, request won't fit (${reading}); CACHE_BLOCK pool until ${resetAt}`);
    return Date.parse(resetAt);
  }

  // Strike breaker: count every 429 whose quota reading is either optimistic
  // (remaining > 0) or unavailable (quota API 403/error). 3 within the window
  // => the pair is unhealthy regardless of what the API claims; block 15m.
  // 409 counts too by design: Antigravity signals pool exhaustion with 409 as
  // well (see #3561 — "skip exhausted account/model quota before upstream
  // retry" was motivated by 409/429 pairs), and poisoning by transient 409s
  // requires 3 of them inside 60 seconds on the same pair.
  if (!quota || quota.remainingPercentage > 0) {
    const key = `${connectionId}|${model}`;
    const now = Date.now();
    const strike = strikeCounts.get(key);
    // Fixed window anchored at the FIRST qualifying strike: three 429s must
    // all land within 60s of that first one, not within 60s of each other.
    const windowStart = strike && now - strike.windowStart <= STRIKE_WINDOW_MS ? strike.windowStart : now;
    const count = strike && windowStart === strike.windowStart ? strike.count + 1 : 1;
    strikeCounts.set(key, { count, windowStart });
    if (count >= STRIKE_THRESHOLD) {
      strikeCounts.delete(key);
      const blockedUntil = now + STRIKE_BLOCK_MS;
      const reading = quota ? `${Math.round(quota.remainingPercentage)}%` : "unknown";
      log.warn("AG_QUOTA", `${connectionId.slice(0, 8)} | STRIKE_${status} ${model} — ${count}x 429 (quota ${reading}); CACHE_BLOCK 15m`);
      // Synthesize a 0% entry in the shared cache so the auth pre-filter skips
      // this pair on subsequent requests too, not just the current retry loop
      // (the chat handler does not persist modelLock_* for this path).
      // Pool-wide synthesis: the strike proves upstream keeps 429ing this
      // model, and quota is metered per POOL (gemini vs claude_gpt) — block
      // every sibling in the pool so each one doesn't have to pay its own
      // 429 round-trip to learn the same thing.
      const cached = synthesizePoolBlock(quotaCache.get(connectionId), model, new Date(blockedUntil).toISOString());
      quotaCache.set(connectionId, cached);
      // Pool-wide strike block: re-assert across the whole family.
      for (const [k] of strikeBlocks) {
        if (k.startsWith(`${connectionId}|`) && getAntigravityQuotaPool(k.slice(connectionId.length + 1)) === getAntigravityQuotaPool(model)) {
          strikeBlocks.set(k, blockedUntil);
        }
      }
      strikeBlocks.set(key, blockedUntil);
      return blockedUntil;
    }
    return null;
  }

  // Healthy-but-exhausted reading: clear strikes and use the exact resetAt.
  strikeCounts.delete(`${connectionId}|${model}`);
  if (!quota.resetAt) return null;

  const resetMs = new Date(quota.resetAt).getTime();
  if (resetMs <= Date.now()) return null;

  // Pool-wide exhaustion confirmed upstream: propagate to sibling models so
  // the pre-filter skips them too. The upstream reading's resetAt (weekly
  // when weekly is the binding constraint; per-model 5h otherwise) is trusted.
  const poolProbe = findPoolBlockForModel(quotaCache.get(connectionId), model);
  const effectiveReset = poolProbe.blocked && poolProbe.resetAt ? poolProbe.resetAt : quota.resetAt;
  if (effectiveReset !== quota.resetAt) {
    const cached = synthesizePoolBlock(quotaCache.get(connectionId), model, effectiveReset);
    quotaCache.set(connectionId, cached);
    log.info("AG_QUOTA", `${connectionId.slice(0, 8)} | POOL_BLOCK ${getAntigravityQuotaPool(model)} until ${effectiveReset}`);
  }

  log.warn("AG_QUOTA", `${connectionId.slice(0, 8)} | UPSTREAM_${status} ${model} — quota exhausted; CACHE_BLOCK until ${quota.resetAt}`);
  return resetMs;
}
