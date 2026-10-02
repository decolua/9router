/**
 * Antigravity live quota cache — in-memory, refreshed on demand.
 * Used by auth.js pre-filter to skip accounts with exhausted model quota.
 * Also triggered by 409/429 error handler to sync exact resetAt from upstream.
 */

import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";
import { getAntigravityUsage } from "open-sse/services/usage/google.js";
import { updateProviderConnection } from "@/lib/localDb";
import { getProviderModels } from "open-sse/config/providerModels.js";
import * as log from "../utils/logger.js";

// Models registered for Antigravity (fallback if registry empty)
const ANTIGRAVITY_MODELS_FALLBACK = [
  "gemini-3.8-flash-high", "gemini-3.8-flash-medium", "gemini-3.8-flash-low",
  "gemini-3.7-flash-high", "gemini-3.7-flash-medium", "gemini-3.7-flash-low",
  "gemini-3.6-flash-high", "gemini-3.6-flash-medium", "gemini-3.6-flash-low",
  "gemini-3-flash-agent", "gemini-3.5-flash-low", "gemini-3.5-flash-extra-low",
  "gemini-pro-agent", "gemini-3.1-pro-low",
  "claude-sonnet-4-6", "claude-opus-4-6-thinking",
  "gpt-oss-120b-medium", "gemini-3-flash",
  "gemini-3.1-flash-image", "gemini-3-pro-image",
];

export async function syncAntigravityQuotaLocksToDb(connectionId, quotas) {
  if (!connectionId || !quotas || typeof quotas !== "object") return;
  const now = Date.now();
  const models = (getProviderModels("antigravity") || []).map(m => m.id);
  const targetModels = models.length > 0 ? models : ANTIGRAVITY_MODELS_FALLBACK;
  const updates = {};

  for (const m of targetModels) {
    const q = findAntigravityQuota(quotas, m);
    if (!q) continue;
    const isExhausted = (q.remainingPercentage !== undefined && q.remainingPercentage <= 0) ||
                        (q.remaining !== undefined && q.remaining <= 0);
    const resetTimeMs = q.resetAt ? new Date(q.resetAt).getTime() : 0;
    if (isExhausted && resetTimeMs > now) {
      updates[`modelLock_${m}`] = new Date(resetTimeMs).toISOString();
    } else if (
      (q.remainingPercentage !== undefined && q.remainingPercentage > 0) ||
      (q.remaining !== undefined && q.remaining > 0) ||
      (resetTimeMs && resetTimeMs <= now)
    ) {
      updates[`modelLock_${m}`] = null;
    }
  }

  if (Object.keys(updates).length > 0) {
    try {
      await updateProviderConnection(connectionId, updates);
    } catch (err) {
      log.warn("AG_QUOTA", `${connectionId.slice(0, 8)} | failed to sync model locks to db: ${err.message}`);
    }
  }
}

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

    // Update in-memory cache. Caller logs CACHE_BLOCK only if requested model is exhausted.
    // Strike blocks are re-asserted after every refresh so an optimistic
    // upstream reading cannot resurrect a pair we just circuit-broke.
    quotaCache.set(connectionId, applyActiveStrikeBlocks(connectionId, usage.quotas));
    // Sync model locks directly to DB so zero-quota models are immediately skipped without probing
    syncAntigravityQuotaLocksToDb(connectionId, usage.quotas);

    return usage.quotas;
  } catch (e) {
    log.warn("AG_QUOTA", `${connectionId.slice(0, 8)} | refresh failed: ${e.message}`);
    return null;
  }
}

/**
 * Resolve the matching quota entry from Antigravity quotas map for a requested model.
 * Groups models by family:
 * - Anything with "flash" matches "Flash (High)" quota (gemini-3-flash-agent, etc.)
 *   completely skipping model version strings for robust checking.
 * - Anything with "pro" matches "Pro" quota (gemini-pro-agent, etc.)
 * - Claude Sonnet / Opus matches their respective quotas.
 * - Supports weekly family quotas (gemini_weekly, claude_gpt_weekly) for Free tier
 *   and exhausted weekly limits.
 * - Fallback to exact modelKey or matching displayName.
 *
 * @param {object|null|undefined} quotas - The quotas map from Antigravity usage API
 * @param {string|null|undefined} model - The requested model ID or alias
 * @returns {object|null} The matching quota entry or null
 */
export function findAntigravityQuota(quotas, model) {
  if (!quotas || typeof quotas !== "object" || !model) return null;

  const rawModel = String(model).trim();
  const cleanModel = rawModel.replace(/^(ag|antigravity)\//i, "");
  const modelLower = cleanModel.toLowerCase();

  // Find family weekly quota
  let weeklyQuota = null;
  if (modelLower.startsWith("gemini") || modelLower.includes("gemini")) {
    weeklyQuota = quotas["gemini_weekly"] || null;
  } else if (
    modelLower.startsWith("claude") || modelLower.includes("claude") ||
    modelLower.includes("sonnet") || modelLower.includes("opus") ||
    modelLower.startsWith("gpt") || modelLower.includes("gpt") || modelLower.includes("oss")
  ) {
    weeklyQuota = quotas["claude_gpt_weekly"] || null;
  }

  // If weekly quota is exhausted, the entire model family cannot be used
  const isWeeklyExhausted = weeklyQuota && (
    (weeklyQuota.remainingPercentage !== undefined && weeklyQuota.remainingPercentage <= 0) ||
    (weeklyQuota.remaining !== undefined && weeklyQuota.remaining <= 0)
  );
  if (isWeeklyExhausted) {
    return weeklyQuota;
  }

  // Find model-specific or group quota
  let modelQuota = null;

  // 1. Direct key match if present
  if (quotas[cleanModel]) modelQuota = quotas[cleanModel];
  else if (quotas[rawModel]) modelQuota = quotas[rawModel];

  // 2. Flash group: anything with "flash" (gemini-3.8-flash-high, gemini-3.7-flash-high, etc.)
  // syncs with "Flash (High)" quota (upstream key gemini-3-flash-agent, or displayName with "flash" and "high")
  else if (modelLower.includes("flash")) {
    if (quotas["gemini-3-flash-agent"]) modelQuota = quotas["gemini-3-flash-agent"];
    else {
      for (const [key, q] of Object.entries(quotas)) {
        const name = (q.displayName || "").toLowerCase();
        if ((key.includes("flash") || name.includes("flash")) && (name.includes("high") || key.includes("high") || key.includes("agent"))) {
          modelQuota = q;
          break;
        }
      }
      if (!modelQuota) {
        for (const [key, q] of Object.entries(quotas)) {
          if (key.includes("flash") || (q.displayName && q.displayName.toLowerCase().includes("flash"))) {
            modelQuota = q;
            break;
          }
        }
      }
    }
  }

  // 3. Pro group: anything with "pro" (gemini-pro-agent, gemini-3.1-pro-low, etc.)
  else if (modelLower.includes("pro")) {
    if (quotas["gemini-pro-agent"]) modelQuota = quotas["gemini-pro-agent"];
    else {
      for (const [key, q] of Object.entries(quotas)) {
        if (key.includes("pro") || (q.displayName && q.displayName.toLowerCase().includes("pro"))) {
          modelQuota = q;
          break;
        }
      }
    }
  }

  // 4. Claude Sonnet group
  else if (modelLower.includes("sonnet")) {
    if (quotas["claude-sonnet-4-6"]) modelQuota = quotas["claude-sonnet-4-6"];
    else {
      for (const [key, q] of Object.entries(quotas)) {
        if (key.includes("sonnet") || (q.displayName && q.displayName.toLowerCase().includes("sonnet"))) {
          modelQuota = q;
          break;
        }
      }
    }
  }

  // 5. Claude Opus group
  else if (modelLower.includes("opus")) {
    if (quotas["claude-opus-4-6-thinking"]) modelQuota = quotas["claude-opus-4-6-thinking"];
    else {
      for (const [key, q] of Object.entries(quotas)) {
        if (key.includes("opus") || (q.displayName && q.displayName.toLowerCase().includes("opus"))) {
          modelQuota = q;
          break;
        }
      }
    }
  }

  // 6. GPT group
  else if (modelLower.includes("gpt") || modelLower.includes("oss")) {
    if (quotas["gpt-oss-120b-medium"]) modelQuota = quotas["gpt-oss-120b-medium"];
    else {
      for (const [key, q] of Object.entries(quotas)) {
        if (key.includes("gpt") || (q.displayName && (q.displayName.toLowerCase().includes("gpt") || q.displayName.toLowerCase().includes("oss")))) {
          modelQuota = q;
          break;
        }
      }
    }
  }

  // 7. Generic displayName check
  if (!modelQuota) {
    for (const [key, q] of Object.entries(quotas)) {
      if (q.displayName && q.displayName.toLowerCase() === modelLower) {
        modelQuota = q;
        break;
      }
    }
  }

  if (modelQuota) return modelQuota;

  // Fallback to weekly quota if no model-specific quota was reported (e.g. Free Tier)
  if (weeklyQuota) return weeklyQuota;

  return null;
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
  const quota = findAntigravityQuota(quotas, model);

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
      const cached = quotaCache.get(connectionId) || {};
      cached[model] = { remainingPercentage: 0, resetAt: new Date(blockedUntil).toISOString() };
      quotaCache.set(connectionId, cached);
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

  log.warn("AG_QUOTA", `${connectionId.slice(0, 8)} | UPSTREAM_${status} ${model} — quota exhausted; CACHE_BLOCK until ${quota.resetAt}`);
  return resetMs;
}
