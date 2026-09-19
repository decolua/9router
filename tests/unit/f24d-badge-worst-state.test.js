import { describe, it, expect } from "vitest";

/**
 * F24d — the per-connection circuit breaker badge never rendered because
 * `useCircuitBreakers.getCircuitBreakerForConnection` matched the breaker key
 * EXACTLY against `provider:connectionId`, while every real key is
 * `provider:connectionId:model` (buildAccountBreakerName, chat.js:324,
 * auth.js:106/134). The badge — and with it the reset button fixed in F24c —
 * was unreachable.
 *
 * Contract under test (orchestrator decision D11): the badge for a connection
 * shows the WORST state among that connection's breakers
 * (OPEN > HALF_OPEN > DEGRADED > CLOSED), aggregated client-side with the
 * same segment-boundary rule the F24c reset route uses server-side:
 * `p:conn-1` must NOT pull in `p:conn-10`.
 */

const {
  breakerNameBelongsToAccount,
  aggregateCircuitBreakersForConnection,
} = await import("../../src/shared/hooks/useCircuitBreakers.js");

const PROVIDER = "f24d-prov";
const CONN = "conn-abc";
const ACCOUNT = `${PROVIDER}:${CONN}`;

/** A status entry shaped exactly like getAllCircuitBreakerStatuses() output. */
function status(name, state, extra = {}) {
  return {
    name,
    state,
    failureCount: 0,
    successCount: 0,
    lastFailureTime: null,
    retryAfterMs: 0,
    openedAt: null,
    transitions: [],
    ...extra,
  };
}

describe("breakerNameBelongsToAccount — segment-boundary prefix (F24c convention)", () => {
  it("matches the account-scoped key itself", () => {
    expect(breakerNameBelongsToAccount(ACCOUNT, PROVIDER, CONN)).toBe(true);
  });

  it("matches per-model keys underneath the account", () => {
    expect(breakerNameBelongsToAccount(`${ACCOUNT}:gpt-mini`, PROVIDER, CONN)).toBe(true);
  });

  it("does not match a sibling connection whose id extends this one", () => {
    // The naive `startsWith(ACCOUNT)` bug: p:conn-1 would also grab p:conn-10.
    expect(breakerNameBelongsToAccount(`${PROVIDER}:conn-abc10:gpt-mini`, PROVIDER, CONN)).toBe(false);
    expect(breakerNameBelongsToAccount(`${PROVIDER}:${CONN}-extra:gpt-mini`, PROVIDER, CONN)).toBe(false);
  });

  it("does not match another provider or a foreign model-only suffix", () => {
    expect(breakerNameBelongsToAccount(`${PROVIDER}2:${CONN}:gpt-mini`, PROVIDER, CONN)).toBe(false);
    expect(breakerNameBelongsToAccount(`${PROVIDER}:${CONN}x`, PROVIDER, CONN)).toBe(false);
  });

  it("tolerates non-string ids the same way buildAccountBreakerName does", () => {
    expect(breakerNameBelongsToAccount("p:7:gpt-mini", "p", 7)).toBe(true);
  });
});

describe("aggregateCircuitBreakersForConnection — worst state wins (D11)", () => {
  it("two real per-model keys, one OPEN one CLOSED → badge is OPEN", () => {
    const breakers = [
      status(`${ACCOUNT}:gpt-mini`, "CLOSED"),
      status(`${ACCOUNT}:gpt-big`, "OPEN", { retryAfterMs: 12_000, failureCount: 5 }),
    ];
    const agg = aggregateCircuitBreakersForConnection(breakers, PROVIDER, CONN);
    expect(agg).not.toBeNull();
    expect(agg.state).toBe("OPEN");
    expect(agg.retryAfterMs).toBe(12_000);
    expect(agg.models).toEqual(["gpt-big"]);
    // The aggregated name is the ACCOUNT key: the panel resets by it and the
    // F24c route sweeps every per-model key underneath (already accepted).
    expect(agg.name).toBe(ACCOUNT);
  });

  it("only CLOSED breakers → state CLOSED (badge itself renders nothing)", () => {
    const breakers = [
      status(`${ACCOUNT}:gpt-mini`, "CLOSED"),
      status(`${ACCOUNT}:gpt-big`, "CLOSED"),
    ];
    const agg = aggregateCircuitBreakersForConnection(breakers, PROVIDER, CONN);
    expect(agg).not.toBeNull();
    expect(agg.state).toBe("CLOSED");
  });

  it("no breaker for this connection → null (no badge, as today)", () => {
    const breakers = [status("other:conn:z", "OPEN")];
    expect(aggregateCircuitBreakersForConnection(breakers, PROVIDER, CONN)).toBeNull();
    expect(aggregateCircuitBreakersForConnection([], PROVIDER, CONN)).toBeNull();
  });

  it("severity order: OPEN > HALF_OPEN > DEGRADED > CLOSED", () => {
    const mixed = [
      status(`${ACCOUNT}:a`, "CLOSED"),
      status(`${ACCOUNT}:b`, "DEGRADED"),
      status(`${ACCOUNT}:c`, "HALF_OPEN", { retryAfterMs: 800 }),
    ];
    expect(aggregateCircuitBreakersForConnection(mixed, PROVIDER, CONN).state).toBe("HALF_OPEN");

    const plusOpen = [...mixed, status(`${ACCOUNT}:d`, "OPEN", { retryAfterMs: 9000 })];
    expect(aggregateCircuitBreakersForConnection(plusOpen, PROVIDER, CONN).state).toBe("OPEN");
  });

  it("retryAfterMs / failureCount / models describe the WORST-state set only", () => {
    const breakers = [
      status(`${ACCOUNT}:slow`, "OPEN", { retryAfterMs: 3_000, failureCount: 2 }),
      status(`${ACCOUNT}:fast`, "OPEN", { retryAfterMs: 9_000, failureCount: 7 }),
      status(`${ACCOUNT}:ok`, "DEGRADED", { retryAfterMs: 10_000, failureCount: 4 }),
    ];
    const agg = aggregateCircuitBreakersForConnection(breakers, PROVIDER, CONN);
    expect(agg.state).toBe("OPEN");
    // Longest remaining block among the OPEN ones (DEGRADED's 10s must not leak in).
    expect(agg.retryAfterMs).toBe(9_000);
    expect(agg.failureCount).toBe(9);
    expect(agg.models).toEqual(["slow", "fast"]);
  });

  it("ignores breakers of sibling connections when aggregating", () => {
    const breakers = [
      status(`${PROVIDER}:conn-abc1:gpt-mini`, "OPEN"),
      status(`${PROVIDER}:conn-abc:gpt-mini`, "CLOSED"),
    ];
    const agg = aggregateCircuitBreakersForConnection(breakers, PROVIDER, CONN);
    expect(agg.state).toBe("CLOSED");
    expect(agg.models).toEqual([]);
  });

  it("matches a legacy account-scoped key without a model segment", () => {
    const breakers = [status(ACCOUNT, "OPEN", { retryAfterMs: 5_000 })];
    const agg = aggregateCircuitBreakersForConnection(breakers, PROVIDER, CONN);
    expect(agg.state).toBe("OPEN");
    expect(agg.retryAfterMs).toBe(5_000);
  });

  it("an unknown non-CLOSED state still surfaces (badge's own fallback shows it)", () => {
    const breakers = [
      status(`${ACCOUNT}:a`, "CLOSED"),
      status(`${ACCOUNT}:b`, "COOLING_DOWN"),
    ];
    const agg = aggregateCircuitBreakersForConnection(breakers, PROVIDER, CONN);
    expect(agg.state).toBe("COOLING_DOWN");
  });

  it("a malformed entries list degrades to no badge instead of throwing", () => {
    expect(aggregateCircuitBreakersForConnection(null, PROVIDER, CONN)).toBeNull();
    expect(
      aggregateCircuitBreakersForConnection([{ name: null }, undefined, status(`${ACCOUNT}:a`, "OPEN")], PROVIDER, CONN).state,
    ).toBe("OPEN");
  });
});
