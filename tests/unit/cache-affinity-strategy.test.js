import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getSettings: vi.fn(),
  updateProviderConnection: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
  getSettings: mocks.getSettings,
  getProxyPools: vi.fn(),
  validateApiKey: vi.fn(),
  updateProviderConnection: mocks.updateProviderConnection,
}));
vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: vi.fn().mockResolvedValue({}),
  pickProxyPoolId: vi.fn(),
}));
vi.mock("@/shared/constants/providers.js", () => ({
  FREE_PROVIDERS: {},
  resolveProviderId: (provider) => provider,
}));
vi.mock("@/sse/utils/logger.js", () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn() }));

const { buildCacheAffinityKey, pickByCacheAffinity } = await import("@/sse/services/cacheAffinity.js");
const { getProviderCredentials } = await import("@/sse/services/auth.js");

const conn = (id, extra = {}) => ({
  id, authType: "oauth", accessToken: `tok-${id}`, isActive: true, priority: 1, ...extra,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.updateProviderConnection.mockResolvedValue(undefined);
});

describe("buildCacheAffinityKey", () => {
  it("prefers an explicit prompt_cache_key, then metadata.user_id", () => {
    expect(buildCacheAffinityKey({ prompt_cache_key: " k1 ", messages: [] })).toBe("k1");
    expect(buildCacheAffinityKey({ metadata: { user_id: "sess-42" }, messages: [] })).toBe("sess-42");
  });

  it("derives a stable key from the prompt prefix (system + first message)", () => {
    const a = buildCacheAffinityKey({ system: "S", messages: [{ role: "user", content: "hi" }, { role: "assistant", content: "yo" }] });
    const b = buildCacheAffinityKey({ system: "S", messages: [{ role: "user", content: "hi" }, { role: "assistant", content: "different tail" }] });
    const c = buildCacheAffinityKey({ system: "OTHER", messages: [{ role: "user", content: "hi" }] });
    expect(a).toBeTruthy();
    expect(a).toBe(b);      // same prefix, different tail → same account
    expect(a).not.toBe(c);  // different system prompt → may go elsewhere
  });

  it("accepts OpenAI-style system messages and returns null without any prefix", () => {
    const a = buildCacheAffinityKey({ messages: [{ role: "system", content: "S" }, { role: "user", content: "hi" }] });
    expect(a).toBe(buildCacheAffinityKey({ system: "S", messages: [{ role: "user", content: "hi" }] }));
    expect(buildCacheAffinityKey({})).toBeNull();
    expect(buildCacheAffinityKey({ messages: [] })).toBeNull();
  });
});

describe("pickByCacheAffinity (rendezvous hashing)", () => {
  const pool = [conn("a"), conn("b"), conn("c"), conn("d")];

  it("is deterministic for a key and spreads distinct keys over the pool", () => {
    const first = pickByCacheAffinity("key-1", pool).id;
    for (let i = 0; i < 20; i++) expect(pickByCacheAffinity("key-1", pool).id).toBe(first);
    const chosen = new Set(Array.from({ length: 200 }, (_, i) => pickByCacheAffinity(`key-${i}`, pool).id));
    expect(chosen.size).toBe(pool.length);
  });

  it("only remaps keys that pointed at a removed account", () => {
    const keys = Array.from({ length: 300 }, (_, i) => `k${i}`);
    const before = new Map(keys.map((k) => [k, pickByCacheAffinity(k, pool).id]));
    const without = pool.filter((c) => c.id !== "b");
    for (const k of keys) {
      const after = pickByCacheAffinity(k, without).id;
      if (before.get(k) !== "b") expect(after).toBe(before.get(k));
      else expect(after).not.toBe("b");
    }
  });
});

describe('getProviderCredentials with fallbackStrategy "cache-affinity"', () => {
  it("pins the same key to the same account across calls and ignores sticky counters", async () => {
    mocks.getProviderConnections.mockResolvedValue([conn("a"), conn("b"), conn("c")]);
    mocks.getSettings.mockResolvedValue({ fallbackStrategy: "cache-affinity" });
    const r1 = await getProviderCredentials("claude", null, "m", { cacheKey: "session-1" });
    const r2 = await getProviderCredentials("claude", null, "m", { cacheKey: "session-1" });
    expect(r1.connectionId).toBe(r2.connectionId);
    expect(mocks.updateProviderConnection).toHaveBeenCalledWith(r1.connectionId, expect.objectContaining({ lastUsedAt: expect.any(String) }));
  });

  it("moves to the next-ranked account when the pinned one is excluded (retry) and honours per-provider override", async () => {
    mocks.getProviderConnections.mockResolvedValue([conn("a"), conn("b"), conn("c")]);
    mocks.getSettings.mockResolvedValue({ providerStrategies: { claude: { fallbackStrategy: "cache-affinity" } } });
    const pinned = await getProviderCredentials("claude", null, "m", { cacheKey: "session-2" });
    const retry = await getProviderCredentials("claude", new Set([pinned.connectionId]), "m", { cacheKey: "session-2" });
    expect(retry.connectionId).not.toBe(pinned.connectionId);
    expect(["a", "b", "c"]).toContain(retry.connectionId);
  });

  it("falls back to fill-first when the request carries no cache key", async () => {
    mocks.getProviderConnections.mockResolvedValue([conn("first", { priority: 1 }), conn("second", { priority: 2 })]);
    mocks.getSettings.mockResolvedValue({ fallbackStrategy: "cache-affinity" });
    const r = await getProviderCredentials("claude", null, "m", {});
    expect(r.connectionId).toBe("first");
  });
});
