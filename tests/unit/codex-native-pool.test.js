import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connections: [],
  usageByToken: new Map(),
  affinity: null,
  bind: vi.fn(),
  release: vi.fn(),
}));

vi.mock("@/lib/localDb.js", () => ({
  getProviderConnections: vi.fn(async () => mocks.connections),
}));
vi.mock("@/lib/network/connectionProxy.js", () => ({
  resolveConnectionProxyConfig: vi.fn(async () => ({})),
}));
vi.mock("@/sse/services/tokenRefresh.js", () => ({
  checkAndRefreshToken: vi.fn(async (_provider, credentials) => credentials),
}));
vi.mock("open-sse/services/usage/codex.js", () => ({
  getCodexUsage: vi.fn(async (token) => mocks.usageByToken.get(token)),
}));
vi.mock("@/lib/codexNative/catalog.js", () => ({
  getCodexNativeCatalog: vi.fn(async () => ({
    models: [{ slug: "gpt-5.6-sol" }],
    eligibleConnectionIds: {
      "gpt-5.6-sol": ["account-low", "account-healthy", "account-exhausted"],
    },
  })),
}));
vi.mock("@/lib/codexNative/affinity.js", () => ({
  resolveCodexNativeAffinityKey: vi.fn(async () => "affinity-key"),
  getCodexNativeAffinity: vi.fn(async () => mocks.affinity),
  getCodexNativeAffinityCounts: vi.fn(async () => new Map()),
  bindCodexNativeAffinity: (...args) => mocks.bind(...args),
  releaseCodexNativeAffinity: (...args) => mocks.release(...args),
}));

function usage(remaining) {
  return {
    quotas: {
      session: { remaining, resetAt: "2026-08-01T00:00:00.000Z" },
      weekly: { remaining: Math.max(remaining, 50), resetAt: "2026-08-02T00:00:00.000Z" },
    },
  };
}

describe("Codex Native account pool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.connections = [
      { id: "account-low", accessToken: "low-token", provider: "codex", isActive: true, priority: 1 },
      { id: "account-healthy", accessToken: "healthy-token", provider: "codex", isActive: true, priority: 2 },
      { id: "account-exhausted", accessToken: "exhausted-token", provider: "codex", isActive: true, priority: 3 },
    ];
    mocks.usageByToken = new Map([
      ["low-token", usage(4)],
      ["healthy-token", usage(80)],
      ["exhausted-token", usage(0)],
    ]);
    mocks.affinity = { connectionId: "account-low", lastUsedAt: Date.now() };
  });

  it("moves a critical session to a healthy eligible account at the next turn", async () => {
    const pool = await import("@/lib/codexNative/pool.js");
    await pool.refreshCodexNativePoolUsage();
    const routing = await pool.resolveCodexNativeRouting({
      headers: { "session-id": "session-1" },
      body: { prompt_cache_key: "session-1" },
      model: "gpt-5.6-sol",
    });

    expect(routing.preferredConnectionId).toBe("account-healthy");
    expect(routing.eligibleConnectionIds).toEqual(["account-low", "account-healthy"]);
    expect(mocks.bind).toHaveBeenCalledWith("affinity-key", "account-healthy");
  });

  it("applies quota hysteresis at healthy, draining, critical, and exhausted thresholds", async () => {
    const { codexQuotaStatus } = await import("@/lib/codexNative/pool.js");
    expect(codexQuotaStatus(20, "draining")).toBe("healthy");
    expect(codexQuotaStatus(14.9, "healthy")).toBe("draining");
    expect(codexQuotaStatus(19.9, "draining")).toBe("draining");
    expect(codexQuotaStatus(4.9, "healthy")).toBe("critical");
    expect(codexQuotaStatus(0, "healthy")).toBe("exhausted");
  });

  it("does not assign a new session to draining or critical accounts", async () => {
    const pool = await import("@/lib/codexNative/pool.js");
    mocks.affinity = null;
    pool.ingestCodexNativeQuota("account-low", {
      rate_limits: { primary: { remaining: 10 } },
    });
    pool.ingestCodexNativeQuota("account-healthy", {
      rate_limits: { primary: { remaining: 4 } },
    });
    pool.ingestCodexNativeQuota("account-exhausted", {
      rate_limits: { primary: { remaining: 0 } },
    });

    const routing = await pool.resolveCodexNativeRouting({
      headers: {},
      body: {},
      model: "gpt-5.6-sol",
    });

    expect(routing.preferredConnectionId).toBeNull();
    expect(mocks.bind).not.toHaveBeenCalled();
  });

  it("excludes relay-only accounts from WebSocket without excluding HTTP", async () => {
    const { codexWebSocketProxyCapability } = await import("@/lib/codexNative/pool.js");
    expect(codexWebSocketProxyCapability({ vercelRelayUrl: "https://relay.example" }))
      .toEqual({ capable: false, reason: "relay-only proxy has no WebSocket transport" });
    expect(codexWebSocketProxyCapability({
      connectionProxyEnabled: true,
      connectionProxyUrl: "socks5://127.0.0.1:1080",
    }).capable).toBe(true);
  });
});
