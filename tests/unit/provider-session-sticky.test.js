import { createHash } from "crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MEMORY_CONFIG } from "../../open-sse/config/runtimeConfig.js";

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getSettings: vi.fn(),
  updateProviderConnection: vi.fn(),
  validateApiKey: vi.fn(),
  getProxyPools: vi.fn(),
  resolveConnectionProxyConfig: vi.fn(),
  pickProxyPoolId: vi.fn(),
  logDebug: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
  getSettings: mocks.getSettings,
  updateProviderConnection: mocks.updateProviderConnection,
  validateApiKey: mocks.validateApiKey,
  getProxyPools: mocks.getProxyPools,
}));

vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: mocks.resolveConnectionProxyConfig,
  pickProxyPoolId: mocks.pickProxyPoolId,
}));

vi.mock("../../src/sse/utils/logger.js", () => ({
  debug: mocks.logDebug,
  info: mocks.logInfo,
  warn: mocks.logWarn,
  error: mocks.logError,
}));

const {
  classifySessionAffinityFailure,
  getProviderCredentials,
  resetProviderSessionAffinity,
} = await import("../../src/sse/services/auth.js");

function makeConnection(id, priority) {
  return {
    id,
    provider: "kiro",
    authType: "oauth",
    accessToken: `token-${id}`,
    isActive: true,
    priority,
    providerSpecificData: {},
  };
}

describe("provider round-robin session affinity", () => {
  let connections;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-19T00:00:00.000Z"));
    resetProviderSessionAffinity();
    MEMORY_CONFIG.sessionAffinityMaxSize = 5000;
    MEMORY_CONFIG.sessionTtlMs = 2 * 60 * 60 * 1000;
    connections = [
      makeConnection("conn-a", 1),
      makeConnection("conn-b", 2),
    ];
    mocks.getProviderConnections.mockImplementation(async () => connections);
    mocks.getSettings.mockResolvedValue({
      fallbackStrategy: "round-robin",
      stickyRoundRobinLimit: 1,
      providerStrategies: {},
    });
    mocks.resolveConnectionProxyConfig.mockResolvedValue({});
    mocks.updateProviderConnection.mockImplementation(async (id, updates) => {
      Object.assign(connections.find((c) => c.id === id), updates);
      return true;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function select(sessionId, model = "claude-sonnet-4.5", exclude = null, affinityFailure = null) {
    return getProviderCredentials("kiro", exclude, model, { sessionId, affinityFailure });
  }

  it("keeps the same session and canonical upstream model slot on the same account", async () => {
    const first = await select("hermes-thread-1", "claude-sonnet-4.5-thinking(high)");
    const second = await select("hermes-thread-1", "claude-sonnet-4.5");

    expect(first.connectionId).toBe("conn-a");
    expect(second.connectionId).toBe("conn-a");
    expect(second._sessionAffinity.slot).toBe("claude-sonnet-4.5#normal");
    expect(mocks.logDebug).toHaveBeenCalledWith("AUTH", expect.stringContaining("affinity miss"));
    expect(mocks.logDebug).toHaveBeenCalledWith("AUTH", expect.stringContaining("affinity hit"));
  });

  it("preserves capability-family scope when a model has a thinking-level suffix", async () => {
    const review = await getProviderCredentials("codex", null, "gpt-5.6-sol-review(high)", {
      sessionId: "review-thread-1",
    });

    expect(review._sessionAffinity.slot).toBe("gpt-5.6-sol#review");
  });

  it("scopes the same session independently by upstream model", async () => {
    const sonnet = await select("hermes-thread-1", "claude-sonnet-4.5");
    vi.advanceTimersByTime(1);
    const opus = await select("hermes-thread-1", "claude-opus-4.8");

    expect(sonnet.connectionId).toBe("conn-a");
    expect(opus.connectionId).toBe("conn-b");
  });

  it("soft-escapes a transient exclusion without rebinding", async () => {
    const first = await select("hermes-thread-1");
    const failure = {
      ...classifySessionAffinityFailure(429, "busy"),
      connectionId: first.connectionId,
    };
    const fallback = await select("hermes-thread-1", undefined, new Set(["conn-a"]), failure);
    const afterFallback = await select("hermes-thread-1");

    expect(first.connectionId).toBe("conn-a");
    expect(fallback.connectionId).toBe("conn-b");
    expect(fallback._sessionAffinity.selectedFromAffinity).toBe(false);
    expect(afterFallback.connectionId).toBe("conn-a");
    expect(mocks.logInfo).toHaveBeenCalledWith("AUTH", expect.stringContaining("affinity soft escape"));
  });

  it("soft-escapes an active model lock and returns after it clears", async () => {
    await select("hermes-thread-1");
    connections[0]["modelLock_claude-sonnet-4.5"] = new Date(Date.now() + 60_000).toISOString();

    const fallback = await select("hermes-thread-1");
    delete connections[0]["modelLock_claude-sonnet-4.5"];
    const afterUnlock = await select("hermes-thread-1");

    expect(fallback.connectionId).toBe("conn-b");
    expect(afterUnlock.connectionId).toBe("conn-a");
    expect(mocks.logInfo).toHaveBeenCalledWith("AUTH", expect.stringContaining("reason=temporary_model_lock"));
  });

  it("hard-invalidates and rebinds the bound account on a permanent failure", async () => {
    const first = await select("hermes-thread-1");
    const failure = {
      ...classifySessionAffinityFailure(401, "invalid credential"),
      connectionId: first.connectionId,
    };

    const rebound = await select("hermes-thread-1", undefined, new Set(["conn-a"]), failure);
    const afterRebind = await select("hermes-thread-1");

    expect(rebound.connectionId).toBe("conn-b");
    expect(afterRebind.connectionId).toBe("conn-b");
    expect(mocks.logInfo).toHaveBeenCalledWith("AUTH", expect.stringContaining("affinity hard rebind"));
    expect(mocks.logInfo).toHaveBeenCalledWith("AUTH", expect.stringContaining("reason=credential_rejected"));
  });

  it("serializes overlapping hard rebinds without deleting the fresh binding", async () => {
    const first = await select("hermes-thread-1");
    const staleFailure = {
      ...classifySessionAffinityFailure(401, "invalid credential"),
      connectionId: first.connectionId,
    };

    const [firstRetry, secondRetry] = await Promise.all([
      select("hermes-thread-1", undefined, new Set(["conn-a"]), staleFailure),
      select("hermes-thread-1", undefined, new Set(["conn-a"]), staleFailure),
    ]);
    const afterRetries = await select("hermes-thread-1");
    const hardRebindLogs = mocks.logInfo.mock.calls.filter(([, message]) => message.includes("affinity hard rebind"));

    expect(firstRetry.connectionId).toBe("conn-b");
    expect(secondRetry.connectionId).toBe("conn-b");
    expect(afterRetries.connectionId).toBe("conn-b");
    expect(hardRebindLogs).toHaveLength(1);
  });

  it("keeps a hard invalidation when no fallback account is immediately available", async () => {
    const first = await select("hermes-thread-1");
    connections[1]["modelLock_claude-sonnet-4.5"] = new Date(Date.now() + 60_000).toISOString();
    const failure = {
      ...classifySessionAffinityFailure(403, "credential rejected"),
      connectionId: first.connectionId,
    };

    const unavailable = await select("hermes-thread-1", undefined, new Set(["conn-a"]), failure);
    delete connections[1]["modelLock_claude-sonnet-4.5"];
    const laterRebind = await select("hermes-thread-1");

    expect(unavailable.allRateLimited).toBe(true);
    expect(laterRebind.connectionId).toBe("conn-b");
    expect(mocks.logInfo).toHaveBeenCalledWith("AUTH", expect.stringContaining("account=conn-a->none"));
  });

  it("hard-rebinds when the bound account is disabled", async () => {
    await select("hermes-thread-1");
    connections = [connections[1]];

    const rebound = await select("hermes-thread-1");

    expect(rebound.connectionId).toBe("conn-b");
    expect(mocks.logInfo).toHaveBeenCalledWith("AUTH", expect.stringContaining("reason=account_unavailable"));
  });

  it("refreshes LRU recency and evicts the least recently used affinity", async () => {
    MEMORY_CONFIG.sessionAffinityMaxSize = 2;
    await select("session-1");
    vi.advanceTimersByTime(1);
    await select("session-2");
    vi.advanceTimersByTime(1);
    await select("session-1");
    vi.advanceTimersByTime(1);
    await select("session-3");
    vi.advanceTimersByTime(1);

    const session2AfterEviction = await select("session-2");

    expect(session2AfterEviction.connectionId).toBe("conn-a");
    const digest = createHash("sha256").update("session-2").digest("hex");
    const session2Misses = mocks.logDebug.mock.calls.filter(([, message]) => message.includes("affinity miss") && message.includes(digest));
    expect(session2Misses).toHaveLength(2);
  });

  it("expires stale affinity entries by TTL", async () => {
    await select("hermes-thread-1");
    vi.advanceTimersByTime(MEMORY_CONFIG.sessionTtlMs + 1);

    const afterExpiry = await select("hermes-thread-1");

    expect(afterExpiry.connectionId).toBe("conn-b");
    expect(mocks.logInfo).toHaveBeenCalledWith("AUTH", expect.stringContaining("reason=expired"));
  });

  it("stores and logs only the session digest", async () => {
    const rawSessionId = "raw-session-secret-123";
    const digest = createHash("sha256").update(rawSessionId).digest("hex");

    const first = await select(rawSessionId);
    await select(rawSessionId);
    const logs = [...mocks.logDebug.mock.calls, ...mocks.logInfo.mock.calls].map(([, message]) => message).join("\n");

    expect(first._sessionAffinity.digest).toBe(digest);
    expect(logs).toContain(`session=${digest}`);
    expect(logs).not.toContain(rawSessionId);
    expect(logs).not.toContain(rawSessionId.slice(0, 8));
  });

  it("classifies transient pressure separately from permanent failures", () => {
    expect(classifySessionAffinityFailure(429, "quota exceeded")).toEqual({ mode: "soft-escape", reason: "rate_limited" });
    expect(classifySessionAffinityFailure(504, "timeout")).toEqual({ mode: "soft-escape", reason: "timeout" });
    expect(classifySessionAffinityFailure(402, "quota exhausted")).toEqual({ mode: "hard-rebind", reason: "quota_exhausted" });
    expect(classifySessionAffinityFailure(406, "unsupported model")).toEqual({ mode: "hard-rebind", reason: "unsupported_capability" });
  });

  it("keeps existing request-count round robin for traffic without a session", async () => {
    const first = await getProviderCredentials("kiro", null, "claude-sonnet-4.5");
    const second = await getProviderCredentials("kiro", null, "claude-sonnet-4.5");

    expect(first.connectionId).toBe("conn-a");
    expect(second.connectionId).toBe("conn-b");
  });

  it("treats a one-off preferred account as a soft escape from an existing binding", async () => {
    await select("hermes-thread-1");

    const preferred = await getProviderCredentials("kiro", null, "claude-sonnet-4.5", {
      sessionId: "hermes-thread-1",
      preferredConnectionId: "conn-b",
    });
    const afterPreferred = await select("hermes-thread-1");

    expect(preferred.connectionId).toBe("conn-b");
    expect(afterPreferred.connectionId).toBe("conn-a");
    expect(mocks.logInfo).toHaveBeenCalledWith("AUTH", expect.stringContaining("reason=preferred_account"));
  });

  it("keeps non-round-robin selection unchanged when a session is present", async () => {
    mocks.getSettings.mockResolvedValue({ fallbackStrategy: "fill-first", providerStrategies: {} });

    const first = await select("hermes-thread-1");
    const second = await select("hermes-thread-1");

    expect(first.connectionId).toBe("conn-a");
    expect(second.connectionId).toBe("conn-a");
    expect(mocks.logInfo).not.toHaveBeenCalled();
  });
});
