/**
 * Config for latency-aware (health-based) account routing.
 *
 * The tracker keeps a short rolling window of real request outcomes per
 * connection so the router can prefer accounts that are currently fast and
 * healthy, instead of always walking a static priority/round-robin order.
 */

// Strategy id used in settings (`fallbackStrategy` / `providerStrategies[x].fallbackStrategy`)
export const LATENCY_AWARE_STRATEGY = "latency-aware";

export const HEALTH_DEFAULTS = {
  // Rolling window of outcomes kept per key
  windowSize: 20,
  // Below this many samples a candidate is "unproven" and gets probe priority
  minSamples: 3,
  // Score weights (relative importance; normalized internally)
  latencyWeight: 0.5,
  errorWeight: 0.5,
  // How much slower than the fastest candidate counts as "maximally slow".
  // 1.0 → an account 2x slower than the best takes the full latency penalty.
  // Scoring is ratio-based so small absolute gaps (100ms vs 110ms) stay small.
  latencyToleranceRatio: 1.0,
  // Chance to pick a random proven candidate instead of the best one, so a
  // once-slow account can prove itself again and scores never go stale.
  explorationRate: 0.15,
  // Circuit breaker: error rate at/above this (with enough samples) skips the account
  circuitErrorRate: 0.5,
  circuitMinSamples: 4,
  circuitCooldownMs: 60 * 1000,
  // Samples older than this are ignored — routing follows *current* conditions
  sampleTtlMs: 15 * 60 * 1000,
};

// Hard bounds so bad settings can never break routing
export const HEALTH_LIMITS = {
  windowSize: { min: 5, max: 200 },
  minSamples: { min: 1, max: 50 },
  latencyWeight: { min: 0, max: 1 },
  errorWeight: { min: 0, max: 1 },
  latencyToleranceRatio: { min: 0.1, max: 10 },
  explorationRate: { min: 0, max: 1 },
  circuitErrorRate: { min: 0.1, max: 1 },
  circuitMinSamples: { min: 2, max: 100 },
  circuitCooldownMs: { min: 1000, max: 30 * 60 * 1000 },
  sampleTtlMs: { min: 60 * 1000, max: 24 * 60 * 60 * 1000 },
};

/** Total outcomes retained across all keys before the oldest keys are evicted */
export const HEALTH_MAX_KEYS = 500;

function clampNumber(value, fallback, bounds) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  if (!bounds) return n;
  return Math.min(bounds.max, Math.max(bounds.min, n));
}

/**
 * Merge user settings over defaults, clamping every field to a safe range.
 * @param {object|null} overrides - `settings.latencyAwareConfig`
 * @returns {object} resolved config
 */
export function resolveHealthConfig(overrides = null) {
  const cfg = { ...HEALTH_DEFAULTS };
  if (!overrides || typeof overrides !== "object") return cfg;
  for (const key of Object.keys(HEALTH_DEFAULTS)) {
    if (overrides[key] === undefined || overrides[key] === null || overrides[key] === "") continue;
    cfg[key] = clampNumber(overrides[key], HEALTH_DEFAULTS[key], HEALTH_LIMITS[key]);
  }
  return cfg;
}
