// Test for A3: backgroundCookieManager uses resolveConnectionProxyConfig for probes
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const fx = vi.hoisted(() => ({
  connections: [],
  updates: [],
}));

vi.mock("@/lib/db/repos/connectionsRepo.js", () => ({
  getProviderConnections: async (filter = {}) => fx.connections.filter((c) => c.isActive !== false),
  updateProviderConnection: async (id, data) => {
    fx.updates.push({ id, data });
    return { id, ...data };
  },
}));

vi.mock("@/lib/network/connectionProxy.js", () => ({
  resolveConnectionProxyConfig: async (psd) => ({
    connectionProxyEnabled: true,
    connectionProxyUrl: "http://resolved-proxy:8080",
    connectionNoProxy: "localhost",
    vercelRelayUrl: "",
    strictProxy: true,
    proxyPoolId: "pool-123",
  }),
}));

vi.mock("open-sse/services/webIdentity.js", () => ({
  fetchWebIdentity: vi.fn(async (provider, credential, proxyOptions) => {
    // Capture the proxyOptions passed to verify it's the resolved config
    fx.lastProxyOptions = proxyOptions;
    return { status: "valid", ok: true, email: "test@example.com" };
  }),
}));

vi.mock("@/sse/utils/logger.js", () => ({
  info: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
}));

// Import after mocks
const { validateAndRefreshWebConnection, runBackgroundCookieManagerTick } = await import("../../src/sse/services/backgroundCookieManager.js");

function resetFixture() {
  fx.connections = [];
  fx.updates = [];
  fx.lastProxyOptions = null;
}

function addConnection(id, provider, providerSpecificData = {}) {
  fx.connections.push({
    id,
    provider,
    authType: "cookie",
    name: `conn-${id}`,
    priority: 1,
    isActive: true,
    apiKey: "test-cookie-data",
    providerSpecificData,
    expiresAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

describe("backgroundCookieManager proxy resolution (A3)", () => {
  beforeEach(() => {
    resetFixture();
    vi.clearAllMocks();
  });

  it("resolveConnectionProxyConfig is called and passed to fetchWebIdentity", async () => {
    addConnection("conn-1", "chatgpt-web", {
      connectionProxyEnabled: true,
      connectionProxyUrl: "http://legacy-proxy:8080",
      connectionProxyPoolId: "pool-123",
    });

    const result = await validateAndRefreshWebConnection(fx.connections[0]);
    
    expect(result.valid).toBe(true);
    // Verify resolveConnectionProxyConfig was used (strictProxy=true comes from pool)
    expect(fx.lastProxyOptions).toBeDefined();
    expect(fx.lastProxyOptions.strictProxy).toBe(true);
    expect(fx.lastProxyOptions.proxyPoolId).toBe("pool-123");
    expect(fx.lastProxyOptions.enabled).toBe(true);
    expect(fx.lastProxyOptions.url).toBe("http://resolved-proxy:8080");
  });

  it("probe receives resolved proxy with strictProxy from pool", async () => {
    addConnection("conn-2", "gemini-web", {
      connectionProxyPoolId: "pool-strict",
    });

    await validateAndRefreshWebConnection(fx.connections[0]);
    
    expect(fx.lastProxyOptions.strictProxy).toBe(true);
  });
});
