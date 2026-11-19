import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const fx = vi.hoisted(() => ({ connections: [], settings: {}, snapshots: {} }));
const update = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@/lib/localDb", () => ({
  getProviderConnections: async () => fx.connections.filter(c => c.isActive !== false),
  getSettings: async () => fx.settings,
  updateProviderConnection: update,
  validateApiKey: vi.fn(), getProxyPools: async () => [],
}));
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: async () => ({}), pickProxyPoolId: vi.fn() }));
vi.mock("@/shared/services/accountQuotaWindows.js", () => ({
  ensureProviderQuotaWindows: vi.fn(), getAccountQuotaSnapshot: id => fx.snapshots[id],
}));
vi.mock("@/sse/utils/logger.js", () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
const { getProviderCredentials } = await import("../../src/sse/services/auth.js");
const now = new Date("2026-11-19T12:00:00Z");
const snap = delay => ({ fetchedAt: now.getTime(), quotas: { weekly: { resetAt: new Date(now.getTime() + delay).toISOString() } } });
const strategy = value => { fx.settings = { providerStrategies: { codex: { fallbackStrategy: value } } }; };

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(now); vi.clearAllMocks();
  fx.connections = [{ id: "a", priority: 1 }, { id: "b", priority: 2 }, { id: "c", priority: 3 }];
  fx.snapshots = { a: snap(9000), b: snap(1000), c: snap(5000) };
  strategy("weekly-reset-asc");
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("provider credential selection strategies", () => {
  it("uses weekly reset ordering for actual credentials", async () => {
    expect((await getProviderCredentials("codex", null, "gpt-5")).connectionId).toBe("b");
    strategy("weekly-reset-desc");
    expect((await getProviderCredentials("codex", null, "gpt-5")).connectionId).toBe("a");
    expect(update).not.toHaveBeenCalled();
  });
  it("retries only other eligible accounts", async () => {
    expect((await getProviderCredentials("codex", new Set(["b"]), "gpt-5")).connectionId).toBe("c");
    expect(await getProviderCredentials("codex", new Set(["a", "b", "c"]), "gpt-5")).toBeNull();
  });
  it("keeps active/model/cooldown eligibility ahead of reset order", async () => {
    fx.connections[1].providerSpecificData = { enabledModels: ["other"] };
    fx.connections[2].isActive = false;
    expect((await getProviderCredentials("codex", null, "gpt-5")).connectionId).toBe("a");
  });
  it("does not select a reset-prioritized account while model cooldown is active", async () => {
    fx.connections[1]["modelLock_gpt-5"] = new Date(now.getTime() + 60000).toISOString();
    expect((await getProviderCredentials("codex", null, "gpt-5")).connectionId).toBe("c");
  });
  it("honors valid pinning but never pins excluded accounts", async () => {
    expect((await getProviderCredentials("codex", null, "gpt-5", { preferredConnectionId: "a" })).connectionId).toBe("a");
    expect((await getProviderCredentials("codex", "a", "gpt-5", { preferredConnectionId: "a" })).connectionId).toBe("b");
  });
  it("falls back to manual order without current windows", async () => {
    fx.snapshots = {};
    expect((await getProviderCredentials("codex")).connectionId).toBe("a");
  });
  it("samples random from eligible pool only", async () => {
    strategy("random"); vi.spyOn(Math, "random").mockReturnValue(0.99);
    expect((await getProviderCredentials("codex", "c")).connectionId).toBe("b");
  });
  it("preserves manual and global strategy behavior", async () => {
    strategy("fill-first");
    expect((await getProviderCredentials("codex")).connectionId).toBe("a");
    fx.settings = { fallbackStrategy: "random" }; vi.spyOn(Math, "random").mockReturnValue(0.99);
    expect((await getProviderCredentials("codex")).connectionId).toBe("c");
  });
  it("preserves round-robin sticky tracking", async () => {
    strategy("round-robin");
    fx.connections[0].lastUsedAt = now.toISOString(); fx.connections[0].consecutiveUseCount = 3;
    expect((await getProviderCredentials("codex")).connectionId).toBe("b");
    expect(update).toHaveBeenCalledWith("b", expect.objectContaining({ consecutiveUseCount: 1 }));
  });
});
