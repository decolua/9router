/**
 * Antigravity quota-pool mapping — pure helpers, no I/O.
 *
 * Google meters Antigravity quota in SHARED POOLS per account, not per model:
 *   - Pool "gemini":     all gemini-* models (incl. image & pro-agent variants)
 *   - Pool "claude_gpt": claude-* and gpt-oss-* models
 * Each pool has up to two windows (buckets from retrieveUserQuotaSummary):
 *   - Weekly: all tiers; the binding constraint when exhausted (a disabled
 *     5h reading is meaningless until the weekly refresh)
 *   - 5h: paid tiers only (free/plus accounts have no 5h bucket — they must
 *     never be skipped for "missing 5h quota")
 *
 * Cache keys produced by open-sse/services/usage/google.js (getAntigravityUsage):
 *   - per-model entries:  "gemini-3.8-flash-high", "claude-sonnet-4-6", ...
 *   - summary entries:     "gemini_weekly", "gemini_5h",
 *                          "claude_gpt_weekly", "claude_gpt_5h"
 *     (open-sse/services/usage/antigravity-weekly.js)
 */

const GEMINI_POOL_ID = "gemini";
const CLAUDE_GPT_POOL_ID = "claude_gpt";

// Canonical Antigravity model ids per pool (mirrors the importantModels list
// in open-sse/services/usage/google.js — keep both in sync).
const POOL_MODELS = {
  [GEMINI_POOL_ID]: [
    "gemini-3.8-flash-high", "gemini-3.8-flash-medium", "gemini-3.8-flash-low",
    "gemini-3.7-flash-high", "gemini-3.7-flash-medium", "gemini-3.7-flash-low",
    "gemini-3.6-flash-high", "gemini-3.6-flash-medium", "gemini-3.6-flash-low",
    "gemini-3.5-flash-low", "gemini-3.5-flash-extra-low",
    "gemini-pro-agent", "gemini-3.1-pro-low", "gemini-3.1-flash-image",
  ],
  [CLAUDE_GPT_POOL_ID]: [
    "claude-sonnet-4-6", "claude-opus-4-6-thinking", "gpt-oss-120b-medium",
  ],
};

/**
 * Map an Antigravity model id to its quota pool id.
 */
export function getAntigravityQuotaPool(model) {
  if (typeof model !== "string" || !model) return null;
  if (/^claude-|^gpt-oss/.test(model)) return CLAUDE_GPT_POOL_ID;
  return GEMINI_POOL_ID; // gemini-* (incl. image, pro-agent) and anything Google-side
}

/**
 * Collect the pool's summary entries (weekly + 5h) for a model.
 * @returns {{ weekly: object|null, fiveHour: object|null }}
 */
function getPoolWindows(quotas, pool) {
  const weeklyKey = `${pool}_weekly`;
  const fiveHourKey = `${pool}_5h`;
  return {
    weekly: quotas?.[weeklyKey] || null,
    fiveHour: quotas?.[fiveHourKey] || null,
  };
}

/**
 * Collect all cache entries that meter the given model's pool for a
 * connection: the pool's summary windows plus every per-model entry of the
 * family. Returned most specific first.
 *
 * @param {object} quotas  quotas map from the Antigravity quota cache
 * @param {string} model   requested model id
 * @returns {Array<{ key: string, entry: object }>}
 */
export function getPoolEntriesForModel(quotas, model) {
  if (!quotas || typeof quotas !== "object") return [];
  const pool = getAntigravityQuotaPool(model);
  if (!pool) return [];

  const entries = [];
  const { weekly, fiveHour } = getPoolWindows(quotas, pool);
  if (weekly) entries.push({ key: `${pool}_weekly`, entry: weekly });
  if (fiveHour) entries.push({ key: `${pool}_5h`, entry: fiveHour });

  for (const [key, entry] of Object.entries(quotas)) {
    if (key === "gemini_weekly" || key === "gemini_5h") continue;
    if (key === "claude_gpt_weekly" || key === "claude_gpt_5h") continue;
    if (getAntigravityQuotaPool(key) !== pool) continue;
    if (!entry) continue;
    entries.push({ key, entry });
  }

  return entries;
}

/**
 * Find the effective block for a model's pool on one connection.
 *
 * Window semantics (upstream /quota + retrieveUserQuotaSummary):
 * A request consumes from BOTH windows of its pool simultaneously, so the
 * pool is blocked while EITHER exhausted window is exhausted:
 *   - Weekly (all tiers): binding ceiling; when hit, upstream reports the 5h
 *     bucket as disabled=true (its reading is meaningless until weekly
 *     refreshes) — block until the weekly resetAt.
 *   - 5h (paid tiers only): when exhausted (0%, not disabled), the pool is
 *     dead even if the weekly window still shows headroom — pro accounts
 *     cannot "borrow" weekly quota. Block until the 5h resetAt.
 *   - Free/Plus tiers have NO 5h bucket — a missing 5h entry must never
 *     block anything (that would wrongly skip free accounts).
 *
 * Effective unblock time = the LATEST resetAt among the exhausted windows
 * (when the 5h window refreshes but weekly is still drained, the pool stays
 * blocked until the weekly resetAt).
 *
 * If only per-model entries exist (no summary yet), the pool blocks only
 * when EVERY per-model entry reads 0% with a future resetAt.
 *
 * @returns {{ blocked: boolean, resetAt: string|null, key: string|null }}
 */
export function findPoolBlockForModel(quotas, model) {
  const pool = getAntigravityQuotaPool(model);
  if (!pool) return { blocked: false, resetAt: null, key: null };

  const { weekly, fiveHour } = getPoolWindows(quotas || {}, pool);

  let blockUntilMs = 0;
  let blockResetAt = null;
  let blockKey = null;

  const consider = (entry, key) => {
    const remaining = Number(entry?.remainingPercentage);
    if (!Number.isFinite(remaining) || remaining > 0) return;
    const resetMs = entry?.resetAt ? Date.parse(entry.resetAt) : NaN;
    if (!Number.isFinite(resetMs) || resetMs <= Date.now()) return;
    if (resetMs > blockUntilMs) {
      blockUntilMs = resetMs;
      blockResetAt = entry.resetAt;
      blockKey = key;
    }
  };

  // Weekly: binding constraint for every tier.
  consider(weekly, `${pool}_weekly`);

  // 5h: only meaningful when reported and not disabled. A disabled 5h bucket
  // means the weekly window is the binding constraint (already handled above).
  if (fiveHour && fiveHour.disabled !== true) {
    consider(fiveHour, `${pool}_5h`);
  }

  if (blockResetAt) return { blocked: true, resetAt: blockResetAt, key: blockKey };

  // Legacy per-model-only snapshot: block only when every entry of the
  // family reads exhausted (each sibling otherwise keeps the pool routable).
  const entries = [];
  for (const [key, entry] of Object.entries(quotas || {})) {
    if (key.endsWith("_weekly") || key.endsWith("_5h")) continue;
    if (getAntigravityQuotaPool(key) !== pool) continue;
    if (entry) entries.push(entry);
  }
  if (entries.length === 0) return { blocked: false, resetAt: null, key: null };

  let latestResetAt = null;
  let latestResetMs = 0;
  let allExhausted = true;
  for (const entry of entries) {
    const remaining = Number(entry?.remainingPercentage);
    if (Number.isFinite(remaining) && remaining > 0) {
      allExhausted = false;
      break;
    }
    const resetMs = entry?.resetAt ? Date.parse(entry.resetAt) : NaN;
    if (Number.isFinite(resetMs) && resetMs > latestResetMs) {
      latestResetMs = resetMs;
      latestResetAt = entry.resetAt;
    }
  }
  if (allExhausted && latestResetAt && latestResetMs > Date.now()) {
    return { blocked: true, resetAt: latestResetAt, key: "per-model" };
  }

  return { blocked: false, resetAt: null, key: null };
}

/**
 * Synthesize a 0% cache entry for the pool's summary windows and every
 * canonical model of the family. Used when a hard 429/strike proves the whole
 * pool exhausted, so the auth pre-filter skips every sibling without
 * re-probing each one. Returns a NEW object (pure).
 */
export function synthesizePoolBlock(quotas, model, resetAt) {
  const pool = getAntigravityQuotaPool(model);
  if (!pool || !resetAt) return quotas || {};

  const next = { ...(quotas || {}) };
  const block = { remainingPercentage: 0, resetAt };

  // Mark the pool's weekly summary (authoritative window) and every canonical
  // model of the family — including ones never fetched — so exact-model
  // lookups for ANY sibling also see the block.
  next[`${pool}_weekly`] = { ...block, disabled: false, displayName: pool === GEMINI_POOL_ID ? "Gemini (Weekly)" : "Claude & GPT (Weekly)" };
  next[`${pool}_5h`] = { ...block, disabled: true, displayName: pool === GEMINI_POOL_ID ? "Gemini (5h)" : "Claude & GPT (5h)" };
  for (const modelId of POOL_MODELS[pool]) {
    next[modelId] = { ...block };
  }

  return next;
}

// Exported for tests: the canonical per-pool model list.
export function getPoolModels(pool) {
  return POOL_MODELS[pool] || [];
}
