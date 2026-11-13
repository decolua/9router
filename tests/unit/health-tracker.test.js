/**
 * Latency-aware routing — health tracker core.
 *
 * Covers outcome recording, rolling-window summarization, circuit breaking,
 * and the candidate selection order (probe → score → explore).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  recordOutcome,
  getConnectionHealth,
  selectHealthiestConnection,
  getAllHealthStats,
  resetHealthStats,
  buildHealthKey,
} from "open-sse/services/healthTracker.js";
import { resolveHealthConfig, HEALTH_DEFAULTS } from "open-sse/config/healthConfig.js";

/** Record n identical outcomes for a connection. */
function seed(connectionId, { ok = true, latencyMs = 100, model = null, count = 1, provider = "claude" } = {}) {
  for (let i = 0; i < count; i++) {
    recordOutcome({ connectionId, ok, latencyMs, model, provider, connectionName: `acc-${connectionId}` });
  }
}

describe("healthTracker — recording & summarizing", () => {
  beforeEach(() => resetHealthStats());
  afterEach(() => { resetHealthStats(); vi.useRealTimers(); });

  it("ignores connections without an id and the virtual noauth account", () => {
    recordOutcome({ connectionId: null, ok: true, latencyMs: 10 });
    recordOutcome({ connectionId: "noauth", ok: true, latencyMs: 10 });
    expect(getAllHealthStats()).toHaveLength(0);
  });

  it("averages latency over successful calls only", () => {
    seed("a", { ok: true, latencyMs: 100, count: 2 });
    // A fast failure must not make the account look fast.
    seed("a", { ok: false, latencyMs: 5, count: 1 });

    const health = getConnectionHealth("a");
    expect(health.samples).toBe(3);
    expect(health.successes).toBe(2);
    expect(health.avgLatencyMs).toBe(100);
    expect(health.errorRate).toBeCloseTo(1 / 3, 5);
  });

  it("keeps at most windowSize samples", () => {
    const cfg = resolveHealthConfig({ windowSize: 5 });
    for (let i = 0; i < 20; i++) {
      recordOutcome({ connectionId: "a", ok: true, latencyMs: i, config: cfg });
    }
    expect(getConnectionHealth("a", null, cfg).samples).toBe(5);
  });

  it("drops samples older than the TTL", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const cfg = resolveHealthConfig({ sampleTtlMs: 60_000 });
    recordOutcome({ connectionId: "a", ok: true, latencyMs: 100, config: cfg });
    expect(getConnectionHealth("a", null, cfg).samples).toBe(1);

    vi.setSystemTime(new Date("2026-01-01T00:05:00Z"));
    expect(getConnectionHealth("a", null, cfg).samples).toBe(0);
  });

  it("records both an account-wide and a model-scoped entry", () => {
    seed("a", { model: "opus", count: 1 });
    expect(getAllHealthStats().map((r) => r.model).sort()).toEqual([null, "opus"]);
  });

  it("prefers model-scoped stats once they clear minSamples", () => {
    const cfg = resolveHealthConfig({ minSamples: 3 });
    // Account-wide is fast, but this specific model is slow on that account.
    seed("a", { latencyMs: 50, count: 10 });
    seed("a", { latencyMs: 900, model: "opus", count: 3 });

    expect(getConnectionHealth("a", "opus", cfg).scoped).toBe(true);
    expect(getConnectionHealth("a", "opus", cfg).avgLatencyMs).toBe(900);
    // Too few samples for this model → falls back to account-wide.
    expect(getConnectionHealth("a", "haiku", cfg).scoped).toBe(false);
  });

  it("resets stats for one connection without touching others", () => {
    seed("a", { count: 2 });
    seed("b", { count: 2 });
    resetHealthStats("a");
    expect(getConnectionHealth("a").samples).toBe(0);
    expect(getConnectionHealth("b").samples).toBe(2);
  });

  it("builds model-scoped keys distinct from account keys", () => {
    expect(buildHealthKey("a")).not.toBe(buildHealthKey("a", "opus"));
  });
});

describe("healthTracker — circuit breaker", () => {
  beforeEach(() => resetHealthStats());
  afterEach(() => { resetHealthStats(); vi.useRealTimers(); });

  it("trips once the error rate crosses the threshold with enough samples", () => {
    const cfg = resolveHealthConfig({ circuitMinSamples: 4, circuitErrorRate: 0.5 });
    seed("a", { ok: false, count: 4 });
    expect(getConnectionHealth("a", null, cfg).circuitOpen).toBe(true);
  });

  it("stays closed below the sample floor", () => {
    const cfg = resolveHealthConfig({ circuitMinSamples: 4, circuitErrorRate: 0.5 });
    seed("a", { ok: false, count: 3 });
    expect(getConnectionHealth("a", null, cfg).circuitOpen).toBe(false);
  });

  it("re-closes after the cooldown elapses", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const cfg = resolveHealthConfig({ circuitMinSamples: 4, circuitCooldownMs: 60_000, sampleTtlMs: 3_600_000 });
    seed("a", { ok: false, count: 4 });
    expect(getConnectionHealth("a", null, cfg).circuitOpen).toBe(true);

    vi.setSystemTime(new Date("2026-01-01T00:02:00Z"));
    expect(getConnectionHealth("a", null, cfg).circuitOpen).toBe(false);
  });
});

describe("healthTracker — selection", () => {
  beforeEach(() => resetHealthStats());
  afterEach(() => resetHealthStats());

  const never = () => 1; // RNG that never triggers exploration

  it("returns the single candidate untouched", () => {
    const only = { id: "a" };
    expect(selectHealthiestConnection([only]).connection).toBe(only);
  });

  it("handles an empty candidate list", () => {
    expect(selectHealthiestConnection([]).connection).toBeNull();
  });

  it("probes unproven accounts before ranking anything", () => {
    const cfg = resolveHealthConfig({ minSamples: 3 });
    seed("a", { latencyMs: 50, count: 10 });
    // "b" has no history at all → must be probed so it can earn data.
    const { connection, reason } = selectHealthiestConnection(
      [{ id: "a" }, { id: "b" }],
      { config: cfg, random: never }
    );
    expect(connection.id).toBe("b");
    expect(reason).toBe("probe-unproven");
  });

  it("picks the fastest account when error rates match", () => {
    const cfg = resolveHealthConfig({ minSamples: 2 });
    seed("fast", { latencyMs: 100, count: 5 });
    seed("slow", { latencyMs: 900, count: 5 });

    const { connection, reason } = selectHealthiestConnection(
      [{ id: "slow" }, { id: "fast" }],
      { config: cfg, random: never }
    );
    expect(connection.id).toBe("fast");
    expect(reason).toBe("best-score");
  });

  it("prefers the reliable account when latencies are close", () => {
    // Regression: with min-max normalization the 110ms account scored as
    // "maximally slow" purely because its peer sat at 100ms, so a 30% error
    // rate lost to a 10ms edge. Ratio scoring keeps the gap proportional.
    const cfg = resolveHealthConfig({ minSamples: 2, circuitErrorRate: 1.1 }); // breaker off
    seed("flaky", { latencyMs: 100, ok: true, count: 7 });
    seed("flaky", { latencyMs: 100, ok: false, count: 3 });
    seed("steady", { latencyMs: 110, ok: true, count: 10 });

    const { connection } = selectHealthiestConnection(
      [{ id: "flaky" }, { id: "steady" }],
      { config: cfg, random: never }
    );
    expect(connection.id).toBe("steady");
  });

  it("still prefers a much faster account over a slightly more reliable one", () => {
    const cfg = resolveHealthConfig({ minSamples: 2, circuitErrorRate: 1.1 });
    seed("fast", { latencyMs: 100, ok: true, count: 19 });
    seed("fast", { latencyMs: 100, ok: false, count: 1 });
    seed("slow", { latencyMs: 1500, ok: true, count: 20 });

    const { connection } = selectHealthiestConnection(
      [{ id: "fast" }, { id: "slow" }],
      { config: cfg, random: never }
    );
    expect(connection.id).toBe("fast");
  });

  it("skips accounts whose circuit is open", () => {
    const cfg = resolveHealthConfig({ minSamples: 2, circuitMinSamples: 4, circuitErrorRate: 0.5 });
    seed("broken", { latencyMs: 10, ok: false, count: 6 });
    seed("ok", { latencyMs: 800, ok: true, count: 6 });

    const { connection } = selectHealthiestConnection(
      [{ id: "broken" }, { id: "ok" }],
      { config: cfg, random: never }
    );
    expect(connection.id).toBe("ok");
  });

  it("degrades gracefully when every circuit is open", () => {
    const cfg = resolveHealthConfig({ minSamples: 2, circuitMinSamples: 4, circuitErrorRate: 0.5 });
    seed("x", { ok: false, count: 6 });
    seed("y", { ok: false, count: 6 });

    const { connection, reason } = selectHealthiestConnection(
      [{ id: "x" }, { id: "y" }],
      { config: cfg, random: never }
    );
    expect(connection).not.toBeNull();
    expect(reason).toBe("all-circuits-open");
  });

  it("explores a non-best candidate when the RNG says so", () => {
    const cfg = resolveHealthConfig({ minSamples: 2, explorationRate: 0.5 });
    seed("fast", { latencyMs: 100, count: 5 });
    seed("slow", { latencyMs: 900, count: 5 });

    const { connection, reason } = selectHealthiestConnection(
      [{ id: "fast" }, { id: "slow" }],
      { config: cfg, random: () => 0 } // 0 < explorationRate → explore, index 0 of alternatives
    );
    expect(reason).toBe("explore");
    expect(connection.id).toBe("slow");
  });

  it("never explores when the rate is zero", () => {
    const cfg = resolveHealthConfig({ minSamples: 2, explorationRate: 0 });
    seed("fast", { latencyMs: 100, count: 5 });
    seed("slow", { latencyMs: 900, count: 5 });

    const { connection } = selectHealthiestConnection(
      [{ id: "fast" }, { id: "slow" }],
      { config: cfg, random: () => 0 }
    );
    expect(connection.id).toBe("fast");
  });
});

describe("resolveHealthConfig", () => {
  it("returns defaults for empty input", () => {
    expect(resolveHealthConfig(null)).toEqual(HEALTH_DEFAULTS);
    expect(resolveHealthConfig({})).toEqual(HEALTH_DEFAULTS);
  });

  it("clamps out-of-range values instead of trusting them", () => {
    const cfg = resolveHealthConfig({ windowSize: 99999, explorationRate: -5, minSamples: 0 });
    expect(cfg.windowSize).toBe(200);
    expect(cfg.explorationRate).toBe(0);
    expect(cfg.minSamples).toBe(1);
  });

  it("ignores blank and non-numeric values", () => {
    const cfg = resolveHealthConfig({ windowSize: "", minSamples: null, latencyWeight: "abc" });
    expect(cfg.windowSize).toBe(HEALTH_DEFAULTS.windowSize);
    expect(cfg.minSamples).toBe(HEALTH_DEFAULTS.minSamples);
    expect(cfg.latencyWeight).toBe(HEALTH_DEFAULTS.latencyWeight);
  });
});
