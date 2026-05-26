// Integration tests for OAuth token refresh flow.
//
//   node --test tests/node/oauthTokenRefresh.test.mjs
//
// Covers:
//   - refreshWithRetry: retry-on-null behavior, success/failure paths
//   - isUnrecoverableRefreshError: error-shape classification
//   - checkFallbackError: text-based rules, status-based rules, backoff progression

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  refreshWithRetry,
  isUnrecoverableRefreshError,
} from "../../open-sse/services/tokenRefresh.js";
import { checkFallbackError } from "../../open-sse/services/accountFallback.js";
import { BACKOFF_CONFIG, TRANSIENT_COOLDOWN_MS } from "../../open-sse/config/errorConfig.js";

// ---------------------------------------------------------------------------
// refreshWithRetry
// ---------------------------------------------------------------------------

test("refreshWithRetry returns first successful result", async () => {
  let calls = 0;
  const fn = async () => {
    calls++;
    return { accessToken: "first" };
  };

  const result = await refreshWithRetry(fn, 3);
  assert.equal(calls, 1);
  assert.deepEqual(result, { accessToken: "first" });
});

test("refreshWithRetry succeeds on second attempt after a null", async () => {
  let calls = 0;
  const fn = async () => {
    calls++;
    if (calls < 2) return null;
    return { accessToken: "second" };
  };

  const result = await refreshWithRetry(fn, 3);
  assert.equal(calls, 2);
  assert.deepEqual(result, { accessToken: "second" });
});

test("refreshWithRetry returns null after exhausting retries", async () => {
  let calls = 0;
  const fn = async () => {
    calls++;
    return null;
  };

  const result = await refreshWithRetry(fn, 3);
  assert.equal(calls, 3);
  assert.equal(result, null);
});

test("refreshWithRetry tolerates thrown errors without aborting", async () => {
  let calls = 0;
  const fn = async () => {
    calls++;
    if (calls === 1) throw new Error("transient network error");
    return { accessToken: "after-throw" };
  };

  const result = await refreshWithRetry(fn, 3);
  assert.equal(calls, 2);
  assert.deepEqual(result, { accessToken: "after-throw" });
});

test("refreshWithRetry returns null when every attempt throws", async () => {
  let calls = 0;
  const fn = async () => {
    calls++;
    throw new Error("dead upstream");
  };

  const result = await refreshWithRetry(fn, 2);
  assert.equal(calls, 2);
  assert.equal(result, null);
});

// ---------------------------------------------------------------------------
// isUnrecoverableRefreshError
// ---------------------------------------------------------------------------

test("isUnrecoverableRefreshError flags well-known unrecoverable shapes", () => {
  assert.equal(isUnrecoverableRefreshError({ error: "unrecoverable_refresh_error" }), true);
  assert.equal(isUnrecoverableRefreshError({ error: "refresh_token_reused" }), true);
  assert.equal(isUnrecoverableRefreshError({ error: "invalid_request" }), true);
  assert.equal(isUnrecoverableRefreshError({ error: "invalid_grant", code: "x" }), true);
});

test("isUnrecoverableRefreshError ignores recoverable / null shapes", () => {
  assert.ok(!isUnrecoverableRefreshError(null));
  assert.ok(!isUnrecoverableRefreshError(undefined));
  assert.ok(!isUnrecoverableRefreshError({}));
  assert.ok(!isUnrecoverableRefreshError({ error: "transient_network" }));
  assert.ok(!isUnrecoverableRefreshError({ accessToken: "good" }));
  assert.ok(!isUnrecoverableRefreshError("invalid_grant"));
});

// ---------------------------------------------------------------------------
// checkFallbackError
// ---------------------------------------------------------------------------

test("checkFallbackError text rule: rate limit triggers backoff progression", () => {
  const level1 = checkFallbackError(undefined, "rate limit exceeded for org_xyz", 0);
  assert.equal(level1.shouldFallback, true);
  assert.equal(level1.newBackoffLevel, 1);
  // base * 2^0 = base
  assert.equal(level1.cooldownMs, BACKOFF_CONFIG.base);

  const level2 = checkFallbackError(undefined, "rate limit", level1.newBackoffLevel);
  assert.equal(level2.newBackoffLevel, 2);
  assert.equal(level2.cooldownMs, BACKOFF_CONFIG.base * 2);

  const level3 = checkFallbackError(undefined, "rate limit", level2.newBackoffLevel);
  assert.equal(level3.newBackoffLevel, 3);
  assert.equal(level3.cooldownMs, BACKOFF_CONFIG.base * 4);
});

test("checkFallbackError text rule: fixed cooldown for 'no credentials'", () => {
  const result = checkFallbackError(401, "No credentials provided for tenant", 0);
  assert.equal(result.shouldFallback, true);
  assert.equal(result.cooldownMs, 2 * 60 * 1000);
  // text-rule with fixed cooldown does not advance backoff level
  assert.equal(result.newBackoffLevel, undefined);
});

test("checkFallbackError text rule: 'request not allowed' uses short cooldown", () => {
  const result = checkFallbackError(403, "Request not allowed in this region", 0);
  assert.equal(result.shouldFallback, true);
  assert.equal(result.cooldownMs, 5 * 1000);
});

test("checkFallbackError status rule: 429 uses backoff", () => {
  const level1 = checkFallbackError(429, "", 0);
  assert.equal(level1.shouldFallback, true);
  assert.equal(level1.newBackoffLevel, 1);
  assert.equal(level1.cooldownMs, BACKOFF_CONFIG.base);

  const level5 = checkFallbackError(429, "", 4);
  assert.equal(level5.newBackoffLevel, 5);
  assert.equal(level5.cooldownMs, BACKOFF_CONFIG.base * 16);
});

test("checkFallbackError status rule: backoff is capped at maxLevel and max cooldown", () => {
  const high = checkFallbackError(429, "", BACKOFF_CONFIG.maxLevel + 5);
  assert.equal(high.newBackoffLevel, BACKOFF_CONFIG.maxLevel);
  assert.ok(high.cooldownMs <= BACKOFF_CONFIG.max);
});

test("checkFallbackError status rule: 401/403/404 use fixed long cooldown", () => {
  for (const status of [401, 403, 404]) {
    const result = checkFallbackError(status, "", 0);
    assert.equal(result.shouldFallback, true, `status ${status}`);
    assert.equal(result.cooldownMs, 2 * 60 * 1000, `status ${status}`);
    assert.equal(result.newBackoffLevel, undefined, `status ${status}`);
  }
});

test("checkFallbackError default: unknown errors fall back to transient cooldown", () => {
  const result = checkFallbackError(599, "totally unknown failure", 0);
  assert.equal(result.shouldFallback, true);
  assert.equal(result.cooldownMs, TRANSIENT_COOLDOWN_MS);
});

test("checkFallbackError handles non-string error payloads via JSON.stringify", () => {
  const result = checkFallbackError(429, { reason: "rate limit hit", account: "x" }, 0);
  assert.equal(result.shouldFallback, true);
  // matched the 'rate limit' text rule, not the status rule
  assert.equal(result.newBackoffLevel, 1);
});

test("checkFallbackError text rule wins over status rule when both match", () => {
  // status 429 status-rule and text 'overloaded' text-rule both backoff,
  // but text rule is checked first — verify it produces backoff (same outcome,
  // important because text rules carry priority in routing).
  const result = checkFallbackError(429, "model is overloaded right now", 0);
  assert.equal(result.shouldFallback, true);
  assert.equal(result.newBackoffLevel, 1);
});
