import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getSettings: vi.fn(),
  updateProviderConnection: vi.fn(),
  resolveConnectionProxyConfig: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
  getSettings: mocks.getSettings,
  updateProviderConnection: mocks.updateProviderConnection,
  getProxyPools: vi.fn(),
  validateApiKey: vi.fn(),
}));

vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: mocks.resolveConnectionProxyConfig,
  pickProxyPoolId: vi.fn(),
}));

vi.mock("@/shared/constants/providers.js", () => ({
  FREE_PROVIDERS: {},
  resolveProviderId: (provider) => provider,
}));

vi.mock("@/sse/utils/logger.js", () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}));

const { getProviderCredentials } = await import("@/sse/services/auth.js");
const { updateStaggerState, computeGroupSignature, getStaggerDecision } = await import("@/shared/services/quotaStagger.js");

describe("quota stagger routing in auth.js", () => {
  const fixedNow = 1770000000000;

  const makeWaitingState = (group, connections, holdMs, lastObservedAtMs = fixedNow) => ({
    groupId: group.id,
    signature: computeGroupSignature(group, connections),
    lastObservedAtMs,
    windowStatus: { session: "inactive" },
    pendingSlots: { session: holdMs },
    plannedSlots: {},
    effectiveDeadlineMs: holdMs,
    waiting: true,
    notBeforeMs: holdMs,
    ready: false,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    mocks.resolveConnectionProxyConfig.mockResolvedValue({});
    mocks.getSettings.mockResolvedValue({});
  });

  it("two Codex A+B with protectWindowStart: selects available account when one is waiting", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(fixedNow);

    const group = {
      id: "grp-cx",
      name: "Codex AB",
      enabled: true,
      connectionIds: ["cx-a", "cx-b"],
      session: { enabled: true, anchorAt: new Date(fixedNow).toISOString() },
      weekly: { enabled: false, anchorAt: null },
      protectWindowStart: true,
    };
    const settings = { quotaStaggerGroups: [group] };

    const rawConnections = [
      { id: "cx-a", provider: "codex", authType: "oauth", accessToken: "token-a", isActive: true },
      { id: "cx-b", provider: "codex", authType: "oauth", accessToken: "token-b", isActive: true },
    ];

    const stateA = updateStaggerState({
      connection: rawConnections[0],
      settings,
      connections: rawConnections,
      quotas: {
        session: { used: 0, total: 100, remaining: 100, resetAt: new Date(fixedNow + 18000000).toISOString() },
      },
      nowMs: fixedNow,
    });

    const stateA2 = updateStaggerState({
      connection: { ...rawConnections[0], quotaStaggerState: stateA },
      settings,
      connections: rawConnections,
      quotas: {
        session: { used: 0, total: 100, remaining: 100, resetAt: new Date(fixedNow + 18000000 + 35000).toISOString() },
      },
      nowMs: fixedNow + 35000,
    });

    const stateB = updateStaggerState({
      connection: rawConnections[1],
      settings,
      connections: rawConnections,
      quotas: {
        session: { used: 0, total: 100, remaining: 100, resetAt: new Date(fixedNow + 18000000).toISOString() },
      },
      nowMs: fixedNow,
    });

    const stateB2 = updateStaggerState({
      connection: { ...rawConnections[1], quotaStaggerState: stateB },
      settings,
      connections: rawConnections,
      quotas: {
        session: { used: 0, total: 100, remaining: 100, resetAt: new Date(fixedNow + 18000000 + 35000).toISOString() },
      },
      nowMs: fixedNow + 35000,
    });

    const connections = [
      { ...rawConnections[0], quotaStaggerState: stateA2 },
      { ...rawConnections[1], quotaStaggerState: stateB2 },
    ];

    mocks.getSettings.mockResolvedValue(settings);
    mocks.getProviderConnections.mockImplementation(async (filter) => {
      if (filter?.provider) {
        return connections.filter((c) => c.provider === filter.provider);
      }
      return connections;
    });

    vi.setSystemTime(fixedNow + 35000);

    const creds = await getProviderCredentials("codex");
    expect(creds).toBeTruthy();
    expect(creds.connectionId).toBe("cx-a");
  });

  it("returns allRateLimited with earliest retryAfter when all candidates are waiting", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(fixedNow);

    const group = {
      id: "grp-cx-waiting",
      name: "Codex AB Waiting",
      enabled: true,
      connectionIds: ["cx-a", "cx-b"],
      session: { enabled: true, anchorAt: new Date(fixedNow).toISOString() },
      weekly: { enabled: false, anchorAt: null },
      protectWindowStart: true,
    };
    const settings = { quotaStaggerGroups: [group] };

    const rawConnections = [
      { id: "cx-a", provider: "codex", authType: "oauth", accessToken: "token-a", isActive: true },
      { id: "cx-b", provider: "codex", authType: "oauth", accessToken: "token-b", isActive: true },
    ];

    const holdA = fixedNow + 300000;
    const holdB = fixedNow + 600000;
    const stateA = makeWaitingState(group, rawConnections, holdA);
    const stateB = makeWaitingState(group, rawConnections, holdB);

    const connections = [
      { ...rawConnections[0], quotaStaggerState: stateA },
      { ...rawConnections[1], quotaStaggerState: stateB },
    ];

    mocks.getSettings.mockResolvedValue(settings);
    mocks.getProviderConnections.mockImplementation(async (filter) => {
      if (filter?.provider) {
        return connections.filter((c) => c.provider === filter.provider);
      }
      return connections;
    });

    const result = await getProviderCredentials("codex");

    expect(result).toMatchObject({
      allRateLimited: true,
      retryAfter: expect.any(String),
      retryAfterHuman: expect.any(String),
      lastError: expect.stringContaining("Quota stagger window protected until"),
      lastErrorCode: 429,
    });

    const earliestExpected = Math.min(stateA.effectiveDeadlineMs, stateB.effectiveDeadlineMs);
    expect(result.retryAfter).toBe(new Date(earliestExpected).toISOString());
    expect(mocks.updateProviderConnection).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ testStatus: "unavailable" })
    );
  });

  it("protectWindowStart false respects toggle and does not exclude waiting connection", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(fixedNow);

    const group = {
      id: "grp-cx-unprotected",
      name: "Codex Unprotected",
      enabled: true,
      connectionIds: ["cx-a", "cx-b"],
      session: { enabled: true, anchorAt: new Date(fixedNow).toISOString() },
      weekly: { enabled: false, anchorAt: null },
      protectWindowStart: false,
    };
    const settings = { quotaStaggerGroups: [group] };

    const rawConnections = [
      { id: "cx-a", provider: "codex", authType: "oauth", accessToken: "token-a", isActive: true },
      { id: "cx-b", provider: "codex", authType: "oauth", accessToken: "token-b", isActive: true },
    ];

    const stateA = makeWaitingState(group, rawConnections, fixedNow + 300000);
    const connections = [
      { ...rawConnections[0], quotaStaggerState: stateA },
      { ...rawConnections[1], quotaStaggerState: null },
    ];

    mocks.getSettings.mockResolvedValue(settings);
    mocks.getProviderConnections.mockImplementation(async (filter) => {
      if (filter?.provider) {
        return connections.filter((c) => c.provider === filter.provider);
      }
      return connections;
    });

    const creds = await getProviderCredentials("codex");
    expect(creds).toBeTruthy();
    expect(creds.connectionId).toBe("cx-a");
  });

  it("active traffic window is not blocked", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(fixedNow);

    const group = {
      id: "grp-cx-active",
      name: "Codex Active",
      enabled: true,
      connectionIds: ["cx-a", "cx-b"],
      session: { enabled: true, anchorAt: new Date(fixedNow).toISOString() },
      weekly: { enabled: false, anchorAt: null },
      protectWindowStart: true,
    };
    const settings = { quotaStaggerGroups: [group] };

    const rawConnections = [
      { id: "cx-a", provider: "codex", authType: "oauth", accessToken: "token-a", isActive: true },
      { id: "cx-b", provider: "codex", authType: "oauth", accessToken: "token-b", isActive: true },
    ];

    const stateActive = updateStaggerState({
      connection: rawConnections[0],
      settings,
      connections: rawConnections,
      quotas: {
        session: { used: 15, total: 100, remaining: 85, resetAt: new Date(fixedNow + 18000000).toISOString() },
      },
      nowMs: fixedNow,
    });

    const connections = [
      { ...rawConnections[0], quotaStaggerState: stateActive },
    ];

    mocks.getSettings.mockResolvedValue(settings);
    mocks.getProviderConnections.mockImplementation(async (filter) => {
      if (filter?.provider) {
        return connections.filter((c) => c.provider === filter.provider);
      }
      return connections;
    });

    const creds = await getProviderCredentials("codex");
    expect(creds).toBeTruthy();
    expect(creds.connectionId).toBe("cx-a");
  });

  it("Antigravity connections are independent and never blocked by stagger waiting", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(fixedNow);

    const group = {
      id: "grp-ag",
      name: "Antigravity Group",
      enabled: true,
      connectionIds: ["ag-1", "ag-2"],
      session: { enabled: true, anchorAt: new Date(fixedNow).toISOString() },
      weekly: { enabled: false, anchorAt: null },
      protectWindowStart: true,
    };
    const settings = { quotaStaggerGroups: [group] };

    const connections = [
      { id: "ag-1", provider: "antigravity", authType: "oauth", accessToken: "token-ag", isActive: true },
      { id: "ag-2", provider: "antigravity", authType: "oauth", accessToken: "token-ag2", isActive: true },
    ];

    mocks.getSettings.mockResolvedValue(settings);
    mocks.getProviderConnections.mockImplementation(async (filter) => {
      if (filter?.provider) {
        return connections.filter((c) => c.provider === filter.provider);
      }
      return connections;
    });

    const creds = await getProviderCredentials("antigravity");
    expect(creds).toBeTruthy();
    expect(creds.connectionId).toBe("ag-1");
  });

  it("unselected connections route normally without stagger interference", async () => {
    const group = {
      id: "grp-other",
      name: "Other Group",
      enabled: true,
      connectionIds: ["cx-x", "cx-y"],
      session: { enabled: true, anchorAt: new Date(fixedNow).toISOString() },
      weekly: { enabled: false, anchorAt: null },
      protectWindowStart: true,
    };
    const settings = { quotaStaggerGroups: [group] };

    const connections = [
      { id: "cx-standalone", provider: "codex", authType: "oauth", accessToken: "token-s", isActive: true },
    ];

    mocks.getSettings.mockResolvedValue(settings);
    mocks.getProviderConnections.mockImplementation(async (filter) => {
      if (filter?.provider) {
        return connections.filter((c) => c.provider === filter.provider);
      }
      return connections;
    });

    const creds = await getProviderCredentials("codex");
    expect(creds).toBeTruthy();
    expect(creds.connectionId).toBe("cx-standalone");
  });

  it("settings disable or membership removal immediately releases waiting connection", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(fixedNow);

    const group = {
      id: "grp-cx-toggle",
      name: "Codex Toggle",
      enabled: true,
      connectionIds: ["cx-a", "cx-b"],
      session: { enabled: true, anchorAt: new Date(fixedNow).toISOString() },
      weekly: { enabled: false, anchorAt: null },
      protectWindowStart: true,
    };

    const rawConnections = [
      { id: "cx-a", provider: "codex", authType: "oauth", accessToken: "token-a", isActive: true },
      { id: "cx-b", provider: "codex", authType: "oauth", accessToken: "token-b", isActive: true },
    ];

    const stateA = makeWaitingState(group, rawConnections, fixedNow + 300000);
    const connections = [
      { ...rawConnections[0], quotaStaggerState: stateA },
    ];

    mocks.getProviderConnections.mockImplementation(async (filter) => {
      if (filter?.provider) {
        return connections.filter((c) => c.provider === filter.provider);
      }
      return connections;
    });

    mocks.getSettings.mockResolvedValue({
      quotaStaggerGroups: [{ ...group, enabled: false }],
    });

    const credsDisabled = await getProviderCredentials("codex");
    expect(credsDisabled).toBeTruthy();
    expect(credsDisabled.connectionId).toBe("cx-a");

    mocks.getSettings.mockResolvedValue({
      quotaStaggerGroups: [{ ...group, enabled: true, connectionIds: ["cx-b", "cx-c"] }],
    });

    const credsRemoved = await getProviderCredentials("codex");
    expect(credsRemoved).toBeTruthy();
    expect(credsRemoved.connectionId).toBe("cx-a");
  });

  it("stale observation (>10m) and signature mismatch fail open", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(fixedNow);

    const group = {
      id: "grp-cx-stale",
      name: "Codex Stale",
      enabled: true,
      connectionIds: ["cx-a", "cx-b"],
      session: { enabled: true, anchorAt: new Date(fixedNow).toISOString() },
      weekly: { enabled: false, anchorAt: null },
      protectWindowStart: true,
    };
    const settings = { quotaStaggerGroups: [group] };

    const rawConnections = [
      { id: "cx-a", provider: "codex", authType: "oauth", accessToken: "token-a", isActive: true },
      { id: "cx-b", provider: "codex", authType: "oauth", accessToken: "token-b", isActive: true },
    ];

    const holdA = fixedNow + 300000;
    const stateA = makeWaitingState(group, rawConnections, holdA);

    const connections = [
      { ...rawConnections[0], quotaStaggerState: stateA },
    ];

    mocks.getSettings.mockResolvedValue(settings);
    mocks.getProviderConnections.mockImplementation(async (filter) => {
      if (filter?.provider) {
        return connections.filter((c) => c.provider === filter.provider);
      }
      return connections;
    });

    vi.setSystemTime(fixedNow + 600001);

    const credsStale = await getProviderCredentials("codex");
    expect(credsStale).toBeTruthy();
    expect(credsStale.connectionId).toBe("cx-a");

    vi.setSystemTime(fixedNow);
    connections[0].quotaStaggerState = { ...stateA, signature: "mismatched-sig" };

    const credsSig = await getProviderCredentials("codex");
    expect(credsSig).toBeTruthy();
    expect(credsSig.connectionId).toBe("cx-a");
  });

  it("combines model lock and stagger delay to report earliest retryAfter", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(fixedNow);

    const group = {
      id: "grp-combo",
      name: "Combo Test",
      enabled: true,
      connectionIds: ["cx-a", "cx-b"],
      session: { enabled: true, anchorAt: new Date(fixedNow).toISOString() },
      weekly: { enabled: false, anchorAt: null },
      protectWindowStart: true,
    };
    const settings = { quotaStaggerGroups: [group] };

    const rawConnections = [
      { id: "cx-a", provider: "codex", authType: "oauth", accessToken: "token-a", isActive: true },
      { id: "cx-b", provider: "codex", authType: "oauth", accessToken: "token-b", isActive: true },
    ];

    const holdA = fixedNow + 3600000;
    const stateA = makeWaitingState(group, rawConnections, holdA);

    const modelLockExpiry = new Date(fixedNow + 7200000).toISOString();
    const connections = [
      { ...rawConnections[0], quotaStaggerState: stateA },
      { ...rawConnections[1], modelLock___all: modelLockExpiry, lastError: "Rate limited" },
    ];

    mocks.getSettings.mockResolvedValue(settings);
    mocks.getProviderConnections.mockImplementation(async (filter) => {
      if (filter?.provider) {
        return connections.filter((c) => c.provider === filter.provider);
      }
      return connections;
    });

    const result = await getProviderCredentials("codex");
    expect(result.allRateLimited).toBe(true);
    expect(result.retryAfter).toBe(new Date(stateA.effectiveDeadlineMs).toISOString());
  });

  it("pinning to preferredConnectionId respects stagger protection", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(fixedNow);

    const group = {
      id: "grp-pin",
      name: "Pin Group",
      enabled: true,
      connectionIds: ["cx-a", "cx-b"],
      session: { enabled: true, anchorAt: new Date(fixedNow).toISOString() },
      weekly: { enabled: false, anchorAt: null },
      protectWindowStart: true,
    };
    const settings = { quotaStaggerGroups: [group] };

    const rawConnections = [
      { id: "cx-a", provider: "codex", authType: "oauth", accessToken: "token-a", isActive: true },
      { id: "cx-b", provider: "codex", authType: "oauth", accessToken: "token-b", isActive: true },
    ];

    const holdA = fixedNow + 300000;
    const stateA = makeWaitingState(group, rawConnections, holdA);

    const connections = [
      { ...rawConnections[0], quotaStaggerState: stateA },
      { ...rawConnections[1], quotaStaggerState: null },
    ];

    mocks.getSettings.mockResolvedValue(settings);
    mocks.getProviderConnections.mockImplementation(async (filter) => {
      if (filter?.provider) {
        return connections.filter((c) => c.provider === filter.provider);
      }
      return connections;
    });

    const creds = await getProviderCredentials("codex", null, null, { preferredConnectionId: "cx-a" });
    expect(creds.connectionId).toBe("cx-b");
  });

  it("computes max applicable per-account eligibility then min across candidates: lock+1m hold+5m vs hold+10m -> retry+5m", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(fixedNow);

    const group = {
      id: "grp-max-min",
      name: "Max Min Group",
      enabled: true,
      connectionIds: ["cx-a", "cx-b"],
      session: { enabled: true, anchorAt: new Date(fixedNow).toISOString() },
      weekly: { enabled: false, anchorAt: null },
      protectWindowStart: true,
    };
    const settings = { quotaStaggerGroups: [group] };

    const rawConnections = [
      { id: "cx-a", provider: "codex", authType: "oauth", accessToken: "token-a", isActive: true },
      { id: "cx-b", provider: "codex", authType: "oauth", accessToken: "token-b", isActive: true },
    ];

    const modelName = "gpt-5.5";
    const lockExpiry = new Date(fixedNow + 60000).toISOString();
    const holdA = fixedNow + 300000;
    const holdB = fixedNow + 600000;

    const stateA = makeWaitingState(group, rawConnections, holdA);
    const stateB = makeWaitingState(group, rawConnections, holdB);

    const connections = [
      { ...rawConnections[0], [`modelLock_${modelName}`]: lockExpiry, quotaStaggerState: stateA },
      { ...rawConnections[1], quotaStaggerState: stateB },
    ];

    mocks.getSettings.mockResolvedValue(settings);
    mocks.getProviderConnections.mockImplementation(async (filter) => {
      if (filter?.provider) {
        return connections.filter((c) => c.provider === filter.provider);
      }
      return connections;
    });

    const result = await getProviderCredentials("codex", null, modelName);
    expect(result).toMatchObject({
      allRateLimited: true,
      retryAfter: new Date(holdA).toISOString(),
    });

    const resultExcludedA = await getProviderCredentials("codex", new Set(["cx-a"]), modelName);
    expect(resultExcludedA).toMatchObject({
      allRateLimited: true,
      retryAfter: new Date(holdB).toISOString(),
    });
  });

  it("does not count unrelated model locks for retry calculation", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(fixedNow);

    const group = {
      id: "grp-unrelated",
      name: "Unrelated Group",
      enabled: true,
      connectionIds: ["cx-a", "cx-b"],
      session: { enabled: true, anchorAt: new Date(fixedNow).toISOString() },
      weekly: { enabled: false, anchorAt: null },
      protectWindowStart: true,
    };
    const settings = { quotaStaggerGroups: [group] };

    const rawConnections = [
      { id: "cx-a", provider: "codex", authType: "oauth", accessToken: "token-a", isActive: true },
      { id: "cx-b", provider: "codex", authType: "oauth", accessToken: "token-b", isActive: true },
    ];

    const modelName = "target-model";
    const holdA = fixedNow + 300000;
    const holdB = fixedNow + 600000;

    const stateA = makeWaitingState(group, rawConnections, holdA);
    const stateB = makeWaitingState(group, rawConnections, holdB);

    const connections = [
      { ...rawConnections[0], modelLock_other_model: new Date(fixedNow + 3600000).toISOString(), quotaStaggerState: stateA },
      { ...rawConnections[1], quotaStaggerState: stateB },
    ];

    mocks.getSettings.mockResolvedValue(settings);
    mocks.getProviderConnections.mockImplementation(async (filter) => {
      if (filter?.provider) {
        return connections.filter((c) => c.provider === filter.provider);
      }
      return connections;
    });

    const result = await getProviderCredentials("codex", null, modelName);
    expect(result).toMatchObject({
      allRateLimited: true,
      retryAfter: new Date(holdA).toISOString(),
    });
  });

  it("avoids fetching all active connections when no enabled relevant stagger group exists", async () => {
    mocks.getSettings.mockResolvedValue({
      quotaStaggerGroups: [
        {
          id: "grp-off",
          name: "Off Group",
          enabled: false,
          connectionIds: ["cx-1", "cx-2"],
          protectWindowStart: true,
        },
      ],
    });

    const connections = [
      { id: "cx-1", provider: "codex", authType: "oauth", accessToken: "token", isActive: true },
    ];

    mocks.getProviderConnections.mockResolvedValue(connections);

    const creds = await getProviderCredentials("codex");
    expect(creds).toBeTruthy();
    expect(creds.connectionId).toBe("cx-1");

    const allActiveCalls = mocks.getProviderConnections.mock.calls.filter((c) => !c[0]?.provider && c[0]?.isActive === true);
    expect(allActiveCalls).toHaveLength(0);
  });

  it("pre-expiry available and exact-reset forecast blocks using actual update core with 6m offset, serialization restarting, and unaffected Antigravity", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(fixedNow);

    const duration5h = 18000000;
    const tA_start = fixedNow + 45 * 60 * 1000;
    const tA_reset = tA_start + duration5h;
    const tB_start = fixedNow + 51 * 60 * 1000;
    const tB_reset = tB_start + duration5h;
    const expectedTargetB = fixedNow + 8 * 3600 * 1000 + 15 * 60 * 1000;

    const group = {
      id: "grp-forecast-6m",
      name: "Codex Forecast 6m Offset",
      enabled: true,
      connectionIds: ["cx-1", "cx-2"],
      session: { enabled: true, anchorAt: new Date(fixedNow).toISOString() },
      weekly: { enabled: false, anchorAt: null },
      protectWindowStart: true,
    };
    const settings = { quotaStaggerGroups: [group] };

    let connections = [
      { id: "cx-1", provider: "codex", authType: "oauth", accessToken: "token-1", isActive: true },
      { id: "cx-2", provider: "codex", authType: "oauth", accessToken: "token-2", isActive: true },
      { id: "ag-unselected", provider: "antigravity", authType: "oauth", accessToken: "token-ag", isActive: true },
    ];

    const pollAt = (timeMs, usedA = 10, usedB = 15, resetA = tA_reset, resetB = tB_reset) => {
      const stateA = updateStaggerState({
        connection: connections[0],
        settings,
        connections,
        quotas: {
          session: { used: usedA, total: 100, remaining: 100 - usedA, resetAt: new Date(resetA).toISOString() },
        },
        nowMs: timeMs,
        observedAtMs: timeMs,
      });
      connections[0] = { ...connections[0], quotaStaggerState: stateA };

      const stateB = updateStaggerState({
        connection: connections[1],
        settings,
        connections,
        quotas: {
          session: { used: usedB, total: 100, remaining: 100 - usedB, resetAt: new Date(resetB).toISOString() },
        },
        nowMs: timeMs,
        observedAtMs: timeMs,
      });
      connections[1] = { ...connections[1], quotaStaggerState: stateB };
    };

    mocks.getSettings.mockResolvedValue(settings);
    mocks.getProviderConnections.mockImplementation(async (filter) => {
      if (filter?.provider) {
        return connections.filter((c) => c.provider === filter.provider);
      }
      return connections;
    });

    const t0 = fixedNow + 60 * 60 * 1000;
    vi.setSystemTime(t0);
    pollAt(t0);

    expect(connections[1].quotaStaggerState.plannedSlots.session.resetMs).toBe(tB_reset);
    expect(connections[1].quotaStaggerState.plannedSlots.session.notBeforeMs).toBe(expectedTargetB);

    const t_pre = tB_reset - 60000;
    vi.setSystemTime(t_pre);
    pollAt(t_pre);

    const decPreA = getStaggerDecision({ connection: connections[0], settings, connections, nowMs: t_pre });
    const decPreB = getStaggerDecision({ connection: connections[1], settings, connections, nowMs: t_pre });
    expect(decPreA.waiting).toBe(false);
    expect(decPreB.waiting).toBe(false);

    const credsPre = await getProviderCredentials("codex");
    expect(credsPre).toBeTruthy();
    expect(credsPre.allRateLimited).toBeFalsy();
    expect(["cx-1", "cx-2"]).toContain(credsPre.connectionId);

    const credsAgPre = await getProviderCredentials("antigravity");
    expect(credsAgPre).toBeTruthy();
    expect(credsAgPre.connectionId).toBe("ag-unselected");

    vi.setSystemTime(tB_reset);
    const decResetB = getStaggerDecision({ connection: connections[1], settings, connections, nowMs: tB_reset });
    expect(decResetB.waiting).toBe(true);
    expect(decResetB.ready).toBe(false);
    expect(decResetB.notBeforeMs).toBe(expectedTargetB);

    const credsPreferred = await getProviderCredentials("codex", null, null, { preferredConnectionId: "cx-2" });
    expect(credsPreferred.connectionId).toBe("cx-1");

    const credsBlocked = await getProviderCredentials("codex", new Set(["cx-1"]));
    expect(credsBlocked).toMatchObject({
      allRateLimited: true,
      retryAfter: new Date(expectedTargetB).toISOString(),
      lastError: expect.stringContaining("Quota stagger window protected until"),
      lastErrorCode: 429,
    });

    const serializedB = JSON.parse(JSON.stringify(connections[1].quotaStaggerState));
    connections[1] = { ...connections[1], quotaStaggerState: serializedB };

    const decRestarted = getStaggerDecision({ connection: connections[1], settings, connections, nowMs: tB_reset });
    expect(decRestarted.waiting).toBe(true);
    expect(decRestarted.ready).toBe(false);
    expect(decRestarted.notBeforeMs).toBe(expectedTargetB);

    const credsRestartedPref = await getProviderCredentials("codex", null, null, { preferredConnectionId: "cx-2" });
    expect(credsRestartedPref.connectionId).toBe("cx-1");

    const credsRestartedBlocked = await getProviderCredentials("codex", new Set(["cx-1"]));
    expect(credsRestartedBlocked).toMatchObject({
      allRateLimited: true,
      retryAfter: new Date(expectedTargetB).toISOString(),
      lastError: expect.stringContaining("Quota stagger window protected until"),
      lastErrorCode: 429,
    });

    const credsAgPost = await getProviderCredentials("antigravity");
    expect(credsAgPost).toBeTruthy();
    expect(credsAgPost.connectionId).toBe("ag-unselected");
  });
});
