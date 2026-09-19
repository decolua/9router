/**
 * F24a-1 — HALF_OPEN probe safety timeout.
 *
 * A probe is authorized by canExecute() when the OPEN cooldown expires, but its
 * result is reported only later through recordSuccess/recordFailure. If the
 * caller never reports (dropped request, swallowed promise), the breaker would
 * sit in HALF_OPEN forever with no probe slots left — neither accepting nor
 * rejecting meaningfully. The breaker must fail closed: back to OPEN.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  getCircuitBreaker,
  recordFailure,
  canExecute,
  isBlocked,
  getRetryAfterMs,
  getAllCircuitBreakerStatuses,
  resetAllCircuitBreakers,
  STATE,
} from "../../open-sse/utils/circuitBreaker.js";

const NAME = "f24a:halfopen-timeout";

/** Read the state through the module's public API only. */
function stateOf(name) {
  const match = getAllCircuitBreakerStatuses().find((b) => b.name === name);
  return match ? match.state : null;
}

describe("circuitBreaker HALF_OPEN probe safety timeout (F24a-1)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetAllCircuitBreakers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("re-opens the breaker when an authorized HALF_OPEN probe never resolves", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      // resetTimeout 1000ms ⇒ probe safety budget = 2× configured timeout = 2000ms.
      const cb = getCircuitBreaker(NAME, {
        failureThreshold: 2,
        resetTimeout: 1000,
        halfOpenRequests: 1,
        failureWindowMs: 0,
      });
      expect(cb).toBeTruthy();

      // 1) Trip the breaker with successive provider failures → OPEN, fail-closed.
      recordFailure(NAME, { statusCode: 503 });
      recordFailure(NAME, { statusCode: 500 });
      expect(stateOf(NAME)).toBe(STATE.OPEN);
      expect(canExecute(NAME)).toBe(false);

      // 2) Advance past the cooldown → next call is authorized as the HALF_OPEN probe.
      vi.advanceTimersByTime(1000);
      expect(canExecute(NAME)).toBe(true);
      expect(stateOf(NAME)).toBe(STATE.HALF_OPEN);

      // 3) The probe is NEVER resolved (no recordSuccess/recordFailure for it).
      //    Advance well past the probe safety timeout.
      vi.advanceTimersByTime(2500);

      // 4) Breaker must fail closed again: back to OPEN, observable via the
      //    public API, and rejecting new calls.
      expect(stateOf(NAME)).toBe(STATE.OPEN);
      expect(canExecute(NAME)).toBe(false);
      expect(isBlocked(NAME)).toBe(true);
      expect(getRetryAfterMs(NAME)).toBeGreaterThan(0);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("[circuitBreaker] HALF_OPEN probe timed out → OPEN"),
      );
    } finally {
      warn.mockRestore();
    }
  });
});
