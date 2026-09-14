import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("open-sse/index.js", () => ({}), { virtual: true });

vi.mock("@/lib/localDb", () => ({
  getSettings: vi.fn(),
  getProviderConnections: vi.fn(),
  updateProviderConnection: vi.fn(),
}));

vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: vi.fn(),
}));

vi.mock("@/app/api/usage/[connectionId]/route.js", () => ({
  refreshAndUpdateCredentials: vi.fn(),
}));

vi.mock("@/shared/constants/config", () => ({
  QUOTA_AUTOPING_CONFIG: {
    tickIntervalMs: 60000,
    pingLeadMs: 5000,
    refreshAheadMs: 300000,
    failureCooldownMs: 900000,
    providers: {
      claude: {
        settingsKey: "claudeAutoPing",
        quotaKey: "session (5h)",
        pingModel: "claude-haiku-4-5-20251001",
        pingText: "hi",
        pingMaxTokens: 1,
      },
      codex: {
        settingsKey: "codexAutoPing",
        quotaKey: "session",
        pingWhenResetAtSlides: true,
        resetAtDriftMs: 30000,
        minPingIntervalMs: 600000,
        skipWhenBlockingQuotaExhausted: true,
        pingModel: "gpt-5.5",
        pingText: "hi",
        pingInstructions: "Reply with OK.",
        pingReasoningEffort: "none",
      },
    },
  },
}));

vi.mock("open-sse/providers/shared.js", () => ({
  CLAUDE_CLI_SPOOF_HEADERS: { "anthropic-version": "2023-06-01" },
}));

vi.mock("open-sse/services/usage/shared.js", () => ({
  U: () => ({ baseUrl: "https://chatgpt.com/backend-api/codex/responses" }),
}));

vi.mock("open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(),
}));

vi.mock("open-sse/services/usage/claude.js", () => ({
  getClaudeUsage: vi.fn(),
}));

vi.mock("open-sse/services/usage/codex.js", () => ({
  getCodexUsage: vi.fn(),
}));

vi.mock("open-sse/executors/index.js", () => ({
  getExecutor: vi.fn(),
}));

describe("quota auto-ping", () => {
  let runQuotaAutoPingTick;
  let configureQuotaAutoPing;
  let hasQuotaAutoPingEnabled;
  let deps;
  let state;
  let getCodexUsage;
  let getClaudeUsage;
  let getExecutor;
  let codexResponseText;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useRealTimers();
    delete global.__quotaAutoPing;

    ({ getCodexUsage } = await import("open-sse/services/usage/codex.js"));
    ({ getClaudeUsage } = await import("open-sse/services/usage/claude.js"));
    ({ getExecutor } = await import("open-sse/executors/index.js"));
    ({ runQuotaAutoPingTick, configureQuotaAutoPing, hasQuotaAutoPingEnabled } = await import("../../src/shared/services/quotaAutoPing.js"));

    deps = {
      getSettings: vi.fn(),
      getProviderConnections: vi.fn(),
      updateProviderConnection: vi.fn(),
      resolveConnectionProxyConfig: vi.fn().mockResolvedValue({}),
      refreshAndUpdateCredentials: vi.fn(async (connection) => ({ connection, refreshed: false })),
      proxyAwareFetch: vi.fn().mockResolvedValue({ ok: true }),
      getExecutor: vi.fn(() => ({
        execute: vi.fn().mockResolvedValue({ response: { ok: true, text: codexResponseText } }),
      })),
    };
    codexResponseText = vi.fn().mockResolvedValue([
      "event: response.completed",
      `data: ${JSON.stringify({ type: "response.completed", response: { status: "completed" } })}`,
      "",
    ].join("\r\n"));
    getExecutor.mockReturnValue({
      execute: vi.fn().mockResolvedValue({ response: { ok: true, text: codexResponseText } }),
    });
    state = { running: false, resetCache: {}, failureCache: {} };
    vi.setSystemTime(new Date("2026-01-01T12:00:00.000Z"));
  });

  it.each([false, true])("retains the September due slot with real core and account cooldown=%s", async (cooldown) => {
    const poll = Date.parse("2026-09-14T19:30:36Z");
    const phase = Date.parse("2026-09-14T19:31:37Z");
    const connections = ["A", "B"].map((id) => ({
      id, provider: "codex", authType: "oauth", isActive: true, accessToken: `test-${id}`,
    }));
    connections[1].lastPingAt = "2026-09-14T14:30:42.725Z";
    deps.getSettings.mockResolvedValue({ quotaStaggerGroups: [{
      id: "september", enabled: true, connectionIds: ["A", "B"],
      session: { enabled: true, anchorAt: "2026-09-14T17:01:37Z" },
      weekly: { enabled: true, anchorAt: "2026-09-13T00:00:00Z" },
    }] });
    deps.getProviderConnections.mockImplementation(async ({ provider } = {}) => connections.filter((c) => !provider || c.provider === provider));
    deps.updateProviderConnection.mockImplementation(async (id, patch) => {
      const connection = connections.find((c) => c.id === id);
      Object.assign(connection, JSON.parse(JSON.stringify(patch)));
      return connection;
    });
    const quota = (used, resetMs) => ({ used, total: 100, remaining: 100 - used, resetAt: new Date(resetMs).toISOString() });
    const timeline = [
      { at: "2026-09-14T19:30:36Z", used: 1, reset: "2026-09-14T19:30:44Z" },
      { at: "2026-09-14T19:31:36Z", used: 0, reset: "2026-09-15T00:31:36Z" },
      { at: "2026-09-14T19:32:36Z", used: 0, reset: "2026-09-15T00:32:36Z" },
      { at: "2026-09-14T19:33:36Z", used: cooldown ? 0 : 1, reset: cooldown ? "2026-09-15T00:33:36Z" : "2026-09-15T00:32:36Z" },
    ];
    let sample;
    getCodexUsage.mockImplementation(async (token) => {
      expect(["test-A", "test-B"]).toContain(token);
      const leader = token === "test-A";
      return { observedAtMs: Date.parse(sample.at), quotas: {
        session: leader
          ? quota(100, Date.parse("2026-09-14T22:01:37Z"))
          : quota(sample.used, Date.parse(sample.reset)),
        weekly: quota(leader ? 54 : 42, Date.parse("2026-09-20T00:00:00Z")),
      } };
    });
    const execute = vi.fn().mockImplementation(async () => {
      expect(Date.now()).toBe(Date.parse("2026-09-14T19:32:36Z"));
      expect(connections[1].quotaStaggerState).toMatchObject({
        pendingSlots: { session: phase },
        notBeforeMs: phase,
        ready: true,
        waiting: false,
        windowStatus: { weekly: "active" },
      });
      return { response: { ok: true, text: codexResponseText } };
    });
    deps.getExecutor.mockReturnValue({ execute });
    for (const entry of timeline) {
      sample = entry;
      const offset = Date.parse(sample.at) - poll;
      vi.setSystemTime(Date.parse(sample.at));
      if (cooldown && offset === 120000) state.failureCache["codex:B"] = poll + 60000;
      await runQuotaAutoPingTick(deps, state);
      const saved = connections[1].quotaStaggerState;
      expect(saved.windowStatus.weekly).toBe("active");
      if (offset <= 60000 || cooldown) {
        expect(saved.plannedSlots.session?.notBeforeMs).toBe(phase);
        expect(execute).not.toHaveBeenCalled();
      } else {
        expect(execute).toHaveBeenCalledTimes(1);
        expect(saved.pendingSlots.session).toBeUndefined();
      }
    }
    const pingUpdates = deps.updateProviderConnection.mock.calls.filter(([, patch]) => patch.lastPingAt);
    expect(pingUpdates.map(([id]) => id)).toEqual(cooldown ? [] : ["B"]);
    expect(connections[1].lastPingAt).toBe(cooldown ? "2026-09-14T14:30:42.725Z" : new Date(poll + 120000).toISOString());
    expect(getCodexUsage.mock.calls.filter(([token]) => token === "test-B")).toHaveLength(cooldown ? 2 : 4);
    if (cooldown) {
      expect(state.failureCache["codex:B"]).toBe(poll + 60000);
    } else {
      expect(codexResponseText).toHaveBeenCalledTimes(1);
      expect(connections[1].quotaStaggerState).toMatchObject({ waiting: false, ready: false, windowStatus: { session: "active" } });
    }
    expect(connections[0].lastPingAt).toBeUndefined();
  });

  it("does not ping Codex when setting is absent", async () => {
    deps.getSettings.mockResolvedValue({});

    await runQuotaAutoPingTick(deps, state);

    expect(deps.getProviderConnections).not.toHaveBeenCalled();
    expect(deps.proxyAwareFetch).not.toHaveBeenCalled();
  });

  it("starts the scheduler only when an account opts in", () => {
    vi.useFakeTimers();

    configureQuotaAutoPing({ codexAutoPing: { connections: {} } });
    expect(vi.getTimerCount()).toBe(0);

    configureQuotaAutoPing({ codexAutoPing: { connections: { "codex-1": true } } });
    expect(vi.getTimerCount()).toBe(1);
  });

  it("stops the scheduler when the last account opts out", () => {
    vi.useFakeTimers();
    configureQuotaAutoPing({ claudeAutoPing: { connections: { "claude-1": true } } });

    configureQuotaAutoPing({ claudeAutoPing: { connections: { "claude-1": false } } });

    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not ping Codex on the first resetAt observation", async () => {
    deps.getSettings.mockResolvedValue({ codexAutoPing: { connections: { "codex-1": true } } });
    deps.getProviderConnections.mockImplementation(async ({ provider } = {}) => (
      !provider || provider === "codex" ? [{ id: "codex-1", provider: "codex", authType: "oauth", accessToken: "token" }] : []
    ));
    getCodexUsage.mockResolvedValue({
      quotas: { session: { used: 1, resetAt: "2026-01-01T13:00:00.000Z" } },
    });

    await runQuotaAutoPingTick(deps, state);

    expect(deps.getExecutor).not.toHaveBeenCalled();
    expect(deps.updateProviderConnection).not.toHaveBeenCalled();
    expect(state.resetCache["codex:codex-1"]).toBe("2026-01-01T13:00:00.000Z");
  });

  it("sends Codex ping when session resetAt slides", async () => {
    deps.getSettings.mockResolvedValue({ codexAutoPing: { connections: { "codex-1": true } } });
    deps.getProviderConnections.mockImplementation(async ({ provider } = {}) => (
      !provider || provider === "codex" ? [{ id: "codex-1", provider: "codex", authType: "oauth", accessToken: "token" }] : []
    ));
    state.resetCache["codex:codex-1"] = "2026-01-01T17:00:00.000Z";
    getCodexUsage.mockResolvedValue({
      quotas: { session: { used: 1, total: 100, remaining: 99, resetAt: "2026-01-01T17:01:00.000Z" } },
    });

    await runQuotaAutoPingTick(deps, state);

    const executor = deps.getExecutor.mock.results[0].value;
    expect(executor.execute).toHaveBeenCalledTimes(1);
    expect(deps.updateProviderConnection).toHaveBeenCalledWith("codex-1", expect.objectContaining({
      lastPingedResetAt: "2026-01-01T17:01:00.000Z",
      lastPingedResetKey: "2026-01-01T17:01:00.000Z",
    }));
  });

  it("does not ping Codex when resetAt is stable", async () => {
    deps.getSettings.mockResolvedValue({ codexAutoPing: { connections: { "codex-1": true } } });
    deps.getProviderConnections.mockImplementation(async ({ provider } = {}) => (
      !provider || provider === "codex" ? [{ id: "codex-1", provider: "codex", authType: "oauth", accessToken: "token" }] : []
    ));
    state.resetCache["codex:codex-1"] = "2026-01-01T17:00:00.000Z";
    getCodexUsage.mockResolvedValue({
      quotas: { session: { used: 1, total: 100, remaining: 99, resetAt: "2026-01-01T17:00:00.000Z" } },
    });

    await runQuotaAutoPingTick(deps, state);

    expect(deps.getExecutor).not.toHaveBeenCalled();
    expect(deps.updateProviderConnection).not.toHaveBeenCalled();
  });

  it("does not repeat Codex ping inside the minimum ping interval", async () => {
    deps.getSettings.mockResolvedValue({ codexAutoPing: { connections: { "codex-1": true } } });
    deps.getProviderConnections.mockImplementation(async ({ provider } = {}) => (
      !provider || provider === "codex"
        ? [{ id: "codex-1", provider: "codex", authType: "oauth", accessToken: "token", lastPingAt: "2026-01-01T11:55:00.000Z" }]
        : []
    ));
    state.resetCache["codex:codex-1"] = "2026-01-01T17:00:00.000Z";
    getCodexUsage.mockResolvedValue({
      quotas: { session: { used: 1, total: 100, remaining: 99, resetAt: "2026-01-01T17:01:00.000Z" } },
    });

    await runQuotaAutoPingTick(deps, state);

    expect(deps.getExecutor).not.toHaveBeenCalled();
    expect(deps.updateProviderConnection).not.toHaveBeenCalled();
  });

  it("does not ping Codex just because reported usage is zero", async () => {
    deps.getSettings.mockResolvedValue({ codexAutoPing: { connections: { "codex-1": true } } });
    deps.getProviderConnections.mockImplementation(async ({ provider } = {}) => (
      !provider || provider === "codex" ? [{ id: "codex-1", provider: "codex", authType: "oauth", accessToken: "token" }] : []
    ));
    getCodexUsage.mockResolvedValue({
      quotas: { session: { used: 0, resetAt: "2026-01-01T17:00:00.000Z" } },
    });

    await runQuotaAutoPingTick(deps, state);

    expect(deps.getExecutor).not.toHaveBeenCalled();
    expect(deps.updateProviderConnection).not.toHaveBeenCalled();
    expect(state.resetCache["codex:codex-1"]).toBe("2026-01-01T17:00:00.000Z");
  });

  it("does not ping Codex when weekly quota is exhausted", async () => {
    deps.getSettings.mockResolvedValue({ codexAutoPing: { connections: { "codex-1": true } } });
    deps.getProviderConnections.mockImplementation(async ({ provider } = {}) => (
      !provider || provider === "codex" ? [{ id: "codex-1", provider: "codex", authType: "oauth", accessToken: "token" }] : []
    ));
    state.resetCache["codex:codex-1"] = "2026-01-01T17:00:00.000Z";
    getCodexUsage.mockResolvedValue({
      quotas: {
        session: { used: 0, total: 100, remaining: 100, resetAt: "2026-01-01T17:01:00.000Z" },
        weekly: { used: 100, total: 100, remaining: 0, resetAt: "2026-01-03T12:00:00.000Z" },
      },
    });

    await runQuotaAutoPingTick(deps, state);

    expect(deps.getExecutor).not.toHaveBeenCalled();
    expect(deps.updateProviderConnection).not.toHaveBeenCalled();
  });

  it("does not ping Codex when monthly quota is exhausted", async () => {
    deps.getSettings.mockResolvedValue({ codexAutoPing: { connections: { "codex-1": true } } });
    deps.getProviderConnections.mockImplementation(async ({ provider } = {}) => (
      !provider || provider === "codex" ? [{ id: "codex-1", provider: "codex", authType: "oauth", accessToken: "token" }] : []
    ));
    state.resetCache["codex:codex-1"] = "2026-01-01T17:00:00.000Z";
    getCodexUsage.mockResolvedValue({
      quotas: {
        session: { used: 0, total: 100, remaining: 100, resetAt: "2026-01-01T17:01:00.000Z" },
        monthly: { used: 100, total: 100, remaining: 0, resetAt: "2026-02-01T00:00:00.000Z" },
      },
    });

    await runQuotaAutoPingTick(deps, state);

    expect(deps.getExecutor).not.toHaveBeenCalled();
    expect(deps.updateProviderConnection).not.toHaveBeenCalled();
  });

  it("does not ping Codex when session quota is exhausted", async () => {
    deps.getSettings.mockResolvedValue({ codexAutoPing: { connections: { "codex-1": true } } });
    deps.getProviderConnections.mockImplementation(async ({ provider } = {}) => (
      !provider || provider === "codex" ? [{ id: "codex-1", provider: "codex", authType: "oauth", accessToken: "token" }] : []
    ));
    state.resetCache["codex:codex-1"] = "2026-01-01T17:00:00.000Z";
    getCodexUsage.mockResolvedValue({
      quotas: { session: { used: 100, total: 100, remaining: 0, resetAt: "2026-01-01T17:01:00.000Z" } },
    });

    await runQuotaAutoPingTick(deps, state);

    expect(deps.getExecutor).not.toHaveBeenCalled();
    expect(deps.updateProviderConnection).not.toHaveBeenCalled();
  });

  it("sends one tiny gpt-5.5 Codex request through the executor", async () => {
    deps.getSettings.mockResolvedValue({ codexAutoPing: { connections: { "codex-1": true } } });
    deps.getProviderConnections.mockImplementation(async ({ provider } = {}) => (
      !provider || provider === "codex"
        ? [{ id: "codex-1", provider: "codex", authType: "oauth", accessToken: "token", providerSpecificData: { workspaceId: "ws-1" } }]
        : []
    ));
    state.resetCache["codex:codex-1"] = "2026-01-01T17:00:00.000Z";
    getCodexUsage.mockResolvedValue({
      quotas: { session: { used: 1, total: 100, remaining: 99, resetAt: "2026-01-01T17:01:00.000Z" } },
    });

    await runQuotaAutoPingTick(deps, state);

    const executor = deps.getExecutor.mock.results[0].value;
    expect(deps.getExecutor).toHaveBeenCalledWith("codex");
    expect(executor.execute).toHaveBeenCalledWith(expect.objectContaining({
      model: "gpt-5.5",
      stream: true,
      credentials: expect.objectContaining({
        accessToken: "token",
        connectionId: "codex-1",
        providerSpecificData: { workspaceId: "ws-1" },
      }),
      body: {
        model: "gpt-5.5",
        input: [{
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "hi" }],
        }],
        instructions: "Reply with OK.",
        reasoning: { effort: "none", summary: "auto" },
        store: false,
        stream: true,
      },
    }));
    expect(codexResponseText).toHaveBeenCalledTimes(1);
    expect(deps.updateProviderConnection).toHaveBeenCalledWith("codex-1", expect.objectContaining({
      lastPingedResetAt: "2026-01-01T17:01:00.000Z",
      lastPingedResetKey: "2026-01-01T17:01:00.000Z",
    }));
  });

  it("does not ping same Codex reset twice when seconds drift", async () => {
    deps.getSettings.mockResolvedValue({ codexAutoPing: { connections: { "codex-1": true } } });
    deps.getProviderConnections.mockImplementation(async ({ provider } = {}) => (
      !provider || provider === "codex"
        ? [{ id: "codex-1", provider: "codex", authType: "oauth", accessToken: "token", lastPingedResetAt: "2026-01-01T11:59:44.000Z" }]
        : []
    ));
    state.resetCache["codex:codex-1"] = "2026-01-01T11:59:44.000Z";
    getCodexUsage.mockResolvedValue({
      quotas: { session: { used: 0, total: 100, remaining: 100, resetAt: "2026-01-01T11:59:47.000Z" } },
    });

    await runQuotaAutoPingTick(deps, state);

    expect(deps.getExecutor).not.toHaveBeenCalled();
  });

  it("skips non-OAuth Codex connections", async () => {
    deps.getSettings.mockResolvedValue({ codexAutoPing: { connections: { "codex-1": true } } });
    deps.getProviderConnections.mockImplementation(async ({ provider } = {}) => (
      !provider || provider === "codex" ? [{ id: "codex-1", provider: "codex", authType: "apikey", accessToken: "token" }] : []
    ));

    await runQuotaAutoPingTick(deps, state);

    expect(getCodexUsage).not.toHaveBeenCalled();
    expect(deps.getExecutor).not.toHaveBeenCalled();
  });

  it("keeps Claude session quota key behavior", async () => {
    deps.getSettings.mockResolvedValue({ claudeAutoPing: { connections: { "claude-1": true } } });
    deps.getProviderConnections.mockImplementation(async ({ provider } = {}) => (
      !provider || provider === "claude" ? [{ id: "claude-1", provider: "claude", authType: "oauth", accessToken: "token" }] : []
    ));
    getClaudeUsage.mockResolvedValue({
      quotas: { "session (5h)": { resetAt: "2026-01-01T11:59:00.000Z" } },
    });

    await runQuotaAutoPingTick(deps, state);

    expect(deps.proxyAwareFetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(deps.proxyAwareFetch.mock.calls[0][1].body)).toMatchObject({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1,
      messages: [{ role: "user", content: "hi" }],
    });
  });

  it("starts scheduler when enabled stagger group with active policy is present", () => {
    vi.useFakeTimers();

    configureQuotaAutoPing({
      quotaStaggerGroups: [{ id: "g1", enabled: true, session: { enabled: true }, weekly: { enabled: false } }],
    });
    expect(vi.getTimerCount()).toBe(1);

    configureQuotaAutoPing({
      quotaStaggerGroups: [{ id: "g1", enabled: false, session: { enabled: true }, weekly: { enabled: false } }],
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("two Codex A+B: group opt-in enables auto-ping, persists state, pings ready and holds waiting", async () => {
    const fixedNow = new Date("2026-01-01T12:00:00.000Z").getTime();
    vi.setSystemTime(fixedNow);

    const group = {
      id: "grp-codex",
      name: "Codex AB",
      enabled: true,
      connectionIds: ["cx-a", "cx-b"],
      session: { enabled: true, anchorAt: "2026-01-01T12:00:00.000Z" },
      weekly: { enabled: false, anchorAt: null },
      protectWindowStart: true,
    };

    const conns = [
      { id: "cx-a", provider: "codex", authType: "oauth", accessToken: "token-a", isActive: true },
      { id: "cx-b", provider: "codex", authType: "oauth", accessToken: "token-b", isActive: true },
    ];

    deps.getSettings.mockResolvedValue({ quotaStaggerGroups: [group] });
    deps.getProviderConnections.mockResolvedValue(conns);

    getCodexUsage.mockImplementation(async (token) => ({
      quotas: {
        session: { used: 0, total: 100, remaining: 100, resetAt: "2026-01-01T17:00:00.000Z" },
        weekly: { used: 0, total: 100, remaining: 100, resetAt: "2026-01-08T12:00:00.000Z" },
      },
    }));

    await runQuotaAutoPingTick(deps, state);

    expect(deps.updateProviderConnection).toHaveBeenCalledWith("cx-a", expect.objectContaining({
      quotaStaggerState: expect.any(Object),
    }));
    expect(deps.updateProviderConnection).toHaveBeenCalledWith("cx-b", expect.objectContaining({
      quotaStaggerState: expect.any(Object),
    }));
    expect(deps.getExecutor).not.toHaveBeenCalled();

    const stateA = deps.updateProviderConnection.mock.calls.find((c) => c[0] === "cx-a")[1].quotaStaggerState;
    const stateB = deps.updateProviderConnection.mock.calls.find((c) => c[0] === "cx-b")[1].quotaStaggerState;
    stateA.observations.session.status = "idle";
    stateB.observations.session.status = "idle";
    conns[0].quotaStaggerState = stateA;
    conns[1].quotaStaggerState = stateB;
    deps.updateProviderConnection.mockClear();

    vi.setSystemTime(fixedNow + 30000);
    getCodexUsage.mockImplementation(async (token) => ({
      quotas: {
        session: { used: 0, total: 100, remaining: 100, resetAt: "2026-01-01T17:00:30.000Z" },
        weekly: { used: 0, total: 100, remaining: 100, resetAt: "2026-01-08T12:00:00.000Z" },
      },
    }));

    await runQuotaAutoPingTick(deps, state);

    const executor = deps.getExecutor.mock.results[0].value;
    expect(executor.execute).toHaveBeenCalledTimes(1);
    expect(executor.execute).toHaveBeenCalledWith(expect.objectContaining({
      credentials: expect.objectContaining({ connectionId: "cx-a" }),
    }));

    expect(deps.updateProviderConnection).toHaveBeenCalledWith("cx-a", expect.objectContaining({
      lastPingedResetAt: "2026-01-01T17:00:30.000Z",
      quotaStaggerState: expect.objectContaining({
        lastPingAtMs: fixedNow + 30000,
        suppressUntilMs: fixedNow + 330000,
      }),
    }));

    const pingCallsB = deps.updateProviderConnection.mock.calls.filter((c) => c[0] === "cx-b" && c[1].lastPingAt);
    expect(pingCallsB).toHaveLength(0);
  });

  it("disabling stagger group prevents pings", async () => {
    const fixedNow = new Date("2026-01-01T12:00:00.000Z").getTime();
    vi.setSystemTime(fixedNow);

    const group = {
      id: "grp-codex",
      name: "Codex AB",
      enabled: false,
      connectionIds: ["cx-a", "cx-b"],
      session: { enabled: true, anchorAt: "2026-01-01T12:00:00.000Z" },
      weekly: { enabled: false, anchorAt: null },
    };

    deps.getSettings.mockResolvedValue({ quotaStaggerGroups: [group] });
    deps.getProviderConnections.mockResolvedValue([
      { id: "cx-a", provider: "codex", authType: "oauth", accessToken: "token-a", isActive: true },
      { id: "cx-b", provider: "codex", authType: "oauth", accessToken: "token-b", isActive: true },
    ]);

    await runQuotaAutoPingTick(deps, state);

    expect(deps.getProviderConnections).not.toHaveBeenCalled();
    expect(deps.getExecutor).not.toHaveBeenCalled();
  });

  it("Claude first-use null reset sends tiny ping when stagger slot is ready", async () => {
    const fixedNow = new Date("2026-01-01T12:00:00.000Z").getTime();
    vi.setSystemTime(fixedNow);

    const group = {
      id: "grp-claude",
      name: "Claude Pair",
      enabled: true,
      connectionIds: ["cl-a", "cl-b"],
      session: { enabled: true, anchorAt: "2026-01-01T12:00:00.000Z" },
      weekly: { enabled: false, anchorAt: null },
    };

    const conns = [
      { id: "cl-a", provider: "claude", authType: "oauth", accessToken: "token-claude-a", isActive: true },
      { id: "cl-b", provider: "claude", authType: "oauth", accessToken: "token-claude-b", isActive: true },
    ];

    deps.getSettings.mockResolvedValue({ quotaStaggerGroups: [group] });
    deps.getProviderConnections.mockResolvedValue(conns);
    getClaudeUsage.mockResolvedValue({
      quotas: {
        "session (5h)": { used: 0, total: 100, remaining: 100, resetAt: null },
        "weekly (7d)": { used: 0, total: 100, remaining: 100, resetAt: "2026-01-08T12:00:00.000Z" },
      },
    });

    await runQuotaAutoPingTick(deps, state);

    expect(deps.proxyAwareFetch).toHaveBeenCalledTimes(1);
    expect(deps.updateProviderConnection).toHaveBeenCalledWith("cl-a", expect.objectContaining({
      lastPingedResetAt: null,
      lastPingedResetKey: "first-use",
      quotaStaggerState: expect.objectContaining({
        lastPingAtMs: fixedNow,
      }),
    }));
  });

  it("weekly-only group allows ping when weekly slot ready even if session is already active", async () => {
    const fixedNow = new Date("2026-01-01T12:00:00.000Z").getTime();
    vi.setSystemTime(fixedNow);

    const group = {
      id: "grp-weekly",
      name: "Weekly Only",
      enabled: true,
      connectionIds: ["cx-w1", "cx-w2"],
      session: { enabled: false, anchorAt: null },
      weekly: { enabled: true, anchorAt: "2026-01-01T12:00:00.000Z" },
    };

    const conns = [
      { id: "cx-w1", provider: "codex", authType: "oauth", accessToken: "token-w1", isActive: true },
      { id: "cx-w2", provider: "codex", authType: "oauth", accessToken: "token-w2", isActive: true },
    ];

    deps.getSettings.mockResolvedValue({ quotaStaggerGroups: [group] });
    deps.getProviderConnections.mockResolvedValue(conns);

    getCodexUsage.mockResolvedValue({
      quotas: {
        session: { used: 25, total: 100, remaining: 75, resetAt: "2026-01-01T16:00:00.000Z" },
        weekly: { used: 0, total: 100, remaining: 100, resetAt: "2026-01-08T12:00:00.000Z" },
      },
    });

    await runQuotaAutoPingTick(deps, state);

    const stateW1 = deps.updateProviderConnection.mock.calls.find((c) => c[0] === "cx-w1")[1].quotaStaggerState;
    conns[0].quotaStaggerState = stateW1;
    deps.updateProviderConnection.mockClear();

    vi.setSystemTime(fixedNow + 30000);
    getCodexUsage.mockResolvedValue({
      quotas: {
        session: { used: 25, total: 100, remaining: 75, resetAt: "2026-01-01T16:00:00.000Z" },
        weekly: { used: 0, total: 100, remaining: 100, resetAt: "2026-01-08T12:00:30.000Z" },
      },
    });

    await runQuotaAutoPingTick(deps, state);

    expect(deps.getExecutor).toHaveBeenCalledWith("codex");
    const executor = deps.getExecutor.mock.results[0].value;
    expect(executor.execute).toHaveBeenCalledTimes(1);
    expect(deps.updateProviderConnection).toHaveBeenCalledWith("cx-w1", expect.objectContaining({
      quotaStaggerState: expect.objectContaining({
        lastPingAtMs: fixedNow + 30000,
      }),
    }));
  });

  it("no fallback bypass: group with active session policy does not fall back to legacy ping while waiting", async () => {
    const fixedNow = new Date("2026-01-01T12:00:00.000Z").getTime();
    vi.setSystemTime(fixedNow);

    const group = {
      id: "grp-codex",
      name: "Codex AB",
      enabled: true,
      connectionIds: ["cx-a", "cx-b"],
      session: { enabled: true, anchorAt: "2026-01-01T12:00:00.000Z" },
      weekly: { enabled: false, anchorAt: null },
    };

    const conns = [
      { id: "cx-a", provider: "codex", authType: "oauth", accessToken: "token-a", isActive: true },
      { id: "cx-b", provider: "codex", authType: "oauth", accessToken: "token-b", isActive: true },
    ];

    deps.getSettings.mockResolvedValue({
      codexAutoPing: { connections: { "cx-b": true } },
      quotaStaggerGroups: [group],
    });
    deps.getProviderConnections.mockResolvedValue(conns);

    getCodexUsage.mockResolvedValue({
      quotas: { session: { used: 0, total: 100, remaining: 100, resetAt: "2026-01-01T17:00:00.000Z" } },
    });
    await runQuotaAutoPingTick(deps, state);

    const stateB = deps.updateProviderConnection.mock.calls.find((c) => c[0] === "cx-b")[1].quotaStaggerState;
    conns[1].quotaStaggerState = stateB;
    deps.updateProviderConnection.mockClear();

    vi.setSystemTime(fixedNow + 60000);
    getCodexUsage.mockResolvedValue({
      quotas: { session: { used: 0, total: 100, remaining: 100, resetAt: "2026-01-01T17:01:00.000Z" } },
    });
    await runQuotaAutoPingTick(deps, state);

    const pingCallsB = deps.updateProviderConnection.mock.calls.filter((c) => c[0] === "cx-b" && c[1].lastPingAt);
    expect(pingCallsB).toHaveLength(0);
  });

  it("weekly-only group with active weekly allows independent legacy session warming when legacy toggle true", async () => {
    const fixedNow = new Date("2026-01-01T12:00:00.000Z").getTime();
    vi.setSystemTime(fixedNow);

    const group = {
      id: "grp-weekly",
      name: "Weekly Only",
      enabled: true,
      connectionIds: ["cx-w1", "cx-w2"],
      session: { enabled: false, anchorAt: null },
      weekly: { enabled: true, anchorAt: "2026-01-01T12:00:00.000Z" },
    };

    const conns = [
      { id: "cx-w1", provider: "codex", authType: "oauth", accessToken: "token-w1", isActive: true },
      { id: "cx-w2", provider: "codex", authType: "oauth", accessToken: "token-w2", isActive: true },
    ];

    state.resetCache["codex:cx-w1"] = "2026-01-01T17:00:00.000Z";
    deps.getSettings.mockResolvedValue({
      codexAutoPing: { connections: { "cx-w1": true } },
      quotaStaggerGroups: [group],
    });
    deps.getProviderConnections.mockResolvedValue(conns);

    getCodexUsage.mockResolvedValue({
      quotas: {
        session: { used: 0, total: 100, remaining: 100, resetAt: "2026-01-01T17:01:00.000Z" },
        weekly: { used: 30, total: 100, remaining: 70, resetAt: "2026-01-08T12:00:00.000Z" },
      },
    });

    await runQuotaAutoPingTick(deps, state);

    expect(deps.getExecutor).toHaveBeenCalledWith("codex");
    const executor = deps.getExecutor.mock.results[0].value;
    expect(executor.execute).toHaveBeenCalledTimes(1);
    expect(deps.updateProviderConnection).toHaveBeenCalledWith("cx-w1", expect.objectContaining({
      lastPingedResetAt: "2026-01-01T17:01:00.000Z",
    }));
  });

  it("ping failure sets failureCooldown and does not consume stagger slot via markStaggerPing", async () => {
    const fixedNow = new Date("2026-01-01T12:00:00.000Z").getTime();
    vi.setSystemTime(fixedNow);

    const group = {
      id: "grp-claude",
      name: "Claude Pair",
      enabled: true,
      connectionIds: ["cl-a", "cl-b"],
      session: { enabled: true, anchorAt: "2026-01-01T12:00:00.000Z" },
      weekly: { enabled: false, anchorAt: null },
    };

    const conns = [
      { id: "cl-a", provider: "claude", authType: "oauth", accessToken: "token-claude-a", isActive: true },
      { id: "cl-b", provider: "claude", authType: "oauth", accessToken: "token-claude-b", isActive: true },
    ];

    deps.getSettings.mockResolvedValue({ quotaStaggerGroups: [group] });
    deps.getProviderConnections.mockResolvedValue(conns);
    getClaudeUsage.mockResolvedValue({
      quotas: {
        "session (5h)": { used: 0, total: 100, remaining: 100, resetAt: null },
        "weekly (7d)": { used: 0, total: 100, remaining: 100, resetAt: "2026-01-08T12:00:00.000Z" },
      },
    });
    deps.proxyAwareFetch.mockResolvedValue({ ok: false, status: 500 });

    await runQuotaAutoPingTick(deps, state);

    expect(deps.proxyAwareFetch).toHaveBeenCalledTimes(1);
    expect(state.failureCache["claude:cl-a"]).toBe(fixedNow);
    const pingCallsA = deps.updateProviderConnection.mock.calls.filter((c) => c[0] === "cl-a" && c[1].lastPingAt);
    expect(pingCallsA).toHaveLength(0);
  });

  it("rechecks settings immediately before send and aborts ping if group disabled in DB", async () => {
    const fixedNow = new Date("2026-01-01T12:00:00.000Z").getTime();
    vi.setSystemTime(fixedNow);

    const groupEnabled = {
      id: "grp-claude",
      name: "Claude Pair",
      enabled: true,
      connectionIds: ["cl-a", "cl-b"],
      session: { enabled: true, anchorAt: "2026-01-01T12:00:00.000Z" },
      weekly: { enabled: false, anchorAt: null },
    };
    const groupDisabled = {
      ...groupEnabled,
      enabled: false,
    };

    const conns = [
      { id: "cl-a", provider: "claude", authType: "oauth", accessToken: "token-claude-a", isActive: true },
      { id: "cl-b", provider: "claude", authType: "oauth", accessToken: "token-claude-b", isActive: true },
    ];

    deps.getSettings
      .mockResolvedValueOnce({ quotaStaggerGroups: [groupEnabled] })
      .mockResolvedValueOnce({ quotaStaggerGroups: [groupDisabled] });

    deps.getProviderConnections.mockResolvedValue(conns);
    getClaudeUsage.mockResolvedValue({
      quotas: {
        "session (5h)": { used: 0, total: 100, remaining: 100, resetAt: null },
        "weekly (7d)": { used: 0, total: 100, remaining: 100, resetAt: "2026-01-08T12:00:00.000Z" },
      },
    });

    await runQuotaAutoPingTick(deps, state);

    expect(deps.proxyAwareFetch).not.toHaveBeenCalled();
  });

  it("cross-provider gate loads all active connections once per tick", async () => {
    const fixedNow = new Date("2026-01-01T12:00:00.000Z").getTime();
    vi.setSystemTime(fixedNow);

    const group = {
      id: "grp-cross",
      name: "Cross Codex Claude",
      enabled: true,
      connectionIds: ["cx-x", "cl-y"],
      session: { enabled: true, anchorAt: "2026-01-01T12:00:00.000Z" },
      weekly: { enabled: false, anchorAt: null },
    };

    const allConns = [
      { id: "cx-x", provider: "codex", authType: "oauth", accessToken: "token-cx", isActive: true },
      { id: "cl-y", provider: "claude", authType: "oauth", accessToken: "token-cl", isActive: true },
    ];

    deps.getSettings.mockResolvedValue({ quotaStaggerGroups: [group] });
    deps.getProviderConnections.mockResolvedValue(allConns);

    getCodexUsage.mockResolvedValue({
      quotas: {
        session: { used: 0, total: 100, remaining: 100, resetAt: "2026-01-01T17:00:00.000Z" },
        weekly: { used: 0, total: 100, remaining: 100, resetAt: "2026-01-08T12:00:00.000Z" },
      },
    });
    getClaudeUsage.mockResolvedValue({
      quotas: {
        "session (5h)": { used: 0, total: 100, remaining: 100, resetAt: null },
        "weekly (7d)": { used: 0, total: 100, remaining: 100, resetAt: "2026-01-08T12:00:00.000Z" },
      },
    });

    await runQuotaAutoPingTick(deps, state);

    expect(deps.updateProviderConnection).toHaveBeenCalledWith("cx-x", expect.objectContaining({
      quotaStaggerState: expect.objectContaining({
        groupId: "grp-cross",
      }),
    }));
    expect(deps.updateProviderConnection).toHaveBeenCalledWith("cl-y", expect.objectContaining({
      quotaStaggerState: expect.objectContaining({
        groupId: "grp-cross",
      }),
    }));
  });

  it("unselected Antigravity connection is independent and never auto-pinged", async () => {
    const fixedNow = new Date("2026-01-01T12:00:00.000Z").getTime();
    vi.setSystemTime(fixedNow);

    const group = {
      id: "grp-claude",
      name: "Claude Group",
      enabled: true,
      connectionIds: ["cl-a", "cl-b"],
      session: { enabled: true, anchorAt: "2026-01-01T12:00:00.000Z" },
      weekly: { enabled: false, anchorAt: null },
    };

    const allConns = [
      { id: "cl-a", provider: "claude", authType: "oauth", accessToken: "token-a", isActive: true },
      { id: "cl-b", provider: "claude", authType: "oauth", accessToken: "token-b", isActive: true },
      { id: "ag-1", provider: "antigravity", authType: "oauth", accessToken: "token-ag", isActive: true },
    ];

    deps.getSettings.mockResolvedValue({ quotaStaggerGroups: [group] });
    deps.getProviderConnections.mockResolvedValue(allConns);
    getClaudeUsage.mockResolvedValue({
      quotas: {
        "session (5h)": { used: 0, total: 100, remaining: 100, resetAt: null },
        "weekly (7d)": { used: 0, total: 100, remaining: 100, resetAt: "2026-01-08T12:00:00.000Z" },
      },
    });

    await runQuotaAutoPingTick(deps, state);

    const agUpdates = deps.updateProviderConnection.mock.calls.filter((c) => c[0] === "ag-1");
    expect(agUpdates).toHaveLength(0);
  });

  it("guards exhausted blocking quota for Claude groups", async () => {
    const fixedNow = new Date("2026-01-01T12:00:00.000Z").getTime();
    vi.setSystemTime(fixedNow);

    const group = {
      id: "grp-claude",
      name: "Claude Pair",
      enabled: true,
      connectionIds: ["cl-a", "cl-b"],
      session: { enabled: true, anchorAt: "2026-01-01T12:00:00.000Z" },
      weekly: { enabled: false, anchorAt: null },
    };

    const conns = [
      { id: "cl-a", provider: "claude", authType: "oauth", accessToken: "token-claude-a", isActive: true },
      { id: "cl-b", provider: "claude", authType: "oauth", accessToken: "token-claude-b", isActive: true },
    ];

    deps.getSettings.mockResolvedValue({ quotaStaggerGroups: [group] });
    deps.getProviderConnections.mockResolvedValue(conns);
    getClaudeUsage.mockResolvedValue({
      quotas: {
        "session (5h)": { used: 0, total: 100, remaining: 100, resetAt: null },
        "weekly (7d)": { used: 100, total: 100, remaining: 0, resetAt: "2026-01-08T12:00:00.000Z" },
      },
    });

    await runQuotaAutoPingTick(deps, state);

    expect(deps.proxyAwareFetch).not.toHaveBeenCalled();
  });

  it("conservatively blocks grouped warming when weekly quota is missing", async () => {
    const fixedNow = new Date("2026-01-01T12:00:00.000Z").getTime();
    vi.setSystemTime(fixedNow);

    const group = {
      id: "grp-claude",
      name: "Claude Pair",
      enabled: true,
      connectionIds: ["cl-a", "cl-b"],
      session: { enabled: true, anchorAt: "2026-01-01T12:00:00.000Z" },
      weekly: { enabled: false, anchorAt: null },
    };

    const conns = [
      { id: "cl-a", provider: "claude", authType: "oauth", accessToken: "token-claude-a", isActive: true },
      { id: "cl-b", provider: "claude", authType: "oauth", accessToken: "token-claude-b", isActive: true },
    ];

    deps.getSettings.mockResolvedValue({ quotaStaggerGroups: [group] });
    deps.getProviderConnections.mockResolvedValue(conns);
    getClaudeUsage.mockResolvedValue({
      quotas: {
        "session (5h)": { used: 0, total: 100, remaining: 100, resetAt: null },
      },
    });

    await runQuotaAutoPingTick(deps, state);

    expect(deps.proxyAwareFetch).not.toHaveBeenCalled();
  });

  it("aborts send if connection added to enabled group mid-tick", async () => {
    const fixedNow = new Date("2026-01-01T12:00:00.000Z").getTime();
    vi.setSystemTime(fixedNow);

    const conns = [
      { id: "codex-1", provider: "codex", authType: "oauth", accessToken: "token", isActive: true },
      { id: "codex-2", provider: "codex", authType: "oauth", accessToken: "token-2", isActive: true },
    ];

    state.resetCache["codex:codex-1"] = "2026-01-01T17:00:00.000Z";
    deps.getProviderConnections.mockResolvedValue(conns);
    getCodexUsage.mockResolvedValue({
      quotas: {
        session: { used: 0, total: 100, remaining: 100, resetAt: "2026-01-01T17:01:00.000Z" },
        weekly: { used: 0, total: 100, remaining: 100, resetAt: "2026-01-08T12:00:00.000Z" },
      },
    });

    const groupWaiting = {
      id: "grp-midtick",
      name: "Midtick",
      enabled: true,
      connectionIds: ["codex-1", "codex-2"],
      session: { enabled: true, anchorAt: "2026-01-01T14:30:00.000Z" },
      weekly: { enabled: false, anchorAt: null },
    };

    deps.getSettings
      .mockResolvedValueOnce({ codexAutoPing: { connections: { "codex-1": true } } })
      .mockResolvedValueOnce({
        codexAutoPing: { connections: { "codex-1": true } },
        quotaStaggerGroups: [groupWaiting],
      });

    await runQuotaAutoPingTick(deps, state);

    expect(deps.getExecutor).not.toHaveBeenCalled();
    expect(state.failureCache["codex:codex-1"]).toBeUndefined();

    vi.setSystemTime(new Date("2026-01-01T14:30:00.000Z").getTime());
    deps.getSettings.mockResolvedValue({
      codexAutoPing: { connections: { "codex-1": true } },
      quotaStaggerGroups: [groupWaiting],
    });

    await runQuotaAutoPingTick(deps, state);

    expect(deps.updateProviderConnection).toHaveBeenCalledWith("codex-1", expect.objectContaining({
      quotaStaggerState: expect.any(Object),
    }));
  });

  it("two idle Codex real 60s ticks with pure core updates and persists state", async () => {
    const fixedNow = new Date("2026-01-01T12:00:00.000Z").getTime();
    vi.setSystemTime(fixedNow - 60000);

    const group = {
      id: "grp-pure",
      name: "Pure Core",
      enabled: true,
      connectionIds: ["cx-a", "cx-b"],
      session: { enabled: true, anchorAt: "2026-01-01T12:00:00.000Z" },
      weekly: { enabled: false, anchorAt: null },
    };

    const conns = [
      { id: "cx-a", provider: "codex", authType: "oauth", accessToken: "tok-a", isActive: true },
      { id: "cx-b", provider: "codex", authType: "oauth", accessToken: "tok-b", isActive: true },
    ];

    deps.getSettings.mockResolvedValue({ quotaStaggerGroups: [group] });
    deps.getProviderConnections.mockResolvedValue(conns);

    getCodexUsage.mockImplementation(async () => ({
      quotas: {
        session: { used: 0, total: 100, remaining: 100, resetAt: new Date(fixedNow + 18000000 - 60000).toISOString() },
        weekly: { used: 0, total: 100, remaining: 100, resetAt: "2026-01-08T12:00:00.000Z" },
      },
    }));

    await runQuotaAutoPingTick(deps, state);

    expect(deps.updateProviderConnection).toHaveBeenCalledWith("cx-a", expect.objectContaining({
      quotaStaggerState: expect.any(Object),
    }));
    expect(deps.updateProviderConnection).toHaveBeenCalledWith("cx-b", expect.objectContaining({
      quotaStaggerState: expect.any(Object),
    }));
    expect(deps.getExecutor).not.toHaveBeenCalled();

    const stateA = deps.updateProviderConnection.mock.calls.find((c) => c[0] === "cx-a")[1].quotaStaggerState;
    const stateB = deps.updateProviderConnection.mock.calls.find((c) => c[0] === "cx-b")[1].quotaStaggerState;
    conns[0].quotaStaggerState = stateA;
    conns[1].quotaStaggerState = stateB;
    deps.updateProviderConnection.mockClear();

    vi.setSystemTime(fixedNow);
    getCodexUsage.mockImplementation(async () => ({
      quotas: {
        session: { used: 0, total: 100, remaining: 100, resetAt: new Date(fixedNow + 18000000).toISOString() },
        weekly: { used: 0, total: 100, remaining: 100, resetAt: "2026-01-08T12:00:00.000Z" },
      },
    }));

    await runQuotaAutoPingTick(deps, state);

    const executor = deps.getExecutor.mock.results[0].value;
    expect(executor.execute).toHaveBeenCalledTimes(1);
    expect(executor.execute).toHaveBeenCalledWith(expect.objectContaining({
      credentials: expect.objectContaining({ connectionId: "cx-a" }),
    }));
    expect(deps.updateProviderConnection).toHaveBeenCalledWith("cx-a", expect.objectContaining({
      quotaStaggerState: expect.objectContaining({
        lastPingAtMs: fixedNow,
      }),
    }));

    const pingCallsB = deps.updateProviderConnection.mock.calls.filter((c) => c[0] === "cx-b" && c[1].lastPingAt);
    expect(pingCallsB).toHaveLength(0);
  });

  it("Claude cached sample after ping does not re-trigger immediate ping during suppression", async () => {
    const fixedNow = new Date("2026-01-01T12:00:00.000Z").getTime();
    vi.setSystemTime(fixedNow);

    const group = {
      id: "grp-claude",
      name: "Claude Pair",
      enabled: true,
      connectionIds: ["cl-a", "cl-b"],
      session: { enabled: true, anchorAt: "2026-01-01T12:00:00.000Z" },
      weekly: { enabled: false, anchorAt: null },
    };

    const conns = [
      { id: "cl-a", provider: "claude", authType: "oauth", accessToken: "token-claude-a", isActive: true },
      { id: "cl-b", provider: "claude", authType: "oauth", accessToken: "token-claude-b", isActive: true },
    ];

    deps.getSettings.mockResolvedValue({ quotaStaggerGroups: [group] });
    deps.getProviderConnections.mockResolvedValue(conns);
    getClaudeUsage.mockResolvedValue({
      quotas: {
        "session (5h)": { used: 0, total: 100, remaining: 100, resetAt: null },
        "weekly (7d)": { used: 0, total: 100, remaining: 100, resetAt: "2026-01-08T12:00:00.000Z" },
      },
    });

    await runQuotaAutoPingTick(deps, state);

    expect(deps.proxyAwareFetch).toHaveBeenCalledTimes(1);
    const pingedCallsA = deps.updateProviderConnection.mock.calls.filter((c) => c[0] === "cl-a" && c[1].lastPingAt);
    conns[0].quotaStaggerState = pingedCallsA[0][1].quotaStaggerState;

    deps.proxyAwareFetch.mockClear();
    deps.updateProviderConnection.mockClear();

    vi.setSystemTime(fixedNow + 60000);
    getClaudeUsage.mockResolvedValue({
      observedAtMs: fixedNow - 500,
      quotas: {
        "session (5h)": { used: 0, total: 100, remaining: 100, resetAt: null },
        "weekly (7d)": { used: 0, total: 100, remaining: 100, resetAt: "2026-01-08T12:00:00.000Z" },
      },
    });

    await runQuotaAutoPingTick(deps, state);

    expect(deps.proxyAwareFetch).not.toHaveBeenCalled();
  });

  it("fixed weekly active-to-zero rollover does not impose hold", async () => {
    const fixedNow = new Date("2026-01-01T12:00:00.000Z").getTime();
    vi.setSystemTime(fixedNow);

    const group = {
      id: "grp-weekly-fixed",
      name: "Weekly Fixed",
      enabled: true,
      connectionIds: ["cl-a", "cl-b"],
      session: { enabled: false, anchorAt: null },
      weekly: { enabled: true, anchorAt: "2026-01-01T12:00:00.000Z" },
    };

    const conns = [
      { id: "cl-a", provider: "claude", authType: "oauth", accessToken: "token-claude-a", isActive: true },
      { id: "cl-b", provider: "claude", authType: "oauth", accessToken: "token-claude-b", isActive: true },
    ];

    deps.getSettings.mockResolvedValue({ quotaStaggerGroups: [group] });
    deps.getProviderConnections.mockResolvedValue(conns);
    getClaudeUsage.mockResolvedValue({
      quotas: {
        "session (5h)": { used: 0, total: 100, remaining: 100, resetAt: "2026-01-01T17:00:00.000Z" },
        "weekly (7d)": { used: 0, total: 100, remaining: 100, resetAt: "2026-01-08T12:00:00.000Z" },
      },
    });

    await runQuotaAutoPingTick(deps, state);

    expect(deps.proxyAwareFetch).not.toHaveBeenCalled();
  });

  it("hasQuotaAutoPingEnabled exports shared logic and starts scheduler with legacy absent but group enabled", () => {
    expect(hasQuotaAutoPingEnabled({})).toBe(false);
    expect(hasQuotaAutoPingEnabled({ codexAutoPing: { connections: { "cx-1": true } } })).toBe(true);
    expect(hasQuotaAutoPingEnabled({
      quotaStaggerGroups: [{ id: "g1", enabled: true, session: { enabled: true }, weekly: { enabled: false } }],
    })).toBe(true);
    expect(hasQuotaAutoPingEnabled({
      quotaStaggerGroups: [{ id: "g1", enabled: false, session: { enabled: true }, weekly: { enabled: false } }],
    })).toBe(false);
    expect(hasQuotaAutoPingEnabled({
      quotaStaggerGroups: [{ id: "g1", enabled: true, session: { enabled: false }, weekly: { enabled: false } }],
    })).toBe(false);
  });

  describe("PR-3991 realignment and Codex stream hardening", () => {
    it("two Codex near 6m offset ordering with reverse DB", async () => {
      const fixedNow = new Date("2026-01-01T12:00:00.000Z").getTime();
      vi.setSystemTime(fixedNow);

      const group = {
        id: "grp-offset-codex",
        name: "Codex 6m Offset",
        enabled: true,
        connectionIds: ["cx-ref", "cx-fol"],
        session: { enabled: true, anchorAt: "2026-01-01T12:00:00.000Z" },
        weekly: { enabled: false, anchorAt: null },
      };

      const connRef = { id: "cx-ref", provider: "codex", authType: "oauth", accessToken: "token-ref", isActive: true };
      const connFol = { id: "cx-fol", provider: "codex", authType: "oauth", accessToken: "token-fol", isActive: true };

      // DB returns them in reverse priority: follower first, reference second
      deps.getSettings.mockResolvedValue({ quotaStaggerGroups: [group] });
      deps.getProviderConnections.mockResolvedValue([connFol, connRef]);

      const executionOrder = [];
      getCodexUsage.mockImplementation(async (token) => {
        if (token === "token-ref") {
          executionOrder.push("cx-ref");
          return {
            quotas: {
              session: { used: 10, total: 100, remaining: 90, resetAt: "2026-01-01T17:00:00.000Z" },
              weekly: { used: 10, total: 100, remaining: 90, resetAt: "2026-01-08T12:00:00.000Z" },
            },
          };
        }
        executionOrder.push("cx-fol");
        return {
          quotas: {
            session: { used: 15, total: 100, remaining: 85, resetAt: "2026-01-01T17:06:00.000Z" },
            weekly: { used: 15, total: 100, remaining: 85, resetAt: "2026-01-08T12:06:00.000Z" },
          },
        };
      });

      await runQuotaAutoPingTick(deps, state);

      // Leader/reference cx-ref MUST be processed first regardless of reverse DB priority
      expect(executionOrder).toEqual(["cx-ref", "cx-fol"]);
    });

    it("mixed leader Claude follower Codex reference update same scan", async () => {
      const fixedNow = new Date("2026-01-01T12:00:00.000Z").getTime();
      vi.setSystemTime(fixedNow);

      const group = {
        id: "grp-mixed-scan",
        name: "Claude Leader Codex Follower",
        enabled: true,
        connectionIds: ["cl-lead", "cx-follow"],
        session: { enabled: true, anchorAt: "2026-01-01T12:00:00.000Z" },
        weekly: { enabled: false, anchorAt: null },
      };

      const connLead = { id: "cl-lead", provider: "claude", authType: "oauth", accessToken: "tok-cl", isActive: true };
      const connFollow = { id: "cx-follow", provider: "codex", authType: "oauth", accessToken: "tok-cx", isActive: true };

      // DB returns them in reverse provider order
      deps.getSettings.mockResolvedValue({ quotaStaggerGroups: [group] });
      deps.getProviderConnections.mockResolvedValue([connFollow, connLead]);

      getClaudeUsage.mockResolvedValue({
        quotas: {
          "session (5h)": { used: 0, total: 100, remaining: 100, resetAt: null },
          "weekly (7d)": { used: 0, total: 100, remaining: 100, resetAt: "2026-01-08T12:00:00.000Z" },
        },
      });

      let followerObservedLeaderState = null;
      getCodexUsage.mockImplementation(async () => {
        // Follower reads shared allActiveConnections entry for leader during tick execution
        return {
          quotas: {
            session: { used: 10, total: 100, remaining: 90, resetAt: "2026-01-01T17:00:00.000Z" },
            weekly: { used: 10, total: 100, remaining: 90, resetAt: "2026-01-08T12:00:00.000Z" },
          },
        };
      });

      await runQuotaAutoPingTick(deps, state);

      // Leader Claude pinged and state updated in DB
      expect(deps.proxyAwareFetch).toHaveBeenCalledTimes(1);
      const leadUpdate = deps.updateProviderConnection.mock.calls.find((c) => c[0] === "cl-lead" && c[1].lastPingAt);
      expect(leadUpdate).toBeDefined();

      // Follower Codex state was computed in the same tick using leader's updated reference epoch
      const followUpdate = deps.updateProviderConnection.mock.calls.find((c) => c[0] === "cx-follow");
      expect(followUpdate).toBeDefined();
      expect(followUpdate[1].quotaStaggerState.phaseAnchors.session).toBe(fixedNow);
    });

    it("pin/wait later depends on core ready only when due", async () => {
      const fixedNow = new Date("2026-01-01T12:00:00.000Z").getTime();
      vi.setSystemTime(fixedNow);

      const group = {
        id: "grp-due-check",
        name: "Due Check Group",
        enabled: true,
        connectionIds: ["cx-lead", "cx-fol"],
        session: { enabled: true, anchorAt: "2026-01-01T12:00:00.000Z" },
        weekly: { enabled: false, anchorAt: null },
      };

      const conns = [
        { id: "cx-lead", provider: "codex", authType: "oauth", accessToken: "tok-lead", isActive: true },
        { id: "cx-fol", provider: "codex", authType: "oauth", accessToken: "tok-fol", isActive: true },
      ];

      deps.getSettings.mockResolvedValue({ quotaStaggerGroups: [group] });
      deps.getProviderConnections.mockResolvedValue(conns);
      getCodexUsage.mockResolvedValue({
        quotas: {
          session: { used: 10, total: 100, remaining: 90, resetAt: "2026-01-01T17:00:00.000Z" },
          weekly: { used: 10, total: 100, remaining: 90, resetAt: "2026-01-08T12:00:00.000Z" },
        },
      });

      // Case 1: Core reports waiting for forecast at reset -> ping is held, not sent
      deps.getStaggerDecision = vi.fn().mockReturnValue({
        groupId: "grp-due-check",
        waiting: true,
        notBeforeMs: fixedNow + 600000,
        ready: false,
      });

      await runQuotaAutoPingTick(deps, state);

      expect(deps.getExecutor).not.toHaveBeenCalled();
      const pingCalls1 = deps.updateProviderConnection.mock.calls.filter((c) => c[1].lastPingAt);
      expect(pingCalls1).toHaveLength(0);

      // Case 2: Core reports ready only when due -> ping is sent and marked
      deps.updateProviderConnection.mockClear();
      deps.getStaggerDecision = vi.fn().mockImplementation(({ connection }) => {
        if (connection.id === "cx-lead") {
          return { groupId: "grp-due-check", waiting: false, notBeforeMs: fixedNow, ready: true };
        }
        return { groupId: "grp-due-check", waiting: true, notBeforeMs: fixedNow + 9000000, ready: false };
      });

      await runQuotaAutoPingTick(deps, state);

      expect(deps.getExecutor).toHaveBeenCalledWith("codex");
      const executor = deps.getExecutor.mock.results[0].value;
      expect(executor.execute).toHaveBeenCalledTimes(1);

      const leadPingUpdate = deps.updateProviderConnection.mock.calls.find((c) => c[0] === "cx-lead" && c[1].lastPingAt);
      expect(leadPingUpdate).toBeDefined();

      const folPingUpdate = deps.updateProviderConnection.mock.calls.find((c) => c[0] === "cx-fol" && c[1].lastPingAt);
      expect(folPingUpdate).toBeUndefined();
    });

    it("Codex sendPing fails when stream returns response.failed event", async () => {
      deps.getSettings.mockResolvedValue({ codexAutoPing: { connections: { "codex-1": true } } });
      deps.getProviderConnections.mockResolvedValue([
        { id: "codex-1", provider: "codex", authType: "oauth", accessToken: "token" },
      ]);
      state.resetCache["codex:codex-1"] = "2026-01-01T17:00:00.000Z";
      getCodexUsage.mockResolvedValue({
        quotas: { session: { used: 1, total: 100, remaining: 99, resetAt: "2026-01-01T17:01:00.000Z" } },
      });

      codexResponseText.mockResolvedValue([
        "event: response.failed",
        `data: ${JSON.stringify({ type: "response.failed", error: { message: "Internal failure" } })}`,
        "",
      ].join("\n"));

      await runQuotaAutoPingTick(deps, state);

      expect(state.failureCache["codex:codex-1"]).toBeDefined();
      const pingUpdate = deps.updateProviderConnection.mock.calls.find((c) => c[0] === "codex-1" && c[1].lastPingAt);
      expect(pingUpdate).toBeUndefined();
    });

    it("Codex sendPing fails when stream returns response.incomplete event", async () => {
      deps.getSettings.mockResolvedValue({ codexAutoPing: { connections: { "codex-1": true } } });
      deps.getProviderConnections.mockResolvedValue([
        { id: "codex-1", provider: "codex", authType: "oauth", accessToken: "token" },
      ]);
      state.resetCache["codex:codex-1"] = "2026-01-01T17:00:00.000Z";
      getCodexUsage.mockResolvedValue({
        quotas: { session: { used: 1, total: 100, remaining: 99, resetAt: "2026-01-01T17:01:00.000Z" } },
      });

      codexResponseText.mockResolvedValue([
        "event: response.incomplete",
        `data: ${JSON.stringify({ type: "response.incomplete", response: { status: "incomplete" } })}`,
        "",
      ].join("\n"));

      await runQuotaAutoPingTick(deps, state);

      expect(state.failureCache["codex:codex-1"]).toBeDefined();
      const pingUpdate = deps.updateProviderConnection.mock.calls.find((c) => c[0] === "codex-1" && c[1].lastPingAt);
      expect(pingUpdate).toBeUndefined();
    });

    it("Codex sendPing fails when stream closes prematurely without terminal event", async () => {
      deps.getSettings.mockResolvedValue({ codexAutoPing: { connections: { "codex-1": true } } });
      deps.getProviderConnections.mockResolvedValue([
        { id: "codex-1", provider: "codex", authType: "oauth", accessToken: "token" },
      ]);
      state.resetCache["codex:codex-1"] = "2026-01-01T17:00:00.000Z";
      getCodexUsage.mockResolvedValue({
        quotas: { session: { used: 1, total: 100, remaining: 99, resetAt: "2026-01-01T17:01:00.000Z" } },
      });

      codexResponseText.mockResolvedValue([
        "event: response.created",
        `data: ${JSON.stringify({ type: "response.created", response: { id: "resp_1" } })}`,
        "",
      ].join("\n"));

      await runQuotaAutoPingTick(deps, state);

      expect(state.failureCache["codex:codex-1"]).toBeDefined();
      const pingUpdate = deps.updateProviderConnection.mock.calls.find((c) => c[0] === "codex-1" && c[1].lastPingAt);
      expect(pingUpdate).toBeUndefined();
    });

    it("Codex sendPing parses chunked streaming response body via reader and TextDecoder with multiline CRLF", async () => {
      deps.getSettings.mockResolvedValue({ codexAutoPing: { connections: { "codex-1": true } } });
      deps.getProviderConnections.mockResolvedValue([
        { id: "codex-1", provider: "codex", authType: "oauth", accessToken: "token" },
      ]);
      state.resetCache["codex:codex-1"] = "2026-01-01T17:00:00.000Z";
      getCodexUsage.mockResolvedValue({
        quotas: { session: { used: 1, total: 100, remaining: 99, resetAt: "2026-01-01T17:01:00.000Z" } },
      });

      const encoder = new TextEncoder();
      const chunks = [
        encoder.encode("event: response.created\r\ndata: {}\r\n\r\n"),
        encoder.encode("event: response.completed\r\ndata: {\"type\": \"response.completed\", \"response\": {\"status\": \"completed\"}}\r\n\r\n"),
        encoder.encode("data: [DONE]\r\n\r\n"),
      ];

      let chunkIdx = 0;
      const reader = {
        read: vi.fn(async () => {
          if (chunkIdx < chunks.length) {
            return { done: false, value: chunks[chunkIdx++] };
          }
          return { done: true, value: undefined };
        }),
        releaseLock: vi.fn(),
      };

      deps.getExecutor.mockReturnValue({
        execute: vi.fn().mockResolvedValue({
          response: {
            ok: true,
            body: { getReader: () => reader },
          },
        }),
      });

      await runQuotaAutoPingTick(deps, state);

      expect(reader.read).toHaveBeenCalled();
      expect(reader.releaseLock).toHaveBeenCalled();
      expect(deps.updateProviderConnection).toHaveBeenCalledWith("codex-1", expect.objectContaining({
        lastPingedResetAt: "2026-01-01T17:01:00.000Z",
      }));
    });

    it("Codex sendPing treats stream reader read error as failure and preserves cooldown", async () => {
      deps.getSettings.mockResolvedValue({ codexAutoPing: { connections: { "codex-1": true } } });
      deps.getProviderConnections.mockResolvedValue([
        { id: "codex-1", provider: "codex", authType: "oauth", accessToken: "token" },
      ]);
      state.resetCache["codex:codex-1"] = "2026-01-01T17:00:00.000Z";
      getCodexUsage.mockResolvedValue({
        quotas: { session: { used: 1, total: 100, remaining: 99, resetAt: "2026-01-01T17:01:00.000Z" } },
      });

      const reader = {
        read: vi.fn().mockRejectedValue(new Error("Network connection lost")),
        releaseLock: vi.fn(),
      };

      deps.getExecutor.mockReturnValue({
        execute: vi.fn().mockResolvedValue({
          response: {
            ok: true,
            body: { getReader: () => reader },
          },
        }),
      });

      await runQuotaAutoPingTick(deps, state);

      expect(reader.releaseLock).toHaveBeenCalled();
      expect(state.failureCache["codex:codex-1"]).toBeDefined();
      const pingUpdate = deps.updateProviderConnection.mock.calls.find((c) => c[0] === "codex-1" && c[1].lastPingAt);
      expect(pingUpdate).toBeUndefined();
    });
  });
});
