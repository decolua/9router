import { describe, expect, it, vi } from "vitest";

const { getProviderConnections, updateProviderConnection } = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  updateProviderConnection: vi.fn(),
}));
vi.mock("@/lib/localDb", () => ({
  getProviderConnections,
  validateApiKey: vi.fn(),
  updateProviderConnection,
  getSettings: vi.fn(),
  getProxyPools: vi.fn(),
}));

import { markAccountUnavailable } from "../../src/sse/services/auth.js";
import { isModelUnavailable } from "../../open-sse/services/accountFallback.js";

describe("account locks (#2951)", () => {
  it.each([
    [400, "invalid_request_error"],
    [429, "MODEL_CAPACITY_EXHAUSTED"],
    [502, "Proxy required but failed"],
  ])("does not persist a key lock for %s %s", async (status, error) => {
    const result = await markAccountUnavailable("key-1", status, error, "nvidia", "model");

    expect(result.shouldFallback).toBe(false);
    expect(updateProviderConnection).not.toHaveBeenCalled();
  });

  it("uses Retry-After as the account-quota cooldown", async () => {
    getProviderConnections.mockResolvedValue([{ id: "key-1", backoffLevel: 4 }]);

    const result = await markAccountUnavailable("key-1", 429, "quota exceeded", "nvidia", "model", {
      providerReason: "account_quota_exhausted",
      retryAfterMs: 42_000,
    });

    expect(result.cooldownMs).toBe(42_000);
    expect(updateProviderConnection).toHaveBeenCalledWith("key-1", expect.objectContaining({ backoffLevel: 0 }));
  });

  it("negative-caches a structured unsupported-model failure", async () => {
    const result = await markAccountUnavailable("noauth", 401, "Model retired-free is not supported", "opencode", "retired-free", {
      providerErrorType: "ModelError",
    });

    expect(result.scope).toBe("model");
    expect(result.shouldFallback).toBe(false);
    expect(isModelUnavailable("opencode", "retired-free")).toBe(true);
  });
});
