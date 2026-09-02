import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getSettings: vi.fn(),
  updateProviderConnection: vi.fn(),
  resolveConnectionProxyConfig: vi.fn(),
  getClaudeUsage: vi.fn(),
  getCodexUsage: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
  getSettings: mocks.getSettings,
  getProxyPools: vi.fn(),
  validateApiKey: vi.fn(),
  updateProviderConnection: mocks.updateProviderConnection,
}));
vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: mocks.resolveConnectionProxyConfig,
  pickProxyPoolId: vi.fn(),
}));
vi.mock("@/shared/constants/providers.js", () => ({
  FREE_PROVIDERS: {},
  resolveProviderId: (provider) => provider,
}));
vi.mock("open-sse/services/usage/claude.js", () => ({
  getClaudeUsage: mocks.getClaudeUsage,
}));
vi.mock("open-sse/services/usage/codex.js", () => ({
  getCodexUsage: mocks.getCodexUsage,
}));
vi.mock("@/sse/utils/logger.js", () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}));

const { getProviderCredentials } = await import("@/sse/services/auth.js");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveConnectionProxyConfig.mockResolvedValue({});
  mocks.getSettings.mockResolvedValue({
    quotaAwareSelection: true,
    quotaCacheTtlMs: 45000,
    quotaAwareProviders: ["claude", "codex"],
    fallbackStrategy: "fill-first",
  });
});

describe("Claude remaining-first routing", () => {
  it("prefers the account with higher session remaining", async () => {
    mocks.getProviderConnections.mockResolvedValue([
      { id: "cl-low", email: "low@example.com", isActive: true, accessToken: "t-low", priority: 1 },
      { id: "cl-high", email: "high@example.com", isActive: true, accessToken: "t-high", priority: 2 },
    ]);
    mocks.getClaudeUsage.mockImplementation(async (token) => {
      if (token === "t-high") {
        return { quotas: { "session (5h)": { remaining: 80, total: 100, remainingPercentage: 80 }, "weekly (7d)": { remaining: 50, total: 100, remainingPercentage: 50 } } };
      }
      return { quotas: { "session (5h)": { remaining: 10, total: 100, remainingPercentage: 10 }, "weekly (7d)": { remaining: 50, total: 100, remainingPercentage: 50 } } };
    });

    await expect(getProviderCredentials("claude")).resolves.toMatchObject({
      connectionId: "cl-high",
    });
  });

  it("skips account with blocking weekly exhausted", async () => {
    mocks.getProviderConnections.mockResolvedValue([
      { id: "cl-dead", email: "dead@example.com", isActive: true, accessToken: "t-dead" },
      { id: "cl-ok", email: "ok@example.com", isActive: true, accessToken: "t-ok" },
    ]);
    mocks.getClaudeUsage.mockImplementation(async (token) => {
      if (token === "t-dead") {
        return { quotas: { "session (5h)": { remaining: 90, total: 100, remainingPercentage: 90 }, "weekly (7d)": { remaining: 0, total: 100, remainingPercentage: 0 } } };
      }
      return { quotas: { "session (5h)": { remaining: 20, total: 100, remainingPercentage: 20 }, "weekly (7d)": { remaining: 40, total: 100, remainingPercentage: 40 } } };
    });

    await expect(getProviderCredentials("claude")).resolves.toMatchObject({
      connectionId: "cl-ok",
    });
  });

  it("uses DB order when quotaAwareSelection is false", async () => {
    mocks.getSettings.mockResolvedValue({
      quotaAwareSelection: false,
      fallbackStrategy: "fill-first",
    });
    mocks.getProviderConnections.mockResolvedValue([
      { id: "cl-first", email: "first@example.com", isActive: true, accessToken: "t1", priority: 1 },
      { id: "cl-second", email: "second@example.com", isActive: true, accessToken: "t2", priority: 2 },
    ]);

    await expect(getProviderCredentials("claude")).resolves.toMatchObject({
      connectionId: "cl-first",
    });
    expect(mocks.getClaudeUsage).not.toHaveBeenCalled();
  });

  it("returns allRateLimited when every account is blocking-exhausted", async () => {
    const resetAt = "2026-09-03T12:00:00.000Z";
    mocks.getProviderConnections.mockResolvedValue([
      { id: "cl-a", email: "a@example.com", isActive: true, accessToken: "t-a" },
      { id: "cl-b", email: "b@example.com", isActive: true, accessToken: "t-b" },
    ]);
    mocks.getClaudeUsage.mockResolvedValue({
      quotas: {
        "session (5h)": { remaining: 50, total: 100, remainingPercentage: 50 },
        "weekly (7d)": { remaining: 0, total: 100, remainingPercentage: 0, resetAt },
      },
    });

    await expect(getProviderCredentials("claude")).resolves.toMatchObject({
      allRateLimited: true,
      retryAfter: resetAt,
    });
  });
});
