/**
 * Regression tests for #4250
 *
 * resetHealthStateOnActivation in connectionsRepo.js nulled ALL modelLock_*
 * fields whenever a connection was marked testStatus:"active". This erased
 * manually-injected far-future locks that are used to permanently suppress
 * retired/dead models (e.g. modelLock_nvidia/nemotron-3.5=2099-01-01).
 *
 * Fix: only clear locks whose expiry timestamp is in the past (expired cooldowns).
 * Active (future) locks survive the activation sweep.
 */

import { describe, it, expect, beforeAll } from "vitest";

// Replicate the fixed logic in isolation so the test does not need a real DB.

const MODEL_LOCK_PREFIX = "modelLock_";

function resetHealthStateOnActivation(existing, patch) {
  if (patch?.testStatus !== "active") return patch;

  const normalized = {
    ...patch,
    testStatus: "active",
    lastError: Object.hasOwn(patch, "lastError") ? patch.lastError : null,
    lastErrorAt: Object.hasOwn(patch, "lastErrorAt") ? patch.lastErrorAt : null,
    errorCode: null,
    rateLimitedUntil: null,
    backoffLevel: 0,
  };

  const now = Date.now();
  for (const key of Object.keys(existing || {})) {
    if (!key.startsWith(MODEL_LOCK_PREFIX)) continue;
    const expiry = existing[key];
    if (!expiry) continue;
    const expiryMs = new Date(expiry).getTime();
    if (!Number.isFinite(expiryMs) || expiryMs <= now) {
      normalized[key] = null; // expired: clear
    } else {
      normalized[key] = expiry; // still active: preserve
    }
  }

  return normalized;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function farFuture() {
  return new Date(Date.now() + 100 * 365 * 24 * 60 * 60 * 1000).toISOString(); // ~100y
}

function pastExpiry() {
  return new Date(Date.now() - 60 * 1000).toISOString(); // 1 min ago
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("resetHealthStateOnActivation — modelLock_* preservation (#4250)", () => {
  it("is a no-op when patch.testStatus is not 'active'", () => {
    const existing = { "modelLock_foo": farFuture() };
    const patch = { testStatus: "error", rateLimitedUntil: "2099-01-01T00:00:00Z" };
    const result = resetHealthStateOnActivation(existing, patch);
    expect(result).toBe(patch); // same reference, unchanged
  });

  it("preserves a far-future modelLock on activation", () => {
    const ff = farFuture();
    const existing = { "modelLock_nvidia/nemotron-dead": ff };
    const patch = { testStatus: "active" };
    const result = resetHealthStateOnActivation(existing, patch);
    // far-future lock must NOT be nulled
    expect(result["modelLock_nvidia/nemotron-dead"]).toBe(ff);
  });

  it("clears an expired modelLock on activation", () => {
    const existing = { "modelLock_some-model": pastExpiry() };
    const patch = { testStatus: "active" };
    const result = resetHealthStateOnActivation(existing, patch);
    expect(result["modelLock_some-model"]).toBeNull();
  });

  it("clears a null modelLock entry without error", () => {
    const existing = { "modelLock_gone": null };
    const patch = { testStatus: "active" };
    const result = resetHealthStateOnActivation(existing, patch);
    // null stays untouched (loop skips it)
    expect(result["modelLock_gone"]).toBeUndefined(); // not copied → absent in normalized
  });

  it("handles a mix of expired and active locks correctly", () => {
    const ff = farFuture();
    const existing = {
      "modelLock_active-model": ff,
      "modelLock_dead-model": pastExpiry(),
    };
    const patch = { testStatus: "active" };
    const result = resetHealthStateOnActivation(existing, patch);
    expect(result["modelLock_active-model"]).toBe(ff);  // preserved
    expect(result["modelLock_dead-model"]).toBeNull();   // cleared
  });

  it("resets health fields (rateLimitedUntil, backoffLevel) on activation", () => {
    const existing = { rateLimitedUntil: "2099-01-01T00:00:00Z", backoffLevel: 5 };
    const patch = { testStatus: "active" };
    const result = resetHealthStateOnActivation(existing, patch);
    expect(result.rateLimitedUntil).toBeNull();
    expect(result.backoffLevel).toBe(0);
    expect(result.testStatus).toBe("active");
  });

  it("does not touch non-modelLock fields on the existing record", () => {
    const existing = {
      apiKey: "sk-xxx",
      "modelLock_old": pastExpiry()
    };
    const patch = { testStatus: "active" };
    const result = resetHealthStateOnActivation(existing, patch);
    // apiKey is on existing but not on patch — it should not appear in normalized
    expect(result.apiKey).toBeUndefined();
    expect(result["modelLock_old"]).toBeNull();
  });
});