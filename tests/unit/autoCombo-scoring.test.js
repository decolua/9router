import { describe, it, expect } from "vitest";
import {
  calculateScore,
  calculateTierScore,
  calculateFactors,
  scorePool,
  validateWeights,
  DEFAULT_WEIGHTS,
} from "../../open-sse/services/autoCombo/scoring.js";

describe("autoCombo scoring", () => {
  it("validateWeights: DEFAULT_WEIGHTS sum to 1.0", () => {
    expect(validateWeights(DEFAULT_WEIGHTS)).toBe(true);
  });

  it("validateWeights rejects a set not summing to ~1.0", () => {
    expect(validateWeights({ ...DEFAULT_WEIGHTS, quota: 0.5 })).toBe(false);
  });

  it("calculateScore is the weighted sum clamped to [0,1]", () => {
    const factors = { quota: 1, health: 1, costInv: 1, latencyInv: 1, taskFit: 1, stability: 1, tierPriority: 1, tierAffinity: 1, specificityMatch: 1, contextAffinity: 1, resetWindowAffinity: 1, connectionDensity: 1 };
    // all factors = 1 → score = sum of weights = 1.0
    expect(calculateScore(factors, DEFAULT_WEIGHTS)).toBeCloseTo(1.0, 5);
    const zero = { quota: 0, health: 0, costInv: 0, latencyInv: 0, taskFit: 0, stability: 0, tierPriority: 0, tierAffinity: 0, specificityMatch: 0, contextAffinity: 0, resetWindowAffinity: 0, connectionDensity: 0 };
    expect(calculateScore(zero, DEFAULT_WEIGHTS)).toBe(0);
  });

  it("calculateScore maps non-finite factors to 0 (no NaN propagation)", () => {
    const factors = { quota: NaN, health: 1, costInv: 1, latencyInv: 1, taskFit: 1, stability: 1, tierPriority: 1, tierAffinity: 1, specificityMatch: 1, contextAffinity: 1, resetWindowAffinity: 1, connectionDensity: 1 };
    const score = calculateScore(factors, DEFAULT_WEIGHTS);
    expect(Number.isFinite(score)).toBe(true);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it("calculateTierScore orders ultra > pro > standard > free", () => {
    const ultra = calculateTierScore("ultra", undefined);
    const pro = calculateTierScore("pro", undefined);
    const standard = calculateTierScore("standard", undefined);
    const free = calculateTierScore("free", undefined);
    expect(ultra).toBeGreaterThan(pro);
    expect(pro).toBeGreaterThan(standard);
    expect(standard).toBeGreaterThan(free);
  });

  it("calculateTierScore ignores case + defaults unknown to standard", () => {
    expect(calculateTierScore("ULTRA", undefined)).toBe(calculateTierScore("ultra", undefined));
    expect(calculateTierScore("bogus", undefined)).toBe(calculateTierScore("standard", undefined));
  });

  it("calculateFactors maps health from circuit-breaker state", () => {
    const pool = [mkCandidate({ circuitBreakerState: "CLOSED" }), mkCandidate({ circuitBreakerState: "HALF_OPEN" }), mkCandidate({ circuitBreakerState: "OPEN" })];
    const closed = calculateFactors(pool[0], pool, "chat", () => 0.5).health;
    const half = calculateFactors(pool[1], pool, "chat", () => 0.5).health;
    const open = calculateFactors(pool[2], pool, "chat", () => 0.5).health;
    expect(closed).toBe(1.0);
    expect(half).toBe(0.5);
    expect(open).toBe(0.0);
  });

  it("scorePool ranks a healthier/cheaper candidate first", () => {
    const better = mkCandidate({ provider: "a", quotaRemaining: 100, costPer1MTokens: 1, p95LatencyMs: 100, circuitBreakerState: "CLOSED" });
    const worse = mkCandidate({ provider: "b", quotaRemaining: 10, costPer1MTokens: 20, p95LatencyMs: 2000, circuitBreakerState: "OPEN" });
    const ranked = scorePool([worse, better], "chat");
    expect(ranked[0].provider).toBe("a");
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
  });
});

function mkCandidate(overrides = {}) {
  return {
    provider: "x",
    model: "m",
    quotaRemaining: 50,
    quotaTotal: 100,
    circuitBreakerState: "CLOSED",
    costPer1MTokens: 5,
    p95LatencyMs: 500,
    latencyStdDev: 50,
    errorRate: 0,
    ...overrides,
  };
}
