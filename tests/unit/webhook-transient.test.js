/**
 * Task 9 RED — opt-in account/token transient instrumentation.
 *
 * Locked production seam (documented here for GREEN):
 *
 *   src/sse/services/webhookTransient.js   (app-side helper, may import events)
 *     emitAccountUnavailable(data)         -> { ok, emitted, reason }
 *     emitTokenRefreshFailed(data)         -> { ok, emitted, reason }
 *
 *   - Uses the real `@/lib/webhooks/events.js` sink (`setWebhookSink`).
 *   - Never applies `defaultSubscribed` filtering; subscriptions belong to the
 *     outbox. It only sanitizes scalar metadata and dedups identical
 *     `type|provider|connectionId` fingerprints with bounded, expiring state.
 *   - Sink/callback failures never alter the caller's control flow.
 *
 * Call sites:
 *   - `markAccountUnavailable()` emits `account.unavailable` AFTER the DB state
 *     mutation, never from a console/log line.
 *   - `refreshWithRetry(fn, maxRetries, log, { onExhausted })` calls
 *     `onExhausted` once only after every attempt failed. The engine callback
 *     stays app/DB-free.
 *   - `handleChatCore({ ..., onRefreshFailure })` invokes the optional callback
 *     once when a 401/403 token refresh is exhausted.
 *   - Background refresh, quota auto-ping, src token refresh and the
 *     Antigravity quota refresh emit `token.refresh_failed` only on terminal
 *     per-connection refresh failure. A generic tick exception without a
 *     connection is NOT a per-connection failure.
 *
 * RED until the helper and the call-site wiring exist. No target/provider
 * execution: every external dependency is a module mock; only the events sink
 * is real.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setWebhookSink } from "@/lib/webhooks/events.js";
import { WEBHOOK_ERROR_CLASSES } from "@/shared/constants/webhooks.js";

const mocks = vi.hoisted(() => {
  const log = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  return {
    log,
    localDb: {
      getProviderConnections: vi.fn(),
      getProviderConnectionById: vi.fn(),
      validateApiKey: vi.fn(),
      updateProviderConnection: vi.fn(),
      getSettings: vi.fn(),
      getProxyPools: vi.fn(),
    },
    connectionProxy: {
      resolveConnectionProxyConfig: vi.fn(),
      pickProxyPoolId: vi.fn(),
    },
    accountFallback: {
      formatRetryAfter: vi.fn(),
      checkFallbackError: vi.fn(),
      isModelLockActive: vi.fn(),
      buildModelLockUpdate: vi.fn(),
      getEarliestModelLockUntil: vi.fn(),
    },
    googleUsage: { getAntigravityUsage: vi.fn() },
    claudeUsage: { getClaudeUsage: vi.fn() },
    codexUsage: { getCodexUsage: vi.fn() },
    oauthManager: {
      refreshProviderCredentials: vi.fn(),
      shouldRefreshCredentials: vi.fn(),
      getCredentialExpiryMs: vi.fn(),
    },
    projectId: {
      getProjectIdForConnection: vi.fn(),
      invalidateProjectId: vi.fn(),
      removeConnection: vi.fn(),
    },
    usageDb: {
      appendRequestLog: vi.fn(),
      saveRequestDetail: vi.fn(),
      saveRequestUsage: vi.fn(),
      trackPendingRequest: vi.fn(),
    },
    executors: { getExecutor: vi.fn() },
    requestLogger: { createRequestLogger: vi.fn() },
    usageRoute: { refreshAndUpdateCredentials: vi.fn() },
    proxyFetch: { proxyAwareFetch: vi.fn() },
  };
});

vi.mock("@/lib/localDb", () => mocks.localDb);
vi.mock("@/lib/localDb.js", () => mocks.localDb);
vi.mock("@/lib/network/connectionProxy", () => mocks.connectionProxy);
vi.mock("open-sse/services/accountFallback.js", () => mocks.accountFallback);
vi.mock("@/sse/utils/logger.js", () => mocks.log);
vi.mock("open-sse/services/usage/google.js", () => mocks.googleUsage);
vi.mock("open-sse/services/usage/claude.js", () => mocks.claudeUsage);
vi.mock("open-sse/services/usage/codex.js", () => mocks.codexUsage);
vi.mock("open-sse/services/oauthCredentialManager.js", () => mocks.oauthManager);
vi.mock("open-sse/services/projectId.js", () => mocks.projectId);
vi.mock("@/lib/usageDb.js", () => mocks.usageDb);
vi.mock("open-sse/executors/index.js", () => mocks.executors);
vi.mock("open-sse/utils/requestLogger.js", () => mocks.requestLogger);
vi.mock("@/app/api/usage/[connectionId]/route.js", () => mocks.usageRoute);
vi.mock("open-sse/utils/proxyFetch.js", () => mocks.proxyFetch);
vi.mock("open-sse/index.js", () => ({}));

const { markAccountUnavailable } = await import("@/sse/services/auth.js");
const { refreshWithRetry } = await import("open-sse/services/tokenRefresh.js");
const { checkAndRefreshToken } = await import("@/sse/services/tokenRefresh.js");
const { runBackgroundTokenRefreshTick } = await import("@/sse/services/backgroundTokenRefresh.js");
const { runQuotaAutoPingTick } = await import("@/shared/services/quotaAutoPing.js");
const { refreshAntigravityQuota } = await import("@/sse/services/antigravityQuota.js");
const { handleChatCore } = await import("open-sse/handlers/chatCore.js");
const { runWithWebhookContext } = await import("@/lib/webhooks/events.js");

const REQUEST_ID = "req_9a4d1c62-83e0-4b17-a2c5-6e8f01d4b7a9";

const makeSink = () => {
  const events = [];
  setWebhookSink((event) => events.push(event));
  return events;
};

const makeThrowingSink = () => {
  setWebhookSink(() => {
    throw new Error("sink boom");
  });
};

const ofType = (events, type) => events.filter((event) => event.type === type);

const makeLog = () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  line: vi.fn(),
  errorLine: vi.fn(),
  tagForSession: () => "T9",
  nextTag: () => "T9",
});

beforeEach(() => {
  vi.resetAllMocks();

  mocks.connectionProxy.resolveConnectionProxyConfig.mockResolvedValue({});
  mocks.connectionProxy.pickProxyPoolId.mockReturnValue(null);
  mocks.accountFallback.isModelLockActive.mockReturnValue(false);
  mocks.accountFallback.getEarliestModelLockUntil.mockReturnValue(null);
  mocks.accountFallback.formatRetryAfter.mockReturnValue("in a moment");
  mocks.oauthManager.shouldRefreshCredentials.mockReturnValue(true);
  mocks.oauthManager.getCredentialExpiryMs.mockImplementation((credentials) => {
    const parsed = Date.parse(credentials?.expiresAt ?? credentials?.tokenExpiresAt);
    return Number.isFinite(parsed) ? parsed : null;
  });
  mocks.usageDb.appendRequestLog.mockResolvedValue(undefined);
  mocks.usageDb.saveRequestDetail.mockResolvedValue(undefined);
  mocks.usageDb.saveRequestUsage.mockResolvedValue(undefined);
  mocks.requestLogger.createRequestLogger.mockResolvedValue({
    logClientRawRequest: vi.fn(),
    logRawRequest: vi.fn(),
    logTargetRequest: vi.fn(),
    logError: vi.fn(),
  });
  mocks.localDb.updateProviderConnection.mockResolvedValue(true);
  mocks.localDb.getProviderConnectionById.mockResolvedValue(null);

  setWebhookSink(null);
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env.BG_REFRESH_DELAY_MS;
  delete process.env.BG_REFRESH_GOOGLE_DELAY_MS;
  setWebhookSink(null);
});

// ─────────────────────────────────────────────────────────────────────────────
// Shared transient emitter helper
// ─────────────────────────────────────────────────────────────────────────────

describe("transient webhook helper: opt-in, sanitized, deduped", () => {
  it("emits warning transients through the real sink without default-subscription filtering", async () => {
    const { emitAccountUnavailable, emitTokenRefreshFailed } =
      await import("@/sse/services/webhookTransient.js");
    const events = makeSink();

    const account = emitAccountUnavailable({
      provider: "openai",
      model: "gpt-4o-mini",
      connectionId: "conn-helper-1",
      statusCode: 429,
      errorClass: "upstream_http",
    });
    const token = emitTokenRefreshFailed({
      provider: "openai",
      connectionId: "conn-helper-2",
      errorClass: "refresh_failed",
    });

    expect(account.emitted).toBe(true);
    expect(token.emitted).toBe(true);
    expect(events.map((event) => event.type)).toEqual([
      "account.unavailable",
      "token.refresh_failed",
    ]);
    expect(events.every((event) => event.severity === "warning")).toBe(true);
    // These two types are defaultSubscribed:false in the catalog. Filtering is
    // the outbox's job, so the emitter must still hand them to the sink.
    expect(events).toHaveLength(2);
  });

  it("dedups the same type|provider|connectionId fingerprint and keeps distinct ones", async () => {
    const { emitAccountUnavailable, emitTokenRefreshFailed } =
      await import("@/sse/services/webhookTransient.js");
    const events = makeSink();

    const first = emitTokenRefreshFailed({
      provider: "cx",
      connectionId: "conn-dedup-1",
      errorClass: "refresh_failed",
    });
    const second = emitTokenRefreshFailed({
      provider: "cx",
      connectionId: "conn-dedup-1",
      errorClass: "refresh_failed",
    });
    emitTokenRefreshFailed({
      provider: "cx",
      connectionId: "conn-dedup-2",
      errorClass: "refresh_failed",
    });
    emitAccountUnavailable({
      provider: "cx",
      connectionId: "conn-dedup-1",
      statusCode: 429,
      errorClass: "upstream_http",
    });

    expect(first.emitted).toBe(true);
    expect(second.emitted).toBe(false);
    expect(ofType(events, "token.refresh_failed")).toHaveLength(2);
    expect(ofType(events, "account.unavailable")).toHaveLength(1);
  });

  it("isolates a throwing sink so callers never see the callback error", async () => {
    const { emitAccountUnavailable } = await import("@/sse/services/webhookTransient.js");
    makeThrowingSink();

    let result;
    expect(() => {
      result = emitAccountUnavailable({
        provider: "openai",
        connectionId: "conn-helper-throw",
        statusCode: 429,
        errorClass: "upstream_http",
      });
    }).not.toThrow();
    expect(result).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// auth.markAccountUnavailable
// ─────────────────────────────────────────────────────────────────────────────

describe("auth.markAccountUnavailable: account.unavailable after state mutation", () => {
  const arrangeFallback = ({
    connectionId = "conn-auth-1",
    shouldFallback = true,
    cooldownMs = 60000,
  } = {}) => {
    mocks.localDb.getProviderConnections.mockResolvedValue([
      { id: connectionId, backoffLevel: 0, displayName: "Acme", name: "acme" },
    ]);
    mocks.accountFallback.checkFallbackError.mockReturnValue({
      shouldFallback,
      cooldownMs,
      newBackoffLevel: 1,
    });
    mocks.accountFallback.buildModelLockUpdate.mockReturnValue({
      modelLock_gpt4o: new Date(Date.now() + cooldownMs).toISOString(),
    });
  };

  it.each([401, 429])("emits one warning transient for a %i cooldown and no final event", async (status) => {
    const connectionId = `conn-auth-${status}`;
    arrangeFallback({ connectionId });
    const events = makeSink();

    const result = await markAccountUnavailable(
      connectionId,
      status,
      "upstream said no (raw-secret-token)",
      "openai",
      "gpt4o",
    );

    expect(result).toEqual({ shouldFallback: true, cooldownMs: 60000 });
    const accountEvents = ofType(events, "account.unavailable");
    expect(accountEvents).toHaveLength(1);
    expect(events.map((event) => event.type)).toEqual(["account.unavailable"]);
    expect(ofType(events, "request.failed")).toHaveLength(0);
    expect(accountEvents[0].severity).toBe("warning");
    expect(accountEvents[0].data).toMatchObject({
      provider: "openai",
      model: "gpt4o",
      connectionId,
      statusCode: status,
      errorClass: "upstream_http",
    });
    expect(WEBHOOK_ERROR_CLASSES).toContain(accountEvents[0].data.errorClass);
    // Provenance: only the scalar allowlist, no requestId without a request context.
    expect(Object.keys(accountEvents[0].data).sort()).toEqual([
      "connectionId",
      "errorClass",
      "model",
      "provider",
      "statusCode",
    ]);
    // Raw upstream text never reaches the payload.
    expect(JSON.stringify(accountEvents[0])).not.toContain("raw-secret-token");
  });

  it("emits only after the provider connection state has actually been mutated", async () => {
    arrangeFallback({ connectionId: "conn-auth-order" });
    const mutationOrder = [];
    mocks.localDb.updateProviderConnection.mockImplementation(async () => {
      mutationOrder.push("mutation");
      return true;
    });
    setWebhookSink((event) => {
      mutationOrder.push(`emit:${event.type}`);
    });

    await markAccountUnavailable("conn-auth-order", 429, "rate limited", "openai", "gpt4o");

    expect(mutationOrder).toEqual(["mutation", "emit:account.unavailable"]);
  });

  it("does not emit when the provider connection mutation itself fails", async () => {
    arrangeFallback({ connectionId: "conn-auth-dbfail" });
    const events = makeSink();
    mocks.localDb.updateProviderConnection.mockRejectedValue(new Error("db write failed"));

    await expect(
      markAccountUnavailable("conn-auth-dbfail", 429, "rate limited", "openai", "gpt4o"),
    ).rejects.toThrow("db write failed");
    expect(events).toHaveLength(0);
  });

  it("does not emit when the status is not a terminal account cooldown", async () => {
    arrangeFallback({ connectionId: "conn-auth-nofallback", shouldFallback: false, cooldownMs: 0 });
    const events = makeSink();

    const result = await markAccountUnavailable(
      "conn-auth-nofallback",
      400,
      "bad request",
      "openai",
      "gpt4o",
    );

    expect(result).toEqual({ shouldFallback: false, cooldownMs: 0 });
    expect(events).toHaveLength(0);
    expect(mocks.localDb.updateProviderConnection).not.toHaveBeenCalled();
  });

  it("keeps the fallback outcome unchanged when the transient callback throws", async () => {
    arrangeFallback({ connectionId: "conn-auth-throw" });
    makeThrowingSink();

    const result = await markAccountUnavailable(
      "conn-auth-throw",
      429,
      "rate limited",
      "openai",
      "gpt4o",
    );

    expect(result).toEqual({ shouldFallback: true, cooldownMs: 60000 });
    expect(mocks.localDb.updateProviderConnection).toHaveBeenCalledTimes(1);
  });

  it("stays silent and does not throw when no sink is configured", async () => {
    arrangeFallback({ connectionId: "conn-auth-nosink" });
    setWebhookSink(null);

    await expect(
      markAccountUnavailable("conn-auth-nosink", 429, "rate limited", "openai", "gpt4o"),
    ).resolves.toEqual({ shouldFallback: true, cooldownMs: 60000 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Engine retry seam
// ─────────────────────────────────────────────────────────────────────────────

describe("refreshWithRetry: exhaust-only callback", () => {
  it("does not call onExhausted when a later retry succeeds", async () => {
    const onExhausted = vi.fn();
    const refreshFn = vi
      .fn()
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValueOnce({ accessToken: "fresh" });

    const result = await refreshWithRetry(refreshFn, 2, makeLog(), { onExhausted });

    expect(result).toEqual({ accessToken: "fresh" });
    expect(refreshFn).toHaveBeenCalledTimes(2);
    expect(onExhausted).not.toHaveBeenCalled();
  });

  it("calls onExhausted exactly once after every attempt fails", async () => {
    const onExhausted = vi.fn();
    const refreshFn = vi.fn().mockResolvedValue(null);

    const result = await refreshWithRetry(refreshFn, 1, makeLog(), { onExhausted });

    expect(result).toBeNull();
    expect(onExhausted).toHaveBeenCalledTimes(1);
  });

  it("isolates a throwing onExhausted callback and still returns null", async () => {
    const onExhausted = vi.fn(() => {
      throw new Error("callback boom");
    });

    await expect(
      refreshWithRetry(async () => null, 1, makeLog(), { onExhausted }),
    ).resolves.toBeNull();
    expect(onExhausted).toHaveBeenCalledTimes(1);
  });

  it("absorbs a rejected async onExhausted callback without an unhandled rejection", async () => {
    const unhandled = [];
    const onUnhandled = (reason) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      const onExhausted = vi.fn(() => Promise.reject(new Error("async callback boom")));

      await expect(
        refreshWithRetry(async () => null, 1, makeLog(), { onExhausted }),
      ).resolves.toBeNull();
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(onExhausted).toHaveBeenCalledTimes(1);
      expect(unhandled).toHaveLength(0);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("preserves the legacy 3-argument behavior", async () => {
    await expect(refreshWithRetry(async () => null, 1, makeLog())).resolves.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// chatCore refresh branch
// ─────────────────────────────────────────────────────────────────────────────

const makeChatExecutor = () => {
  const executor = {
    noAuth: false,
    execute: vi.fn(),
    refreshCredentials: vi.fn(),
    parseError: vi.fn(() => null),
  };
  mocks.executors.getExecutor.mockReturnValue(executor);
  return executor;
};

const unauthorizedResponse = () =>
  new Response(JSON.stringify({ error: { message: "unauthorized" } }), {
    status: 401,
    headers: { "content-type": "application/json" },
  });

const chatArgs = (overrides = {}) => ({
  body: {
    model: "gpt-4o-mini",
    stream: false,
    messages: [{ role: "user", content: "hello" }],
  },
  modelInfo: { provider: "openai", model: "gpt-4o-mini" },
  credentials: {
    accessToken: "access",
    refreshToken: "refresh",
    connectionId: "conn-req-1",
    providerSpecificData: {},
  },
  log: makeLog(),
  sourceFormatOverride: "openai",
  clientRawRequest: { headers: {}, body: {} },
  ...overrides,
});

describe("chatCore: exhausted refresh threads one optional callback", () => {
  it("calls onRefreshFailure once with safe metadata and keeps the upstream error result", async () => {
    const executor = makeChatExecutor();
    executor.execute.mockResolvedValue({
      response: unauthorizedResponse(),
      url: "https://api.example.test/v1/chat/completions",
      headers: {},
    });
    executor.refreshCredentials.mockRejectedValue(new Error("invalid_grant"));
    const onRefreshFailure = vi.fn();

    const result = await handleChatCore(
      chatArgs({
        onRefreshFailure,
        credentials: {
          accessToken: "access",
          refreshToken: "raw-refresh-secret",
          connectionId: "conn-req-1",
          providerSpecificData: {},
        },
      }),
    );

    expect(result.success).toBe(false);
    expect(result.status).toBe(401);
    expect(onRefreshFailure).toHaveBeenCalledTimes(1);
    const payload = onRefreshFailure.mock.calls[0][0];
    expect(payload).toMatchObject({
      provider: "openai",
      model: "gpt-4o-mini",
      connectionId: "conn-req-1",
    });
    expect(JSON.stringify(payload)).not.toContain("raw-refresh-secret");
  }, 15000);

  it("prefers an explicit handleChatCore connectionId over credentials when both exist", async () => {
    const executor = makeChatExecutor();
    executor.execute.mockResolvedValue({
      response: unauthorizedResponse(),
      url: "https://api.example.test/v1/chat/completions",
      headers: {},
    });
    executor.refreshCredentials.mockRejectedValue(new Error("invalid_grant"));
    const onRefreshFailure = vi.fn();

    const result = await handleChatCore(
      chatArgs({ onRefreshFailure, connectionId: "conn-explicit" }),
    );

    expect(result.success).toBe(false);
    expect(result.status).toBe(401);
    expect(onRefreshFailure).toHaveBeenCalledTimes(1);
    expect(onRefreshFailure.mock.calls[0][0]).toMatchObject({
      provider: "openai",
      model: "gpt-4o-mini",
      connectionId: "conn-explicit",
    });
  }, 15000);

  it("does not call onRefreshFailure when the refresh eventually succeeds", async () => {
    const executor = makeChatExecutor();
    executor.execute
      .mockResolvedValueOnce({
        response: unauthorizedResponse(),
        url: "https://api.example.test/v1/chat/completions",
        headers: {},
      })
      .mockRejectedValueOnce(new Error("retry network down"));
    executor.refreshCredentials
      .mockRejectedValueOnce(new Error("transient refresh"))
      .mockResolvedValueOnce({ accessToken: "fresh" });
    const onRefreshFailure = vi.fn();

    const result = await handleChatCore(chatArgs({ onRefreshFailure }));

    expect(result.success).toBe(false);
    expect(onRefreshFailure).not.toHaveBeenCalled();
  }, 15000);

  it("keeps the unchanged error result when onRefreshFailure throws", async () => {
    const executor = makeChatExecutor();
    executor.execute.mockResolvedValue({
      response: unauthorizedResponse(),
      url: "https://api.example.test/v1/chat/completions",
      headers: {},
    });
    executor.refreshCredentials.mockRejectedValue(new Error("invalid_grant"));

    const result = await handleChatCore(
      chatArgs({
        onRefreshFailure: () => {
          throw new Error("callback boom");
        },
      }),
    );

    expect(result.success).toBe(false);
    expect(result.status).toBe(401);
  }, 15000);

  it("absorbs a rejected async onRefreshFailure callback", async () => {
    const executor = makeChatExecutor();
    executor.execute.mockResolvedValue({
      response: unauthorizedResponse(),
      url: "https://api.example.test/v1/chat/completions",
      headers: {},
    });
    executor.refreshCredentials.mockRejectedValue(new Error("invalid_grant"));
    const unhandled = [];
    const onUnhandled = (reason) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      const onRefreshFailure = vi.fn(() => Promise.reject(new Error("async callback boom")));

      const result = await handleChatCore(chatArgs({ onRefreshFailure }));
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(result.success).toBe(false);
      expect(result.status).toBe(401);
      expect(onRefreshFailure).toHaveBeenCalledTimes(1);
      expect(unhandled).toHaveLength(0);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  }, 15000);
});

// ─────────────────────────────────────────────────────────────────────────────
// Background token refresh
// ─────────────────────────────────────────────────────────────────────────────

const dueConnection = (overrides = {}) => ({
  id: "conn-bg-1",
  provider: "openai",
  authType: "oauth",
  refreshToken: "refresh",
  expiresAt: new Date(Date.now() + 1000).toISOString(),
  providerSpecificData: {},
  ...overrides,
});

describe("backgroundTokenRefresh: terminal per-connection failures only", () => {
  it("emits one token.refresh_failed per failing connection", async () => {
    const events = makeSink();
    process.env.BG_REFRESH_DELAY_MS = "0";
    const refreshConnection = vi.fn().mockRejectedValue(new Error("refresh boom"));

    await runBackgroundTokenRefreshTick({
      loadConnections: async () => [
        dueConnection({ id: "conn-bg-1" }),
        dueConnection({ id: "conn-bg-2" }),
      ],
      refreshConnection,
      sleep: async () => {},
    });

    const failures = ofType(events, "token.refresh_failed");
    expect(failures).toHaveLength(2);
    expect(failures.map((event) => event.data.connectionId).sort()).toEqual([
      "conn-bg-1",
      "conn-bg-2",
    ]);
    expect(failures.every((event) => event.severity === "warning")).toBe(true);
    expect(failures.every((event) => event.data.errorClass === "refresh_failed")).toBe(true);
    expect(ofType(events, "account.unavailable")).toHaveLength(0);
  });

  it("does not emit when the refreshed connection succeeds", async () => {
    const events = makeSink();
    process.env.BG_REFRESH_DELAY_MS = "0";

    await runBackgroundTokenRefreshTick({
      loadConnections: async () => [dueConnection()],
      refreshConnection: async () => ({ accessToken: "fresh" }),
      sleep: async () => {},
    });

    expect(events).toHaveLength(0);
  });

  it("does not masquerade a generic tick exception without a connection as an account failure", async () => {
    const events = makeSink();

    await runBackgroundTokenRefreshTick({
      loadConnections: async () => {
        throw new Error("database offline");
      },
      refreshConnection: vi.fn(),
      sleep: async () => {},
    });

    expect(events).toHaveLength(0);
  });

  it("keeps the tick fail-open when the transient sink throws", async () => {
    makeThrowingSink();
    process.env.BG_REFRESH_DELAY_MS = "0";
    const refreshConnection = vi.fn().mockRejectedValue(new Error("refresh boom"));

    await expect(
      runBackgroundTokenRefreshTick({
        loadConnections: async () => [dueConnection({ id: "conn-bg-throw" })],
        refreshConnection,
        sleep: async () => {},
      }),
    ).resolves.toBeUndefined();
    expect(refreshConnection).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Quota auto-ping
// ─────────────────────────────────────────────────────────────────────────────

const autoPingState = () => ({ running: false, resetCache: {}, failureCache: {} });

const autoPingDeps = (overrides = {}) => ({
  getSettings: async () => ({ claudeAutoPing: { connections: { "conn-q1": true } } }),
  getProviderConnections: async () => [
    { id: "conn-q1", provider: "claude", authType: "oauth", accessToken: "access" },
  ],
  updateProviderConnection: vi.fn().mockResolvedValue(true),
  resolveConnectionProxyConfig: async () => ({}),
  refreshAndUpdateCredentials: vi.fn(),
  proxyAwareFetch: vi.fn(),
  getExecutor: vi.fn(),
  ...overrides,
});

describe("quotaAutoPing: terminal refresh failure only", () => {
  it("emits token.refresh_failed when credential refresh throws for a connection", async () => {
    const events = makeSink();
    const deps = autoPingDeps({
      refreshAndUpdateCredentials: vi.fn().mockRejectedValue(new Error("refresh boom")),
    });

    await runQuotaAutoPingTick(deps, autoPingState());

    const failures = ofType(events, "token.refresh_failed");
    expect(failures).toHaveLength(1);
    expect(failures[0].data).toMatchObject({
      provider: "claude",
      connectionId: "conn-q1",
      errorClass: "refresh_failed",
    });
    expect(ofType(events, "account.unavailable")).toHaveLength(0);
  });

  it("does not emit token.refresh_failed for a post-refresh usage/ping exception", async () => {
    const events = makeSink();
    mocks.claudeUsage.getClaudeUsage.mockRejectedValue(new Error("usage endpoint down"));
    const deps = autoPingDeps({
      refreshAndUpdateCredentials: vi.fn().mockResolvedValue({
        connection: {
          id: "conn-q1",
          provider: "claude",
          authType: "oauth",
          accessToken: "access",
        },
      }),
    });

    await runQuotaAutoPingTick(deps, autoPingState());

    expect(ofType(events, "token.refresh_failed")).toHaveLength(0);
  });

  it("does not emit for a generic tick error with no connection", async () => {
    const events = makeSink();
    const deps = autoPingDeps({
      getSettings: async () => {
        throw new Error("settings unavailable");
      },
    });

    await runQuotaAutoPingTick(deps, autoPingState());

    expect(events).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// src/sse/services/tokenRefresh.js
// ─────────────────────────────────────────────────────────────────────────────

describe("checkAndRefreshToken: terminal refresh failure per connection", () => {
  const creds = (connectionId) => ({
    connectionId,
    provider: "cx",
    refreshToken: "refresh",
    accessToken: "old",
    providerSpecificData: {},
  });

  it("emits one token.refresh_failed when the provider refresh yields no credentials", async () => {
    const events = makeSink();
    mocks.oauthManager.refreshProviderCredentials.mockResolvedValue(null);

    const result = await checkAndRefreshToken("cx", creds("conn-t1"), { force: true });

    expect(result.accessToken).toBe("old");
    const failures = ofType(events, "token.refresh_failed");
    expect(failures).toHaveLength(1);
    expect(failures[0].data).toMatchObject({
      provider: "cx",
      connectionId: "conn-t1",
      errorClass: "refresh_failed",
    });
    expect(Object.keys(failures[0].data).sort()).toEqual([
      "connectionId",
      "errorClass",
      "provider",
    ]);
  });

  it("correlates a request-path refresh failure with the active requestId", async () => {
    const events = makeSink();
    mocks.oauthManager.refreshProviderCredentials.mockResolvedValue(null);

    await runWithWebhookContext({ requestId: REQUEST_ID, modality: "chat" }, () =>
      checkAndRefreshToken("cx", creds("conn-t2"), { force: true }),
    );

    const failures = ofType(events, "token.refresh_failed");
    expect(failures).toHaveLength(1);
    expect(failures[0].data.requestId).toBe(REQUEST_ID);
  });

  it("does not emit after a successful refresh", async () => {
    const events = makeSink();
    mocks.oauthManager.refreshProviderCredentials.mockResolvedValue({
      accessToken: "fresh",
      expiresIn: 3600,
    });

    const result = await checkAndRefreshToken("cx", creds("conn-t3"), { force: true });

    expect(result.accessToken).toBe("fresh");
    expect(events).toHaveLength(0);
  });

  it("leaves the caller outcome unchanged when the sink throws", async () => {
    makeThrowingSink();
    mocks.oauthManager.refreshProviderCredentials.mockResolvedValue(null);

    await expect(
      checkAndRefreshToken("cx", creds("conn-t4"), { force: true }),
    ).resolves.toMatchObject({ accessToken: "old" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Antigravity quota refresh
// ─────────────────────────────────────────────────────────────────────────────

describe("antigravityQuota: quota fetch failure is not a token refresh failure", () => {
  it("returns null and emits nothing for a quota API/network error", async () => {
    const events = makeSink();
    mocks.googleUsage.getAntigravityUsage.mockRejectedValue(new Error("quota API down"));

    const result = await refreshAntigravityQuota("conn-ag-1", "access", {});

    // `_doRefresh` only calls the usage/quota API; it never refreshes OAuth
    // credentials. A quota/network error must not masquerade as
    // token.refresh_failed (provenance: no credential refresh occurred).
    expect(result).toBeNull();
    expect(ofType(events, "token.refresh_failed")).toHaveLength(0);
    expect(ofType(events, "account.unavailable")).toHaveLength(0);
    expect(events).toHaveLength(0);
  });

  it("does not emit when the quota refresh succeeds", async () => {
    const events = makeSink();
    mocks.googleUsage.getAntigravityUsage.mockResolvedValue({
      quotas: { "claude-4": { remainingPercentage: 42 } },
    });

    const result = await refreshAntigravityQuota("conn-ag-2", "access", {});

    expect(result).toMatchObject({ "claude-4": { remainingPercentage: 42 } });
    expect(events).toHaveLength(0);
  });
});
