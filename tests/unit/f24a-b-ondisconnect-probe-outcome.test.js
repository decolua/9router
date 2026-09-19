/**
 * F24a-b — RH1 (other half): a client abort during an SSE stream must settle
 * the HALF_OPEN probe immediately.
 *
 * The probe is consumed by canExecute(breakerName) in src/sse/handlers/chat.js
 * when the attempt starts; its outcome is normally recorded by
 * onStreamComplete (success) or the non-stream result path (failure/success).
 * An aborted stream reaches neither: streamHandler routes the abort to
 * onDisconnect, which historically only released the semaphore — leaving the
 * breaker in HALF_OPEN with no slots until the probe safety timer (2×
 * resetTimeout, F24a-1), which for chat.js-configured breakers is additionally
 * swallowed by the isFailure classifier (a bare Error has no statusCode).
 *
 * Fix contract: onDisconnect resolves the in-flight probe as a conservative
 * failure (breaker back to OPEN) via the new public settleProbe(name, reason),
 * and only when a probe is actually outstanding — CLOSED/DEGRADED disconnects
 * must never count (see the existing 499 rule in chat-account-resilience).
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
import * as breakerModule from "../../open-sse/utils/circuitBreaker.js";
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

const PROVIDER = "glm";
const MODEL = "glm-4";
const MODEL_STR = `${PROVIDER}/${MODEL}`;
const ACCOUNT_ID = "acc-f24b";

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

function credentials(overrides = {}) {
  return {
    apiKey: "test-key",
    connectionId: ACCOUNT_ID,
    connectionName: "F24b Acc",
    providerSpecificData: { maxConcurrency: 1 },
    ...overrides,
  };
}

/** Same shape as the options chat.js pins on a fresh breaker (incl. isFailure). */
function breakerOpts(overrides = {}) {
  return {
    failureThreshold: 5,
    resetTimeout: 30_000,
    failureWindowMs: 120_000,
    isFailure: (err) => shouldRecordBreakerFailure(err?.statusCode),
    ...overrides,
  };
}

/** Trip to OPEN with a chat.js-style breaker and let the (short) cooldown lapse. */
async function expireOpenBreaker(name, { resetTimeout = 40 } = {}) {
  getCircuitBreaker(name, breakerOpts({ failureThreshold: 1, resetTimeout }));
  recordFailure(name, { statusCode: 500 });
  expect(getCircuitBreaker(name).getStatus().state).toBe(STATE.OPEN);
  await sleep(resetTimeout + 20);
}

/** Mock chatCore as a started SSE stream; capture its lifecycle callbacks. */
function mockStreamingChatCore() {
  const captured = {};
  mocks.handleChatCore.mockImplementation(async (args) => {
    captured.onDisconnect = args.onDisconnect;
    captured.onStreamComplete = args.onStreamComplete;
    return {
      success: true,
      response: new Response("sse", {
        headers: { "Content-Type": "text/event-stream" },
      }),
    };
  });
  return captured;
}

describe("f24a-b onDisconnect settles the HALF_OPEN probe", () => {
  let warn;

  beforeEach(() => {
    vi.clearAllMocks();
    resetAllCircuitBreakers();
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.ACCOUNT_CAPACITY_WAIT_MS = "300";
    mocks.getSettings.mockResolvedValue({ requireApiKey: false });
    mocks.getModelInfo.mockResolvedValue({ provider: PROVIDER, model: MODEL });
    mocks.getComboModels.mockResolvedValue(null);
    mocks.checkAndRefreshToken.mockImplementation(async (_provider, creds) => creds);
    mocks.markAccountUnavailable.mockResolvedValue({ shouldFallback: true });
    mocks.getProviderCredentials.mockImplementation(() => credentials());
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it("client abort mid-stream settles the probe as a conservative failure (→ OPEN) immediately", async () => {
    const name = buildAccountBreakerName({ provider: PROVIDER, connectionId: ACCOUNT_ID, model: MODEL });
    await expireOpenBreaker(name); // safety budget = 2×40 = 80ms

    const cb = mockStreamingChatCore();
    const response = await handleChat(chatRequest({ stream: true }));
    expect(response.status).toBe(200);

    // canExecute() inside handleChat authorized AND consumed the probe.
    expect(getCircuitBreaker(name).getStatus().state).toBe(STATE.HALF_OPEN);
    expect(canExecute(name)).toBe(false); // no slot left: probe in flight

    cb.onDisconnect();

    // Fixed: the attempt is resolved synchronously — no safety-timer wait.
    expect(getCircuitBreaker(name).getStatus().state).toBe(STATE.OPEN);
    expect(isBlocked(name)).toBe(true);
    expect(canExecute(name)).toBe(false);
    expect(getCircuitBreaker(name).getStatus().retryAfterMs).toBeGreaterThan(0);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("[circuitBreaker] HALF_OPEN probe aborted"),
    );

    // The safety watchdog must be cancelled by the settle: past its budget
    // nothing may fire and the state must remain the settled OPEN.
    await sleep(150);
    expect(getCircuitBreaker(name).getStatus().state).toBe(STATE.OPEN);
    expect(warn.mock.calls.filter((c) => String(c[0]).includes("timed out"))).toHaveLength(0);
  }, 10_000);

  it("a disconnect while CLOSED must not count toward the breaker (client ≠ provider)", async () => {
    const name = buildAccountBreakerName({ provider: PROVIDER, connectionId: ACCOUNT_ID, model: MODEL });
    getCircuitBreaker(name, breakerOpts({ failureThreshold: 1 }));

    const cb = mockStreamingChatCore();
    await handleChat(chatRequest({ stream: true }));
    expect(getCircuitBreaker(name).getStatus().state).toBe(STATE.CLOSED);

    cb.onDisconnect();

    const status = getCircuitBreaker(name).getStatus();
    expect(status.state).toBe(STATE.CLOSED);
    expect(status.failureCount).toBe(0);
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining("[circuitBreaker]"));
  });

  it("onStreamComplete already resolved the probe → later disconnect is a no-op", async () => {
    const name = buildAccountBreakerName({ provider: PROVIDER, connectionId: ACCOUNT_ID, model: MODEL });
    await expireOpenBreaker(name);

    const cb = mockStreamingChatCore();
    await handleChat(chatRequest({ stream: true }));
    expect(getCircuitBreaker(name).getStatus().state).toBe(STATE.HALF_OPEN);

    cb.onStreamComplete(); // probe succeeded → CLOSED
    expect(getCircuitBreaker(name).getStatus().state).toBe(STATE.CLOSED);

    cb.onDisconnect(); // racing abort event after completion

    const status = getCircuitBreaker(name).getStatus();
    expect(status.state).toBe(STATE.CLOSED);
    expect(status.failureCount).toBe(0); // must NOT have settled as a failure
  });

  it("module API: settleProbe(name, reason) is exported and no-ops without an outstanding probe", async () => {
    const { settleProbe } = breakerModule;
    expect(typeof settleProbe).toBe("function");

    // Unknown breaker.
    expect(settleProbe("f24b:does-not-exist", "client disconnect")).toBe(false);

    // CLOSED breaker: nothing in flight, even with the chat.js isFailure config.
    const name = buildAccountBreakerName({ provider: PROVIDER, connectionId: "acc-api", model: MODEL });
    getCircuitBreaker(name, breakerOpts({ failureThreshold: 1 }));
    expect(settleProbe(name, "client disconnect")).toBe(false);
    expect(getCircuitBreaker(name).getStatus().state).toBe(STATE.CLOSED);

    // OPEN breaker: its reset timeout governs, not a stray abort.
    recordFailure(name, { statusCode: 500 });
    expect(getCircuitBreaker(name).getStatus().state).toBe(STATE.OPEN);
    expect(settleProbe(name, "client disconnect")).toBe(false);

    // HALF_OPEN probe in flight WITH isFailure configured: settles despite the
    // classifier (the error is synthetic — no provider status code).
    const name2 = buildAccountBreakerName({ provider: PROVIDER, connectionId: "acc-api2", model: MODEL });
    getCircuitBreaker(name2, breakerOpts({ failureThreshold: 1, resetTimeout: 1 }));
    recordFailure(name2, { statusCode: 500 });
    await sleep(10); // let the 1ms cooldown lapse
    expect(canExecute(name2)).toBe(true); // OPEN → HALF_OPEN, probe consumed
    expect(getCircuitBreaker(name2).getStatus().state).toBe(STATE.HALF_OPEN);
    expect(settleProbe(name2, "client disconnect")).toBe(true);
    expect(getCircuitBreaker(name2).getStatus().state).toBe(STATE.OPEN);
  });
});
