import { describe, it, expect, beforeEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connections: [],
  getProviderConnections: vi.fn(),
  getSettings: vi.fn(),
  resolveConnectionProxyConfig: vi.fn(),
  getAntigravityUsage: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
  getSettings: mocks.getSettings,
  getProxyPools: vi.fn(),
  validateApiKey: vi.fn(),
  updateProviderConnection: vi.fn(),
}));
vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: mocks.resolveConnectionProxyConfig,
  pickProxyPoolId: vi.fn(),
}));
vi.mock("@/shared/constants/providers.js", () => ({
  FREE_PROVIDERS: {},
  resolveProviderId: (provider) => provider,
}));
vi.mock("open-sse/services/usage/google.js", () => ({
  getAntigravityUsage: mocks.getAntigravityUsage,
}));
vi.mock("@/sse/utils/logger.js", () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn() }));

import { getProviderCredentials } from "../../src/sse/services/auth.js";
import {
  getCircuitBreaker,
  recordFailure,
  resetAllCircuitBreakers,
  buildAccountBreakerName,
} from "../../open-sse/utils/circuitBreaker.js";

describe("getProviderCredentials skips OPEN breakers", () => {
  beforeEach(() => {
    resetAllCircuitBreakers();
    mocks.connections = [
      { id: "acc-a", provider: "glm", isActive: true, name: "A", providerSpecificData: {}, priority: 1 },
      { id: "acc-b", provider: "glm", isActive: true, name: "B", providerSpecificData: {}, priority: 2 },
    ];
    mocks.getProviderConnections.mockResolvedValue(mocks.connections);
    mocks.getSettings.mockResolvedValue({ fallbackStrategy: "fill-first" });
    mocks.resolveConnectionProxyConfig.mockResolvedValue({
      connectionProxyEnabled: false,
      connectionProxyUrl: "",
      connectionNoProxy: "",
      proxyPoolId: null,
      vercelRelayUrl: "",
    });
  });

  const trip = (connectionId, model) => {
    const name = buildAccountBreakerName({ provider: "glm", connectionId, model });
    getCircuitBreaker(name, { failureThreshold: 1, resetTimeout: 30_000, isFailure: () => true });
    recordFailure(name, { statusCode: 500 });
    return name;
  };

  it("returns B when A is OPEN for that model", async () => {
    trip("acc-a", "m1");
    const creds = await getProviderCredentials("glm", null, "m1");
    expect(creds.connectionId).toBe("acc-b");
  });

  it("returns allRateLimited when every account is OPEN for that model", async () => {
    trip("acc-a", "m1");
    trip("acc-b", "m1");
    const creds = await getProviderCredentials("glm", null, "m1");
    expect(creds.allRateLimited).toBe(true);
    expect(creds.retryAfter).toBeTruthy();
    expect(creds.retryAfterHuman).toBeTruthy();
    expect(creds.lastErrorCode).toBe(503);
  });

  it("does not hide an account from a model whose breaker never tripped", async () => {
    // The regression this guards: an account-wide key let a failing model take
    // every sibling model down with it, silently shrinking a combo's fallback.
    trip("acc-a", "m1");
    trip("acc-b", "m1");
    const creds = await getProviderCredentials("glm", null, "m2");
    expect(creds.allRateLimited).toBeUndefined();
    expect(creds.connectionId).toBe("acc-a");
  });

  it("does not consult breakers when no model is in hand", async () => {
    trip("acc-a", "m1");
    const creds = await getProviderCredentials("glm");
    expect(creds.connectionId).toBe("acc-a");
  });
});
