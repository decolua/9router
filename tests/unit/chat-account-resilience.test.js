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
  SemaphoreCapacityError,
} from "../../open-sse/services/accountSemaphore.js";

const PROVIDER = "glm";
const MODEL = "glm-4";
const MODEL_STR = `${PROVIDER}/${MODEL}`;
const ACCOUNT_ID = "acc-resilience";

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
    connectionName: "Resilience Acc",
    providerSpecificData: { maxConcurrency: 1 },
    ...overrides,
  };
}

function allRateLimited(overrides = {}) {
  return {
    allRateLimited: true,
    lastErrorCode: 503,
    lastError: "Unavailable",
    retryAfter: new Date(Date.now() + 30_000).toISOString(),
    retryAfterHuman: "reset after 30s",
    ...overrides,
  };
}

function breakerOpts(overrides = {}) {
  return {
    failureThreshold: 5,
    resetTimeout: 30_000,
    isFailure: (err) => shouldRecordBreakerFailure(err?.statusCode),
    ...overrides,
  };
}

async function expireOpenBreaker(name, { resetTimeout = 40 } = {}) {
  getCircuitBreaker(name, breakerOpts({ failureThreshold: 1, resetTimeout }));
  recordFailure(name, { statusCode: 500 });
  await new Promise((r) => setTimeout(r, resetTimeout + 10));
}

describe("handleChat account resilience", () => {
  const originalCapacityWait = process.env.ACCOUNT_CAPACITY_WAIT_MS;
  afterEach(() => {
    if (originalCapacityWait === undefined) delete process.env.ACCOUNT_CAPACITY_WAIT_MS;
    else process.env.ACCOUNT_CAPACITY_WAIT_MS = originalCapacityWait;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    resetAllCircuitBreakers();
    // Keep the last-account wait short; tests that care about it set their own.
    process.env.ACCOUNT_CAPACITY_WAIT_MS = "300";
    mocks.getSettings.mockResolvedValue({ requireApiKey: false });
    mocks.getModelInfo.mockResolvedValue({ provider: PROVIDER, model: MODEL });
    mocks.getComboModels.mockResolvedValue(null);
    mocks.checkAndRefreshToken.mockImplementation(async (_provider, creds) => creds);
    mocks.markAccountUnavailable.mockResolvedValue({ shouldFallback: true });
    mocks.getProviderCredentials.mockImplementation(async (_provider, exclude) => {
      if (exclude instanceof Set && exclude.has(ACCOUNT_ID)) return allRateLimited();
      return credentials();
    });
  });

  it("records 5xx toward the breaker and does not count 429", async () => {
    const name = buildAccountBreakerName({ provider: PROVIDER, connectionId: ACCOUNT_ID, model: MODEL });
    expect(shouldRecordBreakerFailure(500)).toBe(true);
    expect(shouldRecordBreakerFailure(429)).toBe(false);

    getCircuitBreaker(name, {
      failureThreshold: 5,
      resetTimeout: 30_000,
      isFailure: (err) => shouldRecordBreakerFailure(err?.statusCode),
    });
    for (let i = 0; i < 4; i++) recordFailure(name, { statusCode: 500 });

    mocks.handleChatCore.mockResolvedValue({
      success: false,
      status: 429,
      error: "rate limited",
      response: new Response("rl", { status: 429 }),
    });
    await handleChat(chatRequest());
    expect(isBlocked(name)).toBe(false);
    expect(canExecute(name)).toBe(true);

    mocks.handleChatCore.mockResolvedValue({
      success: false,
      status: 500,
      error: "upstream 500",
      response: new Response("boom", { status: 500 }),
    });
    await handleChat(chatRequest());
    expect(isBlocked(name)).toBe(true);
    expect(canExecute(name)).toBe(false);
  });

  it("holds the semaphore until onStreamComplete", async () => {
    let capturedOnStreamComplete;
    mocks.handleChatCore.mockImplementation(async (args) => {
      capturedOnStreamComplete = args.onStreamComplete;
      return {
        success: true,
        response: new Response("sse", {
          headers: { "Content-Type": "text/event-stream" },
        }),
      };
    });

    const response = await handleChat(chatRequest({ stream: true }));
    expect(response.status).toBe(200);
    expect(typeof capturedOnStreamComplete).toBe("function");

    const key = resolveAccountSemaphoreKey({
      provider: PROVIDER,
      connectionId: ACCOUNT_ID,
    });
    await expect(
      acquire(key, { maxConcurrency: 1, timeoutMs: 50 }),
    ).rejects.toThrow(SemaphoreCapacityError);

    capturedOnStreamComplete();

    const release = await acquire(key, { maxConcurrency: 1, timeoutMs: 50 });
    expect(typeof release).toBe("function");
    release();
  });

  it("releases immediately when stream:true but the response is JSON", async () => {
    mocks.handleChatCore.mockResolvedValue({
      success: true,
      response: new Response("{}", {
        headers: { "content-type": "application/json" },
      }),
    });

    const response = await handleChat(chatRequest({ stream: true }));
    expect(response.status).toBe(200);

    const key = resolveAccountSemaphoreKey({
      provider: PROVIDER,
      connectionId: ACCOUNT_ID,
    });
    const release = await acquire(key, { maxConcurrency: 1, timeoutMs: 50 });
    expect(typeof release).toBe("function");
    release();
  });

  it("returns 503 when remaining accounts are circuit-open even if lastStatus is 401", async () => {
    mocks.handleChatCore.mockResolvedValue({
      success: false,
      status: 401,
      error: "unauthorized",
      response: new Response("no", { status: 401 }),
    });
    mocks.getProviderCredentials
      .mockResolvedValueOnce(credentials())
      .mockResolvedValueOnce(allRateLimited({ lastErrorCode: 503 }));

    const response = await handleChat(chatRequest());
    expect(response.status).toBe(503);
  });

  it("returns 503 when no credentials remain after excludes even if lastStatus is 401", async () => {
    mocks.handleChatCore.mockResolvedValue({
      success: false,
      status: 401,
      error: "unauthorized",
      response: new Response("no", { status: 401 }),
    });
    mocks.getProviderCredentials
      .mockResolvedValueOnce(credentials())
      .mockResolvedValueOnce(null);

    const response = await handleChat(chatRequest());
    expect(response.status).toBe(503);
  });

  it("does not create a breaker for noauth (missing connectionId)", async () => {
    mocks.getProviderCredentials.mockResolvedValue({
      accessToken: "public",
      connectionName: "Public",
    });
    mocks.markAccountUnavailable.mockResolvedValue({ shouldFallback: false });
    mocks.handleChatCore.mockResolvedValue({
      success: false,
      status: 500,
      error: "upstream 500",
      response: new Response("boom", { status: 500 }),
    });

    await handleChat(chatRequest());

    expect(getCircuitBreaker(`${PROVIDER}:undefined`)).toBe(null);
    expect(getCircuitBreaker(`${PROVIDER}:noauth`)).toBe(null);
    expect(mocks.handleChatCore).toHaveBeenCalled();
  });

  it("does not consume a HALF_OPEN probe when acquire times out", async () => {
    const name = buildAccountBreakerName({ provider: PROVIDER, connectionId: ACCOUNT_ID, model: MODEL });
    await expireOpenBreaker(name);

    const key = resolveAccountSemaphoreKey({
      provider: PROVIDER,
      connectionId: ACCOUNT_ID,
    });
    const held = await acquire(key, { maxConcurrency: 1 });
    mocks.handleChatCore.mockImplementation(async () => {
      throw new Error("HALF_OPEN probe must not run before a real upstream attempt");
    });

    try {
      const response = await handleChat(chatRequest());
      expect(response.status).toBe(503);
      expect(mocks.handleChatCore).not.toHaveBeenCalled();
      expect(canExecute(name)).toBe(true);
    } finally {
      held();
    }
  }, 10_000);

  it.each([401, 403, 429])(
    "records HALF_OPEN %s as success so the probe is not stuck",
    async (status) => {
      const name = buildAccountBreakerName({ provider: PROVIDER, connectionId: ACCOUNT_ID, model: MODEL });
      await expireOpenBreaker(name);

      mocks.handleChatCore.mockResolvedValue({
        success: false,
        status,
        error: `upstream ${status}`,
        response: new Response("no", { status }),
      });

      await handleChat(chatRequest());

      const breaker = getCircuitBreaker(name);
      expect(breaker.getStatus().state).toBe(STATE.CLOSED);
      expect(canExecute(name)).toBe(true);
      expect(isBlocked(name)).toBe(false);
    },
  );

  it("re-opens the breaker when a HALF_OPEN probe returns 5xx", async () => {
    const name = buildAccountBreakerName({ provider: PROVIDER, connectionId: ACCOUNT_ID, model: MODEL });
    await expireOpenBreaker(name);

    mocks.handleChatCore.mockResolvedValue({
      success: false,
      status: 500,
      error: "upstream 500",
      response: new Response("boom", { status: 500 }),
    });

    await handleChat(chatRequest());

    expect(getCircuitBreaker(name).getStatus().state).toBe(STATE.OPEN);
    expect(isBlocked(name)).toBe(true);
    expect(canExecute(name)).toBe(false);
  });

  it("records 408 timeout toward the breaker", async () => {
    const name = buildAccountBreakerName({ provider: PROVIDER, connectionId: ACCOUNT_ID, model: MODEL });
    getCircuitBreaker(name, breakerOpts());
    for (let i = 0; i < 4; i++) recordFailure(name, { statusCode: 500 });

    mocks.handleChatCore.mockResolvedValue({
      success: false,
      status: 408,
      error: "Request timeout",
      response: new Response("timeout", { status: 408 }),
    });
    await handleChat(chatRequest());
    expect(isBlocked(name)).toBe(true);
    expect(canExecute(name)).toBe(false);
  });

  it("does not count a client abort 499 toward the breaker", async () => {
    const name = buildAccountBreakerName({ provider: PROVIDER, connectionId: ACCOUNT_ID, model: MODEL });
    getCircuitBreaker(name, breakerOpts({ failureThreshold: 1 }));

    mocks.handleChatCore.mockResolvedValue({
      success: false,
      status: 499,
      error: "Request aborted",
      response: new Response("aborted", { status: 499 }),
    });
    await handleChat(chatRequest());
    expect(isBlocked(name)).toBe(false);
    expect(canExecute(name)).toBe(true);
  });

  it("holds the semaphore when Content-Type is TEXT/EVENT-STREAM", async () => {
    let capturedOnStreamComplete;
    mocks.handleChatCore.mockImplementation(async (args) => {
      capturedOnStreamComplete = args.onStreamComplete;
      return {
        success: true,
        response: new Response("sse", {
          headers: { "Content-Type": "TEXT/EVENT-STREAM" },
        }),
      };
    });

    const response = await handleChat(chatRequest({ stream: true }));
    expect(response.status).toBe(200);

    const key = resolveAccountSemaphoreKey({
      provider: PROVIDER,
      connectionId: ACCOUNT_ID,
    });
    await expect(
      acquire(key, { maxConcurrency: 1, timeoutMs: 50 }),
    ).rejects.toThrow(SemaphoreCapacityError);

    capturedOnStreamComplete();
    const release = await acquire(key, { maxConcurrency: 1, timeoutMs: 50 });
    release();
  });

  // ── Capacity is not unavailability ────────────────────────────────────────
  // Regression: with ONE account and the concurrency gate full, the gateway
  // answered "All accounts unavailable" in exactly 2.0s without ever calling
  // the provider. Observed in production: the account was healthy, upstream
  // answered 6/6 when called directly, and requests legitimately hold a slot
  // for ~50s (median measured), so the gate was full nearly all the time.
  it("waits for a slot instead of declaring the only account unavailable", async () => {
    process.env.ACCOUNT_CAPACITY_WAIT_MS = "4000";
    mocks.getProviderCredentials.mockImplementation(async (_provider, exclude) => {
      if (exclude instanceof Set && exclude.has(ACCOUNT_ID)) return null; // no other account
      return credentials();
    });
    mocks.handleChatCore.mockResolvedValue({
      success: true,
      response: new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    });

    const key = resolveAccountSemaphoreKey({ provider: PROVIDER, connectionId: ACCOUNT_ID });
    const held = await acquire(key, { maxConcurrency: 1 });
    // Freed after the short probe window but well inside the wait budget —
    // exactly the shape of a long upstream call finishing.
    const freeAt = setTimeout(held, 2300);

    try {
      const started = Date.now();
      const response = await handleChat(chatRequest());
      const elapsed = Date.now() - started;

      expect(response.status).toBe(200);
      expect(mocks.handleChatCore).toHaveBeenCalledTimes(1);
      expect(elapsed, "must have waited past the probe window").toBeGreaterThan(2000);
    } finally {
      clearTimeout(freeAt);
      held();
    }
  }, 15_000);

  it("reports a capacity failure as capacity, not as unavailable accounts", async () => {
    mocks.getProviderCredentials.mockImplementation(async (_provider, exclude) => {
      if (exclude instanceof Set && exclude.has(ACCOUNT_ID)) return null;
      return credentials();
    });

    const key = resolveAccountSemaphoreKey({ provider: PROVIDER, connectionId: ACCOUNT_ID });
    const held = await acquire(key, { maxConcurrency: 1 });
    try {
      const response = await handleChat(chatRequest());
      const body = await response.json();
      const message = body?.error?.message || "";

      expect(response.status).toBe(503);
      expect(message, "must name the real cause").toMatch(/at capacity/i);
      expect(message).not.toMatch(/All accounts unavailable/i);
      expect(mocks.handleChatCore, "the provider must not be blamed for a local throttle").not.toHaveBeenCalled();
    } finally {
      held();
    }
  }, 15_000);

  it("still spreads load: a full account falls to the next one instead of waiting", async () => {
    const SECOND_ID = "acc-second";
    process.env.ACCOUNT_CAPACITY_WAIT_MS = "30000"; // must NOT be reached
    mocks.getProviderCredentials.mockImplementation(async (_provider, exclude) => {
      const excluded = exclude instanceof Set ? exclude : new Set();
      if (!excluded.has(ACCOUNT_ID)) return credentials();
      if (!excluded.has(SECOND_ID)) {
        return credentials({ connectionId: SECOND_ID, connectionName: "Second Acc" });
      }
      return null;
    });
    mocks.handleChatCore.mockResolvedValue({
      success: true,
      response: new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    });

    const key = resolveAccountSemaphoreKey({ provider: PROVIDER, connectionId: ACCOUNT_ID });
    const held = await acquire(key, { maxConcurrency: 1 });
    try {
      const started = Date.now();
      const response = await handleChat(chatRequest());
      const elapsed = Date.now() - started;

      expect(response.status).toBe(200);
      expect(mocks.handleChatCore).toHaveBeenCalledTimes(1);
      expect(mocks.handleChatCore.mock.calls[0][0].connectionId).toBe(SECOND_ID);
      expect(elapsed, "must not sit on the long wait while another account is free").toBeLessThan(10_000);
    } finally {
      held();
    }
  }, 20_000);
});
