import { beforeEach, describe, expect, it, vi } from "vitest";

const connectionById = new Map();
const getProviderConnectionById = vi.fn(async (id) => connectionById.get(id) || null);
const updateProviderConnection = vi.fn(async (id, data) => ({ id, ...data }));
const resolveConnectionProxyConfig = vi.fn(async () => ({
  connectionProxyEnabled: false,
  connectionProxyUrl: "",
  connectionNoProxy: false,
  proxyPoolId: null,
  vercelRelayUrl: "",
}));
const testProxyUrl = vi.fn(async () => ({ ok: true }));

vi.mock("@/lib/localDb", () => ({
  getProviderConnectionById,
  updateProviderConnection,
}));

vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig,
}));

vi.mock("@/lib/network/proxyTest", () => ({
  testProxyUrl,
}));

vi.mock("@/shared/constants/providers", () => ({
  isOpenAICompatibleProvider: () => true,
  isAnthropicCompatibleProvider: () => false,
}));

vi.mock("open-sse/config/providerModels.js", () => ({
  getDefaultModel: () => "test-model",
}));

vi.mock("@/lib/oauth/constants/oauth", () => ({
  GEMINI_CONFIG: {},
  ANTIGRAVITY_CONFIG: {},
  CODEX_CONFIG: {},
  KIRO_CONFIG: {},
  QWEN_CONFIG: {},
  CLAUDE_CONFIG: {},
  CLINE_CONFIG: {},
  KILOCODE_CONFIG: { apiBaseUrl: "https://example.test" },
}));

vi.mock("@/shared/utils/clineAuth", () => ({
  buildClineHeaders: () => ({}),
}));

vi.mock("../../src/lib/usageStatus.js", () => ({
  getConnectionRecoveryPatch: () => ({
    routingStatus: "eligible",
    healthStatus: "healthy",
    quotaState: "ok",
    authState: "ok",
    reasonCode: "unknown",
    reasonDetail: null,
    nextRetryAt: null,
    resetAt: null,
    testStatus: "active",
    lastError: null,
    lastErrorType: null,
    lastErrorAt: null,
    rateLimitedUntil: null,
    errorCode: null,
    backoffLevel: 0,
    lastCheckedAt: "2026-04-22T00:00:00.000Z",
    lastTested: "2026-04-22T00:00:00.000Z",
  }),
  getConnectionAuthBlockedPatch: (error, { lastCheckedAt } = {}) => {
    if (!["Token invalid or revoked", "Token expired", "Token expired and refresh failed"].includes(error)) {
      return null;
    }

    return {
      routingStatus: "blocked_auth",
      authState: "invalid",
      reasonCode: "auth_invalid",
      reasonDetail: error,
      lastError: error,
      lastErrorType: "auth_invalid",
      lastErrorAt: lastCheckedAt || "2026-04-22T00:00:00.000Z",
      testStatus: "expired",
      nextRetryAt: null,
      resetAt: null,
      rateLimitedUntil: null,
      errorCode: "auth_invalid",
    };
  },
}));

describe("provider test recovery", () => {
  beforeEach(() => {
    connectionById.clear();
    getProviderConnectionById.mockClear();
    updateProviderConnection.mockClear();
    resolveConnectionProxyConfig.mockClear();
    testProxyUrl.mockClear();
    vi.resetModules();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200 })));
  });

  it("clears centralized blocked state on successful connection test", async () => {
    connectionById.set("conn-test", {
      id: "conn-test",
      provider: "openai-compatible",
      authType: "apikey",
      apiKey: "secret",
      providerSpecificData: { baseUrl: "https://example.test/v1" },
      testStatus: "unavailable",
      lastError: "Quota exhausted",
      routingStatus: "blocked_quota",
      quotaState: "exhausted",
      authState: "expired",
      healthStatus: "degraded",
      reasonCode: "quota_exhausted",
      reasonDetail: "Still blocked",
      nextRetryAt: "2026-04-25T00:00:00.000Z",
      resetAt: "2026-04-25T00:00:00.000Z",
      errorCode: "quota_exhausted",
      backoffLevel: 3,
      rateLimitedUntil: "2026-04-25T00:00:00.000Z",
    });

    const { testSingleConnection } = await import("../../src/app/api/providers/[id]/test/testUtils.js");
    const result = await testSingleConnection("conn-test");

    expect(result.valid).toBe(true);
    expect(updateProviderConnection).toHaveBeenCalledWith("conn-test", expect.objectContaining({
      testStatus: "active",
      lastError: null,
      lastErrorAt: null,
      lastErrorType: null,
      rateLimitedUntil: null,
      errorCode: null,
      backoffLevel: 0,
      routingStatus: "eligible",
      quotaState: "ok",
      authState: "ok",
      healthStatus: "healthy",
      reasonCode: "unknown",
      reasonDetail: null,
      nextRetryAt: null,
      resetAt: null,
    }));
  });

  it("marks canonical auth-blocked state when provider test reports invalid or revoked token", async () => {
    connectionById.set("conn-auth-fail", {
      id: "conn-auth-fail",
      provider: "github",
      authType: "oauth",
      accessToken: "bad-token",
      routingStatus: "eligible",
      authState: "ok",
      testStatus: "active",
    });

    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 401 })));

    const { testSingleConnection } = await import("../../src/app/api/providers/[id]/test/testUtils.js");
    const result = await testSingleConnection("conn-auth-fail");

    expect(result).toMatchObject({ valid: false, error: "Token invalid or revoked" });
    expect(updateProviderConnection).toHaveBeenCalledWith("conn-auth-fail", expect.objectContaining({
      routingStatus: "blocked_auth",
      authState: "invalid",
      reasonCode: "auth_invalid",
      reasonDetail: "Token invalid or revoked",
      testStatus: "expired",
      lastError: "Token invalid or revoked",
      lastErrorType: "auth_invalid",
    }));
  });
});
