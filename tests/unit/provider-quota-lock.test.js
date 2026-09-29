import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  updateProviderConnection: vi.fn(),
  extendConnectionModelLock: vi.fn(),
  clearConnectionModelLockIfObserved: vi.fn(),
  getObservedConnectionModelLock: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
  updateProviderConnection: mocks.updateProviderConnection,
  validateApiKey: vi.fn(),
  getSettings: vi.fn(),
  getProxyPools: vi.fn(),
  getApiKeyMetadata: vi.fn(),
  touchApiKey: vi.fn(),
  extendConnectionModelLock: mocks.extendConnectionModelLock,
  clearConnectionModelLockIfObserved: mocks.clearConnectionModelLockIfObserved,
  getObservedConnectionModelLock: mocks.getObservedConnectionModelLock,
}));

// Avoid picking up network/proxy configs by mocking it out entirely
vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: vi.fn().mockResolvedValue({}),
  pickProxyPoolId: vi.fn().mockReturnValue(null)
}));

import { markAccountUnavailable } from "../../src/sse/services/auth.js";
import { MODEL_LOCK_ALL, checkFallbackError, isQuotaExhaustion } from "../../open-sse/services/accountFallback.js";
import { MAX_RATE_LIMIT_COOLDOWN_MS } from "../../open-sse/config/errorConfig.js";

describe("Existing fallback characterization", () => {
  it("keeps quota detection and fallback cooldown behavior unchanged", () => {
    expect(isQuotaExhaustion(403, "Quota exceeded")).toBe(true);
    expect(isQuotaExhaustion(429, "Rate limited")).toBe(false);
    expect(checkFallbackError(429, "Rate limited", 0)).toEqual({ shouldFallback: true, cooldownMs: 2000, newBackoffLevel: 1 });
  });
});

describe("Account-Wide Quota Lock via resetsAtMs", () => {
  const connectionId = "conn_123";
  const provider = "test_provider";
  const model = "test/model-1";

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getProviderConnections.mockResolvedValue([
      { id: connectionId, backoffLevel: 0, testStatus: "active" }
    ]);
  });

  it("applies per-model lock for transient 429 without resetsAtMs", async () => {
    const status = 429;
    const errorText = "Rate limited";

    const result = await markAccountUnavailable(connectionId, status, errorText, provider, model, null);

    expect(result.shouldFallback).toBe(true);
    expect(mocks.updateProviderConnection).toHaveBeenCalledWith(
      connectionId,
      expect.objectContaining({
        [`modelLock_${model}`]: expect.any(String), // The specific model is locked
        testStatus: "unavailable"
      })
    );
    // Ensure MODEL_LOCK_ALL is NOT set
    const updateCall = mocks.updateProviderConnection.mock.calls[0][1];
    expect(updateCall[MODEL_LOCK_ALL]).toBeUndefined();
  });

  it("applies per-model lock for quota exhaustion without explicit resetsAtMs", async () => {
    const status = 403;
    const errorText = "Quota exceeded";

    const result = await markAccountUnavailable(connectionId, status, errorText, provider, model, null);

    expect(result.shouldFallback).toBe(true);
    expect(mocks.extendConnectionModelLock).toHaveBeenCalledWith(
      connectionId,
      model,
      expect.objectContaining({ expiresAt: expect.any(String), classifiedAt: expect.any(String) }),
    );
  });

  it("applies account-wide lock for strong account quota evidence with a trusted reset", async () => {
    const status = 403;
    const errorText = "Account usage limit reached";
    // 5 hours in the future
    const resetsAtMs = Date.now() + 5 * 3600 * 1000;

    const result = await markAccountUnavailable(connectionId, status, errorText, provider, model, resetsAtMs);

    expect(result.shouldFallback).toBe(true);
    expect(mocks.extendConnectionModelLock).toHaveBeenCalledWith(
      connectionId,
      null,
      expect.objectContaining({ expiresAt: expect.any(String), classifiedAt: expect.any(String) }),
    );
  });

  it("trusts provider resetsAtMs above MAX_RATE_LIMIT_COOLDOWN_MS for quota exhaustion", async () => {
    const status = 403;
    const errorText = "Usage limit reached";
    // 5 hours in the future (exceeds 30 min MAX_RATE_LIMIT_COOLDOWN_MS)
    const resetsAtMs = Date.now() + 5 * 3600 * 1000;

    const result = await markAccountUnavailable(connectionId, status, errorText, provider, model, resetsAtMs);

    expect(result.cooldownMs).toBeGreaterThan(MAX_RATE_LIMIT_COOLDOWN_MS);
    expect(result.cooldownMs).toBeCloseTo(5 * 3600 * 1000, -2);
  });
});
