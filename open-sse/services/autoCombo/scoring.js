// Ported from OmniRoute open-sse/services/autoCombo/scoring.ts.
// Auto-Combo 12-factor weighted scorer. Pure/deterministic — unit-testable.
import { classifyTier } from "./tierResolver.js";

// clamp to [0,1]; non-finite (NaN/bad telemetry) → 0 so one bad input can't
// produce a NaN/over-1 score that sorts nondeterministically.
function clamp01(x) {
  const n = Number(x);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
}

export const DEFAULT_WEIGHTS = {
  quota: 0.15,
  health: 0.2,
  costInv: 0.15,
  latencyInv: 0.12,
  taskFit: 0.08,
  stability: 0.05,
  tierPriority: 0.05,
  tierAffinity: 0.05,
  specificityMatch: 0.05,
  contextAffinity: 0.05,
  resetWindowAffinity: 0,
  connectionDensity: 0.05,
};

/**
 * Calculate weighted score from factors. Result clamped to [0,1].
 */
export function calculateScore(factors, weights) {
  return clamp01(
    weights.quota * factors.quota +
      weights.health * factors.health +
      weights.costInv * factors.costInv +
      weights.latencyInv * factors.latencyInv +
      weights.taskFit * factors.taskFit +
      weights.stability * factors.stability +
      weights.tierPriority * factors.tierPriority +
      (weights.tierAffinity ?? 0) * factors.tierAffinity +
      (weights.specificityMatch ?? 0) * factors.specificityMatch +
      (weights.contextAffinity ?? 0) * factors.contextAffinity +
      (weights.resetWindowAffinity ?? 0) * factors.resetWindowAffinity +
      (weights.connectionDensity ?? 0) * factors.connectionDensity
  );
}

/**
 * Convert account tier to a normalized score [0..1]. Shorter quota-reset
 * intervals score higher when the base tier is equal.
 */
export function calculateTierScore(tier, quotaResetIntervalSecs) {
  const BASE_TIER_SCORES = { ultra: 1.0, pro: 0.67, standard: 0.33, free: 0.0 };
  const baseScore = BASE_TIER_SCORES[(tier || "").toLowerCase()] ?? 0.33;

  const resetBonus =
    quotaResetIntervalSecs != null && quotaResetIntervalSecs > 0
      ? Math.max(0, 1 - quotaResetIntervalSecs / 2_592_000)
      : 0;

  return Math.min(1, baseScore * 0.8 + resetBonus * 0.2);
}

function calculateTierAffinity(candidate, hint) {
  if (!hint) return 0.5;
  const assignment = classifyTier(candidate.provider, candidate.model);
  const tierOrder = ["free", "cheap", "premium"];
  const providerTierIdx = tierOrder.indexOf(assignment.tier);
  const minTierIdx = tierOrder.indexOf(hint.recommendedMinTier);

  if (providerTierIdx === minTierIdx) return 1.0;
  if (Math.abs(providerTierIdx - minTierIdx) === 1) return 0.7;
  return 0.3;
}

function calculateSpecificityMatch(candidate, hint) {
  if (!hint) return 0.5;
  const assignment = classifyTier(candidate.provider, candidate.model);
  const specificityScore = hint.specificity.score;

  if (assignment.tier === "free") return specificityScore <= 15 ? 0.9 : 0.2;
  if (assignment.tier === "cheap") return specificityScore > 15 && specificityScore <= 50 ? 0.9 : 0.4;
  if (assignment.tier === "premium") return specificityScore > 50 ? 0.9 : 0.3;
  return 0.5;
}

/**
 * Calculate the 12 scoring factors for a candidate (all contractually [0,1]).
 */
export function calculateFactors(candidate, pool, taskType, getTaskFitness, manifestHint) {
  const maxCost = Math.max(...pool.map((p) => p.costPer1MTokens), 0.001);
  const maxLatency = Math.max(...pool.map((p) => p.p95LatencyMs), 1);
  const maxStdDev = Math.max(...pool.map((p) => p.latencyStdDev), 0.001);

  return {
    quota: clamp01(candidate.quotaRemaining / 100),
    health:
      candidate.circuitBreakerState === "CLOSED"
        ? 1.0
        : candidate.circuitBreakerState === "HALF_OPEN"
          ? 0.5
          : 0.0,
    costInv: clamp01(1 - candidate.costPer1MTokens / maxCost),
    latencyInv: clamp01(1 - candidate.p95LatencyMs / maxLatency),
    taskFit: clamp01(getTaskFitness(candidate.model, taskType)),
    stability: clamp01(1 - candidate.latencyStdDev / maxStdDev),
    tierPriority: calculateTierScore(candidate.accountTier, candidate.quotaResetIntervalSecs),
    tierAffinity: calculateTierAffinity(candidate, manifestHint),
    specificityMatch: calculateSpecificityMatch(candidate, manifestHint),
    contextAffinity: clamp01(candidate.contextAffinity ?? 0.5),
    resetWindowAffinity: clamp01(candidate.resetWindowAffinity ?? 0.5),
    connectionDensity: clamp01(((candidate.connectionPoolSize ?? 1) - 1) / 10),
  };
}

/**
 * Score + rank a pool of candidates. Returns sorted-desc by score.
 */
export function scorePool(pool, taskType, weights = DEFAULT_WEIGHTS, getTaskFitness = () => 0.5, manifestHint) {
  return pool
    .map((candidate) => {
      const factors = calculateFactors(candidate, pool, taskType, getTaskFitness, manifestHint);
      return {
        provider: candidate.provider,
        model: candidate.model,
        score: calculateScore(factors, weights),
        factors,
        connectionId: candidate.connectionId,
      };
    })
    .sort((a, b) => b.score - a.score);
}

/**
 * Validate that weights sum to 1.0 (±0.01 tolerance).
 */
export function validateWeights(weights) {
  const sum = Object.values(weights).reduce((a, b) => a + b, 0);
  return Math.abs(sum - 1.0) < 0.01;
}
