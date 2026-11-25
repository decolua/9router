// getProviderCredentials with providerStrategies[provider].fallbackStrategy = "soonest-reset".
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getSettings: vi.fn(),
  getUsageForProvider: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
  getSettings: mocks.getSettings,
  getProxyPools: vi.fn(),
  validateApiKey: vi.fn(),
  updateProviderConnection: vi.fn(),
}));
vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: async () => ({}),
  pickProxyPoolId: vi.fn(),
}));
vi.mock("@/shared/constants/providers.js", () => ({ FREE_PROVIDERS: {}, resolveProviderId: (p) => p }));
vi.mock("open-sse/services/usage.js", () => ({ getUsageForProvider: mocks.getUsageForProvider }));
vi.mock("@/sse/utils/logger.js", () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn() }));

const { getProviderCredentials } = await import("@/sse/services/auth.js");

const inHours = (h) => new Date(Date.now() + h * 3_600_000).toISOString();
const weekly = (free, h) => ({ quotas: { "weekly (7d)": { remainingPercentage: free, resetAt: inHours(h) } } });
const QUOTA = { late: weekly(100, 160), soon: weekly(90, 11), spent: weekly(0, 2) };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getProviderConnections.mockResolvedValue([
    { id: "late", priority: 1, isActive: true },
    { id: "soon", priority: 2, isActive: true },
    { id: "spent", priority: 3, isActive: true },
  ]);
  mocks.getUsageForProvider.mockImplementation(async (c) => QUOTA[c.id]);
});

describe("soonest-reset routing", () => {
  it("routes to the account with the soonest reset once quotas are known", async () => {
    mocks.getSettings.mockResolvedValue({ providerStrategies: { claude: { fallbackStrategy: "soonest-reset" } } });
    // First call: no snapshot yet, falls back to priority while it loads in the background.
    expect((await getProviderCredentials("claude")).connectionId).toBe("late");
    await vi.waitFor(async () => expect((await getProviderCredentials("claude")).connectionId).toBe("soon"));
    // Next in line after excluding it (e.g. after a 429) is the non-exhausted one, not "spent".
    expect((await getProviderCredentials("claude", new Set(["soon"]))).connectionId).toBe("late");
  });

  it("leaves fill-first untouched and never reads usage", async () => {
    mocks.getSettings.mockResolvedValue({});
    expect((await getProviderCredentials("claude")).connectionId).toBe("late");
    expect(mocks.getUsageForProvider).not.toHaveBeenCalled();
  });
});
