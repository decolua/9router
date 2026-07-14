// Unit tests for auth.js routing behavior around needs_relogin.
// Tests the filtering logic and markAccountUnavailable preserve behavior.
//
//   node --test tests/node/authRouting.test.mjs

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

// We can't import auth.js directly (uses @/ aliases). Instead we extract
// the pure logic into testable predicates and verify them here.
// The actual integration is verified via live DB observation.

// Replicate the filter predicate from getProviderCredentials
function isConnectionAvailable(connection, excludeSet, model, isModelLockActiveFn) {
  if (excludeSet.has(connection.id)) return false;
  if (isModelLockActiveFn(connection, model)) return false;
  if (connection.testStatus === "needs_relogin") return false;
  return true;
}

// Replicate the preserve logic from markAccountUnavailable
function computeStatusUpdate(currentTestStatus, lockUpdate, reason, status, backoffLevel) {
  const preserveStatus = currentTestStatus === "needs_relogin";
  return {
    ...lockUpdate,
    ...(preserveStatus ? {} : { testStatus: "unavailable" }),
    lastError: reason,
    errorCode: status,
    lastErrorAt: new Date().toISOString(),
    backoffLevel,
  };
}

describe("auth routing: isConnectionAvailable", () => {
  const noLock = () => false;
  const emptyExclude = new Set();

  test("active connection passes filter", () => {
    const conn = { id: "abc", testStatus: "active" };
    assert.ok(isConnectionAvailable(conn, emptyExclude, null, noLock));
  });

  test("needs_relogin connection is filtered out", () => {
    const conn = { id: "abc", testStatus: "needs_relogin" };
    assert.equal(isConnectionAvailable(conn, emptyExclude, null, noLock), false);
  });

  test("excluded connection is filtered out", () => {
    const conn = { id: "abc", testStatus: "active" };
    assert.equal(isConnectionAvailable(conn, new Set(["abc"]), null, noLock), false);
  });

  test("model-locked connection is filtered out", () => {
    const conn = { id: "abc", testStatus: "active" };
    const locked = () => true;
    assert.equal(isConnectionAvailable(conn, emptyExclude, "gpt-4", locked), false);
  });

  test("unavailable connection still passes filter (handled by isActive query)", () => {
    // Note: unavailable connections are not filtered here because the DB query
    // already filters by isActive=true. testStatus=unavailable with isActive=1
    // means temporarily rate-limited but still eligible for retry.
    const conn = { id: "abc", testStatus: "unavailable" };
    assert.ok(isConnectionAvailable(conn, emptyExclude, null, noLock));
  });
});

describe("auth routing: computeStatusUpdate preserves needs_relogin", () => {
  test("active connection gets overwritten to unavailable", () => {
    const result = computeStatusUpdate("active", {}, "rate limited", 429, 1);
    assert.equal(result.testStatus, "unavailable");
    assert.equal(result.lastError, "rate limited");
    assert.equal(result.errorCode, 429);
  });

  test("needs_relogin connection preserves status", () => {
    const result = computeStatusUpdate("needs_relogin", {}, "bearer invalid", 403, 0);
    assert.equal(result.testStatus, undefined); // not overwritten
    assert.equal(result.lastError, "bearer invalid");
    assert.equal(result.errorCode, 403);
  });

  test("unavailable connection gets overwritten to unavailable (no-op but explicit)", () => {
    const result = computeStatusUpdate("unavailable", {}, "server error", 500, 2);
    assert.equal(result.testStatus, "unavailable");
  });

  test("lockUpdate keys are preserved", () => {
    const lock = { "modelLock_gpt-4": "2026-01-01T00:00:00Z" };
    const result = computeStatusUpdate("active", lock, "rate limited", 429, 1);
    assert.equal(result["modelLock_gpt-4"], "2026-01-01T00:00:00Z");
    assert.equal(result.testStatus, "unavailable");
  });
});
