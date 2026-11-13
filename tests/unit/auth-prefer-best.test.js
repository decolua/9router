import { describe, it, expect, vi, beforeEach } from "vitest";

let conns, settings;
vi.mock("@/lib/localDb", () => ({
  getProviderConnections: async () => conns,
  validateApiKey: async () => true,
  updateProviderConnection: async () => {},
  getSettings: async () => settings,
  getProxyPools: async () => [],
}));
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: async () => ({}), pickProxyPoolId: () => null }));
vi.mock("../../src/sse/services/antigravityQuota.js", () => ({ getAntigravityQuotaCache: () => null, getAntigravityModelQuota: () => null }));

const { getProviderCredentials } = await import("../../src/sse/services/auth.js");
const mk = (id, extra = {}) => ({ id, provider: "codex", authType: "apikey", apiKey: id, isActive: true, priority: 1, ...extra });
const pick = async (opts) => (await getProviderCredentials("codex", null, null, opts)).connectionId;

describe("preferBestConnectionId", () => {
  beforeEach(() => { settings = { fallbackStrategy: "fill-first" }; conns = [mk("a"), mk("b")]; });

  it("fill-first: uses best", async () => expect(await pick({ preferBestConnectionId: "b" })).toBe("b"));
  it("fill-first: best unavailable -> normal pick", async () => expect(await pick({ preferBestConnectionId: "zzz" })).toBe("a"));
  it("round-robin: under sticky limit stays on current", async () => {
    settings = { fallbackStrategy: "round-robin", stickyRoundRobinLimit: 5 };
    conns = [mk("a", { lastUsedAt: new Date().toISOString(), consecutiveUseCount: 2 }), mk("b")];
    expect(await pick({ preferBestConnectionId: "b" })).toBe("a");
  });
  it("round-robin: at sticky limit switches to best", async () => {
    settings = { fallbackStrategy: "round-robin", stickyRoundRobinLimit: 5 };
    conns = [mk("a", { lastUsedAt: new Date().toISOString(), consecutiveUseCount: 5 }), mk("b")];
    expect(await pick({ preferBestConnectionId: "b" })).toBe("b");
  });
});
