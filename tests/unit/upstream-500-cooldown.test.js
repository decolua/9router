/**
 * Regression tests for #4277
 *
 * A single upstream 500 response previously put the provider into the default
 * 30-second TRANSIENT_COOLDOWN because no ERROR_RULES entry matched status 500.
 * Fast clients like codex (5× retries in ~10 s) burned all retries inside that
 * window and failed the turn permanently for what was usually a one-off.
 *
 * Fix: add explicit status-based rules for 500/502/503/504 with a 5-second
 * cooldown (COOLDOWN.transientServer). This lets fast clients retry after the
 * window instead of exhausting all attempts inside the blackout.
 *
 * These tests verify the ERROR_RULES lookup logic in isolation.
 */

import { describe, it, expect } from "vitest";
import { ERROR_RULES, TRANSIENT_COOLDOWN_MS } from "../../open-sse/config/errorConfig.js";

// Replicate the rule-matching logic used by accountFallback / markAccountUnavailable
function findRule(status, message = "") {
  const lowerMsg = (message || "").toLowerCase();
  for (const rule of ERROR_RULES) {
    if (rule.text && lowerMsg.includes(rule.text)) return rule;
    if (rule.status && rule.status === status) return rule;
  }
  return null; // falls through to TRANSIENT_COOLDOWN_MS
}

const TRANSIENT_SERVER_COOLDOWN_MS = 5 * 1000;

describe("ERROR_RULES transient server fault cooldowns (#4277)", () => {
  it("matches status 500 with a 5-second cooldown", () => {
    const rule = findRule(500);
    expect(rule).not.toBeNull();
    expect(rule.cooldownMs).toBe(TRANSIENT_SERVER_COOLDOWN_MS);
  });

  it("matches status 502 with a 5-second cooldown", () => {
    const rule = findRule(502);
    expect(rule).not.toBeNull();
    expect(rule.cooldownMs).toBe(TRANSIENT_SERVER_COOLDOWN_MS);
  });

  it("matches status 503 with a 5-second cooldown", () => {
    const rule = findRule(503);
    expect(rule).not.toBeNull();
    expect(rule.cooldownMs).toBe(TRANSIENT_SERVER_COOLDOWN_MS);
  });

  it("matches status 504 with a 5-second cooldown", () => {
    const rule = findRule(504);
    expect(rule).not.toBeNull();
    expect(rule.cooldownMs).toBe(TRANSIENT_SERVER_COOLDOWN_MS);
  });

  it("500 cooldown is shorter than the old 30-second default", () => {
    const rule = findRule(500);
    expect(rule.cooldownMs).toBeLessThan(TRANSIENT_COOLDOWN_MS);
  });

  it("500 with a rate-limit message still triggers backoff (text rule wins)", () => {
    const rule = findRule(500, "rate limit exceeded");
    expect(rule).not.toBeNull();
    expect(rule.backoff).toBe(true);
  });

  it("401 still gets the long cooldown (regression guard)", () => {
    const rule = findRule(401);
    expect(rule).not.toBeNull();
    expect(rule.cooldownMs).toBe(2 * 60 * 1000);
  });

  it("429 still triggers backoff (regression guard)", () => {
    const rule = findRule(429);
    expect(rule).not.toBeNull();
    expect(rule.backoff).toBe(true);
  });

  it("an unmatched status still falls through to TRANSIENT_COOLDOWN_MS", () => {
    const rule = findRule(418); // I'm a teapot — not in the table
    expect(rule).toBeNull();
  });
});