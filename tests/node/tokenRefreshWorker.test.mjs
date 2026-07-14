// Unit tests for the token refresh worker's lead-window logic.
// Uses node:test so it can run without installing vitest in the clone.
//
//   node --test tests/node/tokenRefreshWorker.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  shouldAttemptRefresh,
  shouldRefreshNow,
  selectConnectionsForRefresh,
  isExpiredSessionOnly,
} from "../../src/sse/services/tokenRefreshWindow.js";

const NOW = Date.UTC(2026, 0, 1, 12, 0, 0); // fixed clock

test("returns false when refresh token missing", () => {
  const conn = {
    provider: "codex",
    refreshToken: "",
    expiresAt: new Date(NOW + 60_000).toISOString(),
  };
  assert.equal(shouldRefreshNow(conn, NOW), false);
});

test("returns false when expiresAt missing (request path handles it)", () => {
  const conn = { provider: "codex", refreshToken: "rt" };
  assert.equal(shouldRefreshNow(conn, NOW), false);
});

test("returns false when expiresAt is unparseable", () => {
  const conn = { provider: "codex", refreshToken: "rt", expiresAt: "not-a-date" };
  assert.equal(shouldRefreshNow(conn, NOW), false);
});

test("kiro: refresh when 20m remain (lead is 30m)", () => {
  const conn = {
    provider: "kiro",
    refreshToken: "rt",
    expiresAt: new Date(NOW + 20 * 60_000).toISOString(),
  };
  assert.equal(shouldRefreshNow(conn, NOW), true);
});

test("kiro: skip when 45m remain (outside 30m lead)", () => {
  const conn = {
    provider: "kiro",
    refreshToken: "rt",
    expiresAt: new Date(NOW + 45 * 60_000).toISOString(),
  };
  assert.equal(shouldRefreshNow(conn, NOW), false);
});

test("codex: refresh aggressively (5-day lead)", () => {
  const conn = {
    provider: "codex",
    refreshToken: "rt",
    expiresAt: new Date(NOW + 4 * 24 * 60 * 60_000).toISOString(),
  };
  assert.equal(shouldRefreshNow(conn, NOW), true);
});

test("unknown provider: falls back to 5m default buffer", () => {
  const conn = {
    provider: "made-up",
    refreshToken: "rt",
    expiresAt: new Date(NOW + 4 * 60_000).toISOString(),
  };
  assert.equal(shouldRefreshNow(conn, NOW), true);
});

test("unknown provider: skip when outside default 5m buffer", () => {
  const conn = {
    provider: "made-up",
    refreshToken: "rt",
    expiresAt: new Date(NOW + 6 * 60_000).toISOString(),
  };
  assert.equal(shouldRefreshNow(conn, NOW), false);
});

// ---------------------------------------------------------------------------
// shouldAttemptRefresh — worker-side gate that combines the lead window with
// skip rules (needs_relogin / disabled connection). These are the cases that
// keep the worker from hammering revoked OAuth endpoints.
// ---------------------------------------------------------------------------

function connInsideWindow(extra = {}) {
  return {
    provider: "kiro",
    refreshToken: "rt",
    expiresAt: new Date(NOW + 10 * 60_000).toISOString(), // 10m left, lead 30m
    isActive: true,
    testStatus: "active",
    ...extra,
  };
}

test("shouldAttemptRefresh: refresh active connection inside lead window", () => {
  assert.equal(shouldAttemptRefresh(connInsideWindow(), NOW), true);
});

test("shouldAttemptRefresh: skip needs_relogin even inside lead window", () => {
  assert.equal(
    shouldAttemptRefresh(connInsideWindow({ testStatus: "needs_relogin" }), NOW),
    false
  );
});

test("shouldAttemptRefresh: skip disabled connection (isActive=false)", () => {
  assert.equal(
    shouldAttemptRefresh(connInsideWindow({ isActive: false }), NOW),
    false
  );
});

test("shouldAttemptRefresh: skip when outside lead window", () => {
  const outside = connInsideWindow({
    expiresAt: new Date(NOW + 60 * 60_000).toISOString(), // 60m, lead 30m
  });
  assert.equal(shouldAttemptRefresh(outside, NOW), false);
});

test("shouldAttemptRefresh: returns false on null connection", () => {
  assert.equal(shouldAttemptRefresh(null, NOW), false);
  assert.equal(shouldAttemptRefresh(undefined, NOW), false);
});

test("selectConnectionsForRefresh: filters mixed list", () => {
  const list = [
    connInsideWindow({ provider: "kiro" }),                                // pick
    connInsideWindow({ provider: "github", testStatus: "needs_relogin" }), // skip
    connInsideWindow({ provider: "codex", isActive: false }),              // skip
    connInsideWindow({
      provider: "gemini",
      expiresAt: new Date(NOW + 60 * 60_000).toISOString(),                // skip (outside)
    }),
    connInsideWindow({
      provider: "antigravity",
      expiresAt: new Date(NOW + 9 * 60_000).toISOString(),                 // pick (lead 10m)
    }),
  ];
  const picks = selectConnectionsForRefresh(list, NOW);
  assert.deepEqual(
    picks.map((c) => c.provider),
    ["kiro", "antigravity"]
  );
});

test("selectConnectionsForRefresh: tolerates non-array / empty input", () => {
  assert.deepEqual(selectConnectionsForRefresh(null, NOW), []);
  assert.deepEqual(selectConnectionsForRefresh(undefined, NOW), []);
  assert.deepEqual(selectConnectionsForRefresh([], NOW), []);
});

// ---------------------------------------------------------------------------
// isExpiredSessionOnly — detect session-imported accounts (no refresh token)
// whose JWT has expired. Worker uses this to mark needs_relogin.
// ---------------------------------------------------------------------------

test("isExpiredSessionOnly: expired session with no refreshToken", () => {
  const conn = {
    refreshToken: null,
    expiresAt: new Date(NOW - 60_000).toISOString(),
    isActive: true,
    testStatus: "active",
  };
  assert.equal(isExpiredSessionOnly(conn, NOW), true);
});

test("isExpiredSessionOnly: future expiry returns false", () => {
  const conn = {
    refreshToken: null,
    expiresAt: new Date(NOW + 60_000).toISOString(),
    isActive: true,
  };
  assert.equal(isExpiredSessionOnly(conn, NOW), false);
});

test("isExpiredSessionOnly: connection with refreshToken returns false", () => {
  const conn = {
    refreshToken: "rt",
    expiresAt: new Date(NOW - 60_000).toISOString(),
    isActive: true,
  };
  assert.equal(isExpiredSessionOnly(conn, NOW), false);
});

test("isExpiredSessionOnly: missing expiresAt returns false", () => {
  const conn = { refreshToken: null, isActive: true };
  assert.equal(isExpiredSessionOnly(conn, NOW), false);
});

test("isExpiredSessionOnly: already needs_relogin returns false", () => {
  const conn = {
    refreshToken: null,
    expiresAt: new Date(NOW - 60_000).toISOString(),
    isActive: true,
    testStatus: "needs_relogin",
  };
  assert.equal(isExpiredSessionOnly(conn, NOW), false);
});

test("isExpiredSessionOnly: disabled connection returns false", () => {
  const conn = {
    refreshToken: null,
    expiresAt: new Date(NOW - 60_000).toISOString(),
    isActive: false,
  };
  assert.equal(isExpiredSessionOnly(conn, NOW), false);
});

test("isExpiredSessionOnly: null/undefined connection returns false", () => {
  assert.equal(isExpiredSessionOnly(null, NOW), false);
  assert.equal(isExpiredSessionOnly(undefined, NOW), false);
});

test("isExpiredSessionOnly: unparseable expiresAt returns false", () => {
  const conn = {
    refreshToken: null,
    expiresAt: "not-a-date",
    isActive: true,
  };
  assert.equal(isExpiredSessionOnly(conn, NOW), false);
});
