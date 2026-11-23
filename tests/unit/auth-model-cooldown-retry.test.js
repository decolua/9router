import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getProviderConnections: vi.fn() }));
vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections, validateApiKey: vi.fn(),
  updateProviderConnection: vi.fn(), getSettings: async () => ({}), getProxyPools: async () => [],
}));
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: vi.fn(), pickProxyPoolId: vi.fn() }));
vi.mock("@/sse/services/antigravityQuota.js", () => ({ getAntigravityQuotaCache: () => new Map(), getAntigravityModelQuota: vi.fn() }));
const { getProviderCredentials } = await import("@/sse/services/auth.js");
const NOW = Date.parse("2026-11-12T00:00:00Z");
const iso = seconds => new Date(NOW + seconds * 1000).toISOString();
beforeEach(() => { vi.clearAllMocks(); vi.spyOn(Date, "now").mockReturnValue(NOW); });
afterEach(() => vi.restoreAllMocks());

describe("OAuth account cooldown retry timing (#4663)", () => {
  it("ignores another model's earlier cooldown on the same account", async () => {
    mocks.getProviderConnections.mockResolvedValue([{
      id: "claude-1", authType: "oauth", errorCode: 429, lastError: "rate limit",
      "modelLock_claude-opus-5-5": iso(120), "modelLock_claude-haiku-5-5": iso(10),
    }]);
    expect(await getProviderCredentials("claude", null, "claude-opus-5-5"))
      .toMatchObject({ allRateLimited: true, lastErrorCode: 429, retryAfter: iso(120) });
  });

  it("returns the earliest account's matching status and reset", async () => {
    mocks.getProviderConnections.mockResolvedValue([
      { id: "codex-1", authType: "oauth", errorCode: 503, lastError: "unavailable", "modelLock_gpt-6.1-sol": iso(180) },
      { id: "codex-2", authType: "oauth", errorCode: 429, lastError: "usage limit", "modelLock_gpt-6.1-sol": iso(30) },
    ]);
    expect(await getProviderCredentials("codex", null, "gpt-6.1-sol"))
      .toMatchObject({ allRateLimited: true, lastErrorCode: 429, lastError: "usage limit", retryAfter: iso(30) });
  });

  it("retains account-wide locks when there is no model-specific lock", async () => {
    mocks.getProviderConnections.mockResolvedValue([{
      id: "codex-1", authType: "oauth", errorCode: 429, modelLock___all: iso(75), "modelLock_other": iso(5),
    }]);
    expect(await getProviderCredentials("codex", null, "gpt-6.1-sol"))
      .toMatchObject({ allRateLimited: true, retryAfter: iso(75) });
  });
});
