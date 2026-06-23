/**
 * In-process Headroom compression stats aggregator (v1: resets on restart).
 *
 * Exported API:
 *   recordHeadroomStats(stats, { connectionId })  — called per compressed request
 *   getHeadroomStatsSnapshot()                     — returns full stats object for /api/headroom/stats
 *   currentSource                                  — last compression source seen ('custom'|'detected'); 'unavailable' before first compression
 */

import { getPricingForModel } from "../providers/pricing.js";

const _startTime = Date.now();

// Global counters
let _requests_compressed = 0;
let _total_tokens_removed = 0;
let _compression_pct_sum = 0; // sum of per-request pct, divided by count for rolling avg
let _last_source = "unavailable";
let _primary_model = null;
let _model_counts = {}; // model -> request count (to derive primary_model)

// cost accumulators (undefined when no pricing data available)
let _without_headroom_usd = 0;
let _with_headroom_usd = 0;
let _has_cost_data = false;

// Per-project/connection buckets: Map<key, { requests, tokens_saved, cost_saved_usd?, last_activity_at }>
const _projects = new Map();

/**
 * Record stats from one compressWithHeadroom call.
 * @param {{ tokens_before, tokens_after, tokens_saved, model, source }} stats
 * @param {{ connectionId }} opts
 */
export function recordHeadroomStats(stats, { connectionId } = {}) {
  if (!stats) return;

  const tokensBefore = stats.tokens_before ?? 0;
  const tokensAfter = stats.tokens_after ?? 0;
  const tokensSaved = stats.tokens_saved ?? (tokensBefore - tokensAfter);
  const model = stats.model ?? null;
  const source = stats.source ?? "custom";

  if (tokensSaved <= 0 && tokensBefore <= 0) return; // nothing useful

  _requests_compressed += 1;
  _total_tokens_removed += tokensSaved;
  _last_source = source;

  if (tokensBefore > 0) {
    const pct = (tokensSaved / tokensBefore) * 100;
    _compression_pct_sum += pct;
  }

  // Track primary model
  if (model) {
    _model_counts[model] = (_model_counts[model] ?? 0) + 1;
    if (!_primary_model || _model_counts[model] > (_model_counts[_primary_model] ?? 0)) {
      _primary_model = model;
    }
  }

  // Cost: saved tokens are input tokens no longer sent.
  // Use `input` rate from pricing ($/1M tokens).
  let costSavedForRequest;
  if (model) {
    const pricing = getPricingForModel(null, model);
    if (pricing && typeof pricing.input === "number") {
      const inputRate = pricing.input / 1_000_000;
      const withoutCost = tokensBefore * inputRate;
      const withCost = tokensAfter * inputRate;
      _without_headroom_usd += withoutCost;
      _with_headroom_usd += withCost;
      costSavedForRequest = withoutCost - withCost;
      _has_cost_data = true;
    }
  }

  // Per-project bucket
  const key = connectionId ?? "default";
  const existing = _projects.get(key) ?? { requests: 0, tokens_saved: 0, cost_saved_usd: undefined, last_activity_at: null };
  existing.requests += 1;
  existing.tokens_saved += tokensSaved;
  if (costSavedForRequest !== undefined) {
    existing.cost_saved_usd = (existing.cost_saved_usd ?? 0) + costSavedForRequest;
  }
  existing.last_activity_at = new Date().toISOString();
  _projects.set(key, existing);
}

/**
 * Return a point-in-time snapshot for /api/headroom/stats.
 * Cost fields are undefined when no pricing data has been seen — callers render '—'.
 */
export function getHeadroomStatsSnapshot() {
  const uptime_seconds = Math.floor((Date.now() - _startTime) / 1000);
  const avg_compression_pct = _requests_compressed > 0
    ? _compression_pct_sum / _requests_compressed
    : 0;

  const cost = _has_cost_data
    ? {
        without_headroom_usd: _without_headroom_usd,
        with_headroom_usd: _with_headroom_usd,
        total_saved_usd: _without_headroom_usd - _with_headroom_usd,
        savings_pct: _without_headroom_usd > 0
          ? ((_without_headroom_usd - _with_headroom_usd) / _without_headroom_usd) * 100
          : 0,
      }
    : {
        without_headroom_usd: undefined,
        with_headroom_usd: undefined,
        total_saved_usd: undefined,
        savings_pct: undefined,
      };

  // Per-project savings — normalize cost field: omit if never computed
  const per_project = {};
  for (const [key, bucket] of _projects) {
    per_project[key] = {
      requests: bucket.requests,
      tokens_saved: bucket.tokens_saved,
      last_activity_at: bucket.last_activity_at,
      ...(bucket.cost_saved_usd !== undefined
        ? {
            compression_savings_usd: bucket.cost_saved_usd,
            savings_percent: bucket.tokens_saved > 0 && _total_tokens_removed > 0
              ? (bucket.tokens_saved / _total_tokens_removed) * 100
              : 0,
          }
        : {}),
    };
  }

  return {
    compression_source: _last_source,
    uptime_seconds,
    summary: {
      mode: "external",
      api_requests: _requests_compressed,
      primary_model: _primary_model,
      compression: {
        requests_compressed: _requests_compressed,
        avg_compression_pct,
        total_tokens_removed: _total_tokens_removed,
      },
      cost,
    },
    savings: {
      total_tokens: _total_tokens_removed,
      per_project,
    },
  };
}

/** Last compression source seen. */
export function currentSource() {
  return _last_source;
}

/** Exported for testing: reset all counters. */
export function _resetForTest() {
  _requests_compressed = 0;
  _total_tokens_removed = 0;
  _compression_pct_sum = 0;
  _last_source = "unavailable";
  _primary_model = null;
  _model_counts = {};
  _without_headroom_usd = 0;
  _with_headroom_usd = 0;
  _has_cost_data = false;
  _projects.clear();
}
