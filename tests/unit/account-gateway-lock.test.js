import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  updateProviderConnection: vi.fn(),
}));

vi.mock("@/lib/localDb", () => dbMocks);
vi.mock("@/lib/network/connectionProxy", () => ({
  pickProxyPoolId: vi.fn(),
  resolveConnectionProxyConfig: vi.fn(),
}));
vi.mock("@/shared/constants/providers.js", () => ({
  FREE_PROVIDERS: {},
  resolveProviderId: (provider) => provider,
}));
vi.mock("@/sse/utils/logger.js", () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn() }));

const { markAccountUnavailable } = await import("../../src/sse/services/auth.js");

beforeEach(() => {
  vi.clearAllMocks();
  dbMocks.getProviderConnections.mockResolvedValue([{
    id: "codex-claude",
    provider: "anthropic-compatible-53aa55a6",
    name: "Codex-Everywhere-Claude",
    isActive: true,
  }]);
});

describe("sole-account gateway failures do not lock the credential", () => {
  // Reproduces the "all 1 accounts locked for claude-opus-5 (reset after 30s)"
  // loop: Cloudflare returns 502/503/504/524 in front of the origin after a long
  // request. With only one account there is nothing to fall back to, so the lock
  // does not repair anything — it just rejects the next 30s of requests.
  for (const status of [502, 503, 504, 524]) {
    it(`returns shouldFallback=false and writes no lock for ${status}`, async () => {
      const result = await markAccountUnavailable(
        "codex-claude",
        status,
        `[${status}]: codex-everywhere.com | ${status}: Bad gateway`,
        "anthropic-compatible-53aa55a6",
        "claude-opus-5",
      );

      expect(result).toEqual({ shouldFallback: false, cooldownMs: 0 });
      expect(dbMocks.updateProviderConnection).not.toHaveBeenCalled();
    });
  }

  it("still locks for a gateway status when another account can be tried", async () => {
    dbMocks.getProviderConnections.mockResolvedValue([
      { id: "codex-claude", provider: "anthropic-compatible-53aa55a6", name: "A", isActive: true },
      { id: "codex-claude-2", provider: "anthropic-compatible-53aa55a6", name: "B", isActive: true },
    ]);

    const result = await markAccountUnavailable(
      "codex-claude",
      502,
      "502: Bad gateway",
      "anthropic-compatible-53aa55a6",
      "claude-opus-5",
    );

    expect(result.shouldFallback).toBe(true);
    expect(dbMocks.updateProviderConnection).toHaveBeenCalled();
  });
});
