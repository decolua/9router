/**
 * F24b — HIGH remanescente T1.1:
 *
 * RH4: the account-fallback loop in src/sse/handlers/chat.js wraps each
 * attempt in try/FINALLY only. handleChatCore has uncovered call sites
 * (translateRequest, createRequestLogger, pipeWithDisconnect TypeError on
 * 204 bodies, markAccountUnavailable on the DB) that THROW instead of
 * returning {success:false}. Today the exception escapes handleChat →
 * Next renders an HTML 500, no next account is attempted, and the HALF_OPEN
 * probe stays in flight with no outcome.
 *
 * RM7: pending-request accounting must be settled exactly once per attempt.
 * The loop's own resources (semaphore release, breaker outcome) get a single
 * settle per request — never a double decrement/settle — across success,
 * error and abort paths, including racing lifecycle callbacks.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderCredentials: vi.fn(),
  markAccountUnavailable: vi.fn(),
  clearAccountError: vi.fn(),
  extractApiKey: vi.fn(() => null),
  isValidApiKey: vi.fn(),
  getSettings: vi.fn(),
  getModelInfo: vi.fn(),
  getComboModels: vi.fn(),
  handleChatCore: vi.fn(),
  checkAndRefreshToken: vi.fn(),
  handleAntigravityQuotaError: vi.fn(),
  trackPending: vi.fn(),
}));

vi.mock("open-sse/index.js", () => ({}));

vi.mock("@/sse/services/auth.js", () => ({
  getProviderCredentials: mocks.getProviderCredentials,
  markAccountUnavailable: mocks.markAccountUnavailable,
  clearAccountError: mocks.clearAccountError,
  extractApiKey: mocks.extractApiKey,
  isValidApiKey: mocks.isValidApiKey,
}));

vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings,
  getCombos: vi.fn(),
}));

vi.mock("@/sse/services/model.js", () => ({
  getModelInfo: mocks.getModelInfo,
  getComboModels: mocks.getComboModels,
}));

vi.mock("open-sse/handlers/chatCore.js", () => ({
  handleChatCore: mocks.handleChatCore,
}));

vi.mock("@/sse/services/tokenRefresh.js", () => ({
  checkAndRefreshToken: mocks.checkAndRefreshToken,
  updateProviderCredentials: vi.fn(),
}));

vi.mock("@/sse/utils/logger.js", () => ({
  request: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  maskKey: vi.fn(() => "masked"),
  line: vi.fn(),
  errorLine: vi.fn(),
}));

vi.mock("@/sse/services/antigravityQuota.js", () => ({
  handleAntigravityQuotaError: mocks.handleAntigravityQuotaError,
}));

vi.mock("@/lib/pxpipe/loader.js", () => ({
  getTransform: vi.fn(async () => null),
}));

vi.mock("@/lib/pxpipe/events.js", () => ({
  appendPxpipeEvent: vi.fn(),
}));

import { handleChat } from "@/sse/handlers/chat.js";
import * as log from "@/sse/utils/logger.js";
import {
  getCircuitBreaker,
  recordFailure,
  resetAllCircuitBreakers,
  buildAccountBreakerName,
  isBlocked,
  canExecute,
  shouldRecordBreakerFailure,
  STATE,
} from "../../open-sse/utils/circuitBreaker.js";
import {
  acquire,
  resolveAccountSemaphoreKey,
} from "../../open-sse/services/accountSemaphore.js";

const PROVIDER = "glm";
const MODEL = "glm-4";
const MODEL_STR = `${PROVIDER}/${MODEL}`;
const ACC_1 = "acc-f24b-one";
const ACC_2 = "acc-f24b-two";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function chatRequest({ stream = false } = {}) {
  return new Request("http://localhost/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL_STR,
      stream,
      messages: [{ role: "user", content: "hi" }],
    }),
  });
}

function credentials(connectionId) {
  return {
    apiKey: "test-key",
    connectionId,
    connectionName: connectionId,
    providerSpecificData: { maxConcurrency: 1 },
  };
}

function breakerOpts(overrides = {}) {
  return {
    failureThreshold: 5,
    resetTimeout: 30_000,
    failureWindowMs: 120_000,
    isFailure: (err) => shouldRecordBreakerFailure(err?.statusCode),
    ...overrides,
  };
}

async function expireOpenBreakerToHalfOpen(name, { resetTimeout = 40 } = {}) {
  getCircuitBreaker(name, breakerOpts({ failureThreshold: 1, resetTimeout }));
  recordFailure(name, { statusCode: 500 });
  await sleep(resetTimeout + 20);
}

/** Two accounts, round-robin by exclusion set; null once both are excluded. */
function stubTwoAccounts() {
  mocks.getProviderCredentials.mockImplementation(async (_provider, exclude) => {
    const excluded = exclude instanceof Set ? exclude : new Set();
    if (!excluded.has(ACC_1)) return credentials(ACC_1);
    if (!excluded.has(ACC_2)) return credentials(ACC_2);
    return null;
  });
}

/**
 * Faithful mini-chatCore: mirrors the REAL trackPendingRequest pattern of
 * open-sse/handlers/chatCore.js — +1 at execute dispatch (:343), exactly one
 * −1 on the terminal event (trackDone/flush or controller disconnect), and
 * the controller's once-guard so late racing events cannot decrement twice.
 */
function mockChatCoreTracking() {
  const ledger = { net: 0, ups: 0, downs: 0 };
  mocks.trackPending.mockImplementation((_model, _provider, _conn, started) => {
    if (started) {
      ledger.net += 1;
      ledger.ups += 1;
    } else {
      ledger.net -= 1;
      ledger.downs += 1;
    }
  });
  return { ledger, trackPending: mocks.trackPending };
}

function streamingChatCoreMock(ledger) {
  const captured = {};
  mocks.handleChatCore.mockImplementation(async (args) => {
    ledger.track(MODEL, PROVIDER, args.connectionId, true); // chatCore.js:343
    let closed = false; // mirrors streamHandler's `disconnected` guard
    captured.onStreamComplete = () => {
      if (closed) return;
      closed = true;
      ledger.track(MODEL, PROVIDER, args.connectionId, false); // stream.js flush
      args.onStreamComplete?.();
    };
    captured.onDisconnect = () => {
      if (closed) return;
      closed = true;
      ledger.track(MODEL, PROVIDER, args.connectionId, false); // chatCore.js:351
      args.onDisconnect?.();
    };
    return {
      success: true,
      response: new Response("sse", {
        headers: { "Content-Type": "text/event-stream" },
      }),
    };
  });
  return captured;
}

async function expectSemaphoreFree(connectionId) {
  const key = resolveAccountSemaphoreKey({ provider: PROVIDER, connectionId });
  const release = await acquire(key, { maxConcurrency: 1, timeoutMs: 50 });
  expect(typeof release).toBe("function");
  release();
}

describe("F24b — RH4: exceptions in the account loop fall through to the next account", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAllCircuitBreakers();
    process.env.ACCOUNT_CAPACITY_WAIT_MS = "300";
    mocks.getSettings.mockResolvedValue({ requireApiKey: false });
    mocks.getModelInfo.mockResolvedValue({ provider: PROVIDER, model: MODEL });
    mocks.getComboModels.mockResolvedValue(null);
    mocks.checkAndRefreshToken.mockImplementation(async (_p, creds) => creds);
    mocks.markAccountUnavailable.mockResolvedValue({ shouldFallback: true });
  });

  it("(a) account1 throws TypeError mid-attempt → account2 is tried and answers OK", async () => {
    stubTwoAccounts();
    let calls = 0;
    mocks.handleChatCore.mockImplementation(async (args) => {
      calls += 1;
      if (calls === 1) {
        expect(args.connectionId).toBe(ACC_1);
        // Exactly what pipeWithDisconnect does on a 204 upstream body:
        throw new TypeError("providerResponse.body.pipeThrough is not a function");
      }
      expect(args.connectionId).toBe(ACC_2);
      return { success: true, response: new Response("ok", { status: 200 }) };
    });

    const response = await handleChat(chatRequest());
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
    expect(calls).toBe(2);
    // The throwing attempt's semaphore slot must be free again (finally still
    // runs; release must not be skipped because the loop continued).
    await expectSemaphoreFree(ACC_1);
  });

  it("(b) every account throws → current OpenAI-shaped 503, not a raw exception, no unhandled rejection", async () => {
    const unhandled = [];
    const onUnhandled = (err) => unhandled.push(err);
    process.on("unhandledRejection", onUnhandled);
    try {
      stubTwoAccounts();
      mocks.handleChatCore.mockImplementation(async () => {
        throw new TypeError("providerResponse.body.pipeThrough is not a function");
      });

      const response = await handleChat(chatRequest());
      // Same exhaustion shape the loop already uses (:302): errorResponse(503)
      expect(response.status).toBe(503);
      expect(response.headers.get("content-type")).toContain("application/json");
      const body = await response.json();
      expect(body.error).toBeTruthy();
      expect(body.error.message).toContain("pipeThrough");

      // The failure must be logged, not silently swallowed.
      const logged = [
        ...(log.warn.mock.calls || []),
        ...(log.error.mock.calls || []),
      ].flat().join("\n");
      expect(logged).toContain("pipeThrough");

      // Give any stray floating rejection a chance to surface.
      await sleep(50);
      expect(unhandled).toHaveLength(0);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("(b2) a throwing account is excluded from later requests (no infinite retry of the same one)", async () => {
    stubTwoAccounts();
    const seen = [];
    mocks.handleChatCore.mockImplementation(async (args) => {
      seen.push(args.connectionId);
      if (args.connectionId === ACC_1) throw new TypeError("boom");
      return { success: true, response: new Response("ok", { status: 200 }) };
    });
    await handleChat(chatRequest());
    await handleChat(chatRequest());
    // Second request may start at either account, but the loop never calls
    // the same account twice within one request after a throw.
    expect(seen.slice(0, 2)).toEqual([ACC_1, ACC_2]);
  });

  it("(RH4+probe) exception while HALF_OPEN settles the probe instead of stranding it", async () => {
    const name = buildAccountBreakerName({ provider: PROVIDER, connectionId: ACC_1, model: MODEL });
    await expireOpenBreakerToHalfOpen(name); // safety watchdog would otherwise take 2×40ms+
    stubTwoAccounts();
    mocks.handleChatCore.mockImplementation(async (args) => {
      if (args.connectionId === ACC_1) {
        expect(canExecute(name)).toBe(false); // probe already consumed by the loop
        throw new TypeError("no status code on this one");
      }
      return { success: true, response: new Response("ok", { status: 200 }) };
    });

    const response = await handleChat(chatRequest({ stream: true }));
    expect(response.status).toBe(200);

    const status = getCircuitBreaker(name).getStatus();
    expect(status.state).toBe(STATE.OPEN); // conservative failure, exactly once
    expect(isBlocked(name)).toBe(true);
  });

  it("(RH4+breaker) exception with a provider status counts once toward the breaker", async () => {
    const name = buildAccountBreakerName({ provider: PROVIDER, connectionId: ACC_1, model: MODEL });
    getCircuitBreaker(name, breakerOpts({ failureThreshold: 1 }));
    stubTwoAccounts();
    mocks.handleChatCore.mockImplementation(async (args) => {
      if (args.connectionId === ACC_1) {
        const err = new Error("upstream exploded");
        err.statusCode = 500;
        throw err;
      }
      return { success: true, response: new Response("ok", { status: 200 }) };
    });

    const response = await handleChat(chatRequest());
    expect(response.status).toBe(200);
    expect(isBlocked(name)).toBe(true); // threshold 1 → opened by the single failure
  });

  it("(RH4+closed) a no-status exception while CLOSED does not count as a provider failure", async () => {
    const name = buildAccountBreakerName({ provider: PROVIDER, connectionId: ACC_1, model: MODEL });
    getCircuitBreaker(name, breakerOpts({ failureThreshold: 1 }));
    stubTwoAccounts();
    mocks.handleChatCore.mockImplementation(async (args) => {
      if (args.connectionId === ACC_1) throw new TypeError("local pipe bug, not the provider");
      return { success: true, response: new Response("ok", { status: 200 }) };
    });

    await handleChat(chatRequest());
    const status = getCircuitBreaker(name).getStatus();
    expect(status.state).toBe(STATE.CLOSED);
    expect(status.failureCount).toBe(0);
  });
});

describe("F24b — RM7: one settle per request; pending stays exactly N up / N down", () => {
  let pending;

  beforeEach(() => {
    vi.clearAllMocks();
    resetAllCircuitBreakers();
    process.env.ACCOUNT_CAPACITY_WAIT_MS = "300";
    mocks.getSettings.mockResolvedValue({ requireApiKey: false });
    mocks.getModelInfo.mockResolvedValue({ provider: PROVIDER, model: MODEL });
    mocks.getComboModels.mockResolvedValue(null);
    mocks.checkAndRefreshToken.mockImplementation(async (_p, creds) => creds);
    mocks.markAccountUnavailable.mockResolvedValue({ shouldFallback: true });
    pending = mockChatCoreTracking();
  });

  it("(c1) success path: net pending 0, ups === downs", async () => {
    mocks.getProviderCredentials.mockImplementation(() => credentials(ACC_1));
    mocks.handleChatCore.mockImplementation(async (args) => {
      pending.trackPending(MODEL, PROVIDER, args.connectionId, true);
      pending.trackPending(MODEL, PROVIDER, args.connectionId, false); // trackDone
      return { success: true, response: new Response("ok", { status: 200 }) };
    });

    const response = await handleChat(chatRequest());
    expect(response.status).toBe(200);
    expect(pending.ledger.net).toBe(0);
    expect(pending.ledger.ups).toBe(pending.ledger.downs);
    expect(pending.ledger.ups).toBe(1);
  });

  it("(c2) error path (fallback to 2nd account): net pending 0", async () => {
    stubTwoAccounts();
    let calls = 0;
    mocks.handleChatCore.mockImplementation(async (args) => {
      calls += 1;
      pending.trackPending(MODEL, PROVIDER, args.connectionId, true);
      if (calls === 1) {
        pending.trackPending(MODEL, PROVIDER, args.connectionId, false, true);
        return { success: false, status: 500, error: "boom", response: new Response("boom", { status: 500 }) };
      }
      pending.trackPending(MODEL, PROVIDER, args.connectionId, false);
      return { success: true, response: new Response("ok", { status: 200 }) };
    });

    const response = await handleChat(chatRequest());
    expect(response.status).toBe(200);
    expect(pending.ledger.net).toBe(0);
    expect(pending.ledger.ups).toBe(2);
    expect(pending.ledger.downs).toBe(2);
  });

  it("(c3) abort path with racing callbacks: net pending 0 and semaphore released exactly once", async () => {
    mocks.getProviderCredentials.mockImplementation(() => credentials(ACC_1));
    const cb = streamingChatCoreMock({
      track: (...a) => pending.trackPending(...a),
    });

    const response = await handleChat(chatRequest({ stream: true }));
    expect(response.status).toBe(200);

    // Client aborts; then a LATE racing complete event (the flush-vs-drain
    // window). The lifecycle must settle once: one −1 total.
    cb.onDisconnect();
    cb.onStreamComplete();
    cb.onDisconnect();

    expect(pending.ledger.net).toBe(0);
    expect(pending.ledger.ups).toBe(1);
    expect(pending.ledger.downs).toBe(1);

    // chat.js must not react to the double callback by releasing its side of
    // the attempt twice (semaphore slot must be cleanly reusable).
    await expectSemaphoreFree(ACC_1);
    await expectSemaphoreFree(ACC_1);
  });

  it("(c4) exception path must not touch the pending counter at all", async () => {
    // The loop cannot know whether chatCore had already incremented when it
    // threw (translate throws BEFORE the +1 at chatCore.js:343; pipe throws
    // AFTER it). A blind compensating −1 here would steal another live
    // request's credit — the exact RM7 bug — so the catch must stay out of
    // the pending counter and leave the straggler to the PENDING_TIMEOUT
    // safeguard.
    stubTwoAccounts();
    let calls = 0;
    mocks.handleChatCore.mockImplementation(async (args) => {
      calls += 1;
      if (calls === 1) throw new TypeError("translateRequest blew up before any +1");
      pending.trackPending(MODEL, PROVIDER, args.connectionId, true);
      pending.trackPending(MODEL, PROVIDER, args.connectionId, false);
      return { success: true, response: new Response("ok", { status: 200 }) };
    });

    const response = await handleChat(chatRequest());
    expect(response.status).toBe(200);
    expect(pending.ledger.net).toBe(0);
    expect(pending.ledger.ups).toBe(1);
    expect(pending.ledger.downs).toBe(1);
  });
});
