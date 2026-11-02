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
        pingModel: "gpt-5.6-terra",
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
    ({ runQuotaAutoPingTick, configureQuotaAutoPing } = await import("../../src/shared/services/quotaAutoPing.js"));

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
    codexResponseText = vi.fn().mockResolvedValue("");
    getExecutor.mockReturnValue({
      execute: vi.fn().mockResolvedValue({ response: { ok: true, text: codexResponseText } }),
    });
    state = { running: false, resetCache: {}, failureCache: {} };
    vi.setSystemTime(new Date("2026-01-01T12:00:00.000Z"));
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
    deps.getProviderConnections.mockImplementation(async ({ provider }) => (
      provider === "codex" ? [{ id: "codex-1", provider: "codex", authType: "oauth", accessToken: "token" }] : []
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
    deps.getProviderConnections.mockImplementation(async ({ provider }) => (
      provider === "codex" ? [{ id: "codex-1", provider: "codex", authType: "oauth", accessToken: "token" }] : []
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
    deps.getProviderConnections.mockImplementation(async ({ provider }) => (
      provider === "codex" ? [{ id: "codex-1", provider: "codex", authType: "oauth", accessToken: "token" }] : []
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
    deps.getProviderConnections.mockImplementation(async ({ provider }) => (
      provider === "codex"
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
    deps.getProviderConnections.mockImplementation(async ({ provider }) => (
      provider === "codex" ? [{ id: "codex-1", provider: "codex", authType: "oauth", accessToken: "token" }] : []
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
    deps.getProviderConnections.mockImplementation(async ({ provider }) => (
      provider === "codex" ? [{ id: "codex-1", provider: "codex", authType: "oauth", accessToken: "token" }] : []
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
    deps.getProviderConnections.mockImplementation(async ({ provider }) => (
      provider === "codex" ? [{ id: "codex-1", provider: "codex", authType: "oauth", accessToken: "token" }] : []
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
    deps.getProviderConnections.mockImplementation(async ({ provider }) => (
      provider === "codex" ? [{ id: "codex-1", provider: "codex", authType: "oauth", accessToken: "token" }] : []
    ));
    state.resetCache["codex:codex-1"] = "2026-01-01T17:00:00.000Z";
    getCodexUsage.mockResolvedValue({
      quotas: { session: { used: 100, total: 100, remaining: 0, resetAt: "2026-01-01T17:01:00.000Z" } },
    });

    await runQuotaAutoPingTick(deps, state);

    expect(deps.getExecutor).not.toHaveBeenCalled();
    expect(deps.updateProviderConnection).not.toHaveBeenCalled();
  });

  it("sends one tiny gpt-5.6-terra Codex request through the executor", async () => {
    deps.getSettings.mockResolvedValue({ codexAutoPing: { connections: { "codex-1": true } } });
    deps.getProviderConnections.mockImplementation(async ({ provider }) => (
      provider === "codex"
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
      model: "gpt-5.6-terra",
      stream: true,
      credentials: expect.objectContaining({
        accessToken: "token",
        connectionId: "codex-1",
        providerSpecificData: { workspaceId: "ws-1" },
      }),
      body: {
        model: "gpt-5.6-terra",
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
    deps.getProviderConnections.mockImplementation(async ({ provider }) => (
      provider === "codex"
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
    deps.getProviderConnections.mockImplementation(async ({ provider }) => (
      provider === "codex" ? [{ id: "codex-1", provider: "codex", authType: "apikey", accessToken: "token" }] : []
    ));

    await runQuotaAutoPingTick(deps, state);

    expect(getCodexUsage).not.toHaveBeenCalled();
    expect(deps.getExecutor).not.toHaveBeenCalled();
  });

  it("keeps Claude session quota key behavior", async () => {
    deps.getSettings.mockResolvedValue({ claudeAutoPing: { connections: { "claude-1": true } } });
    deps.getProviderConnections.mockImplementation(async ({ provider }) => (
      provider === "claude" ? [{ id: "claude-1", provider: "claude", authType: "oauth", accessToken: "token" }] : []
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
  describe("anchored schedule", () => {
    const schedule = {
      enabled: true,
      anchor: "09:30",
      timezone: "America/Sao_Paulo",
      windowHours: 5,
      slotsPerDay: 3,
    };

    const codexConnection = (extra = {}) => ({
      id: "codex-1", provider: "codex", authType: "oauth", accessToken: "token", ...extra,
    });

    const settingsWithSchedule = (overrides = {}) => ({
      codexAutoPing: {
        connections: { "codex-1": true },
        schedules: { "codex-1": { ...schedule, ...overrides } },
      },
    });

    let connection = codexConnection();

    beforeEach(() => {
      connection = codexConnection();
      deps.getProviderConnections.mockImplementation(async ({ provider }) => (
        provider === "codex" ? [connection] : []
      ));
    });

    it("pings on the 09:30 BRT slot even when resetAt is stable", async () => {
      // 12:31 UTC = 09:31 BRT — the reactive path alone would stay quiet here.
      vi.setSystemTime(new Date("2026-08-20T12:31:00.000Z"));
      deps.getSettings.mockResolvedValue(settingsWithSchedule());
      state.resetCache["codex:codex-1"] = "2026-08-20T20:00:00.000Z";
      getCodexUsage.mockResolvedValue({
        quotas: { session: { used: 1, total: 100, remaining: 99, resetAt: "2026-08-20T20:00:00.000Z" } },
      });

      await runQuotaAutoPingTick(deps, state);

      expect(deps.getExecutor).toHaveBeenCalledTimes(1);
      expect(deps.updateProviderConnection).toHaveBeenCalledWith("codex-1", expect.objectContaining({
        lastPingedSlotKey: "2026-08-20#0",
      }));
    });

    it("does not repeat a slot that was already pinged", async () => {
      vi.setSystemTime(new Date("2026-08-20T12:31:00.000Z"));
      connection = codexConnection({ lastPingedSlotKey: "2026-08-20#0" });
      deps.getSettings.mockResolvedValue(settingsWithSchedule());
      state.resetCache["codex:codex-1"] = "2026-08-20T20:00:00.000Z";
      getCodexUsage.mockResolvedValue({
        quotas: { session: { used: 1, total: 100, remaining: 99, resetAt: "2026-08-20T20:00:00.000Z" } },
      });

      await runQuotaAutoPingTick(deps, state);

      expect(deps.getExecutor).not.toHaveBeenCalled();
    });

    it("stays quiet overnight", async () => {
      // 06:00 UTC = 03:00 BRT, outside every slot.
      vi.setSystemTime(new Date("2026-08-20T06:00:00.000Z"));
      deps.getSettings.mockResolvedValue(settingsWithSchedule());
      state.resetCache["codex:codex-1"] = "2026-08-20T20:00:00.000Z";
      getCodexUsage.mockResolvedValue({
        quotas: { session: { used: 1, total: 100, remaining: 99, resetAt: "2026-08-20T20:00:00.000Z" } },
      });

      await runQuotaAutoPingTick(deps, state);

      expect(deps.getExecutor).not.toHaveBeenCalled();
    });

    it("keeps the reactive ping working alongside the schedule", async () => {
      vi.setSystemTime(new Date("2026-08-20T06:00:00.000Z"));
      deps.getSettings.mockResolvedValue(settingsWithSchedule());
      state.resetCache["codex:codex-1"] = "2026-08-20T20:00:00.000Z";
      getCodexUsage.mockResolvedValue({
        quotas: { session: { used: 1, total: 100, remaining: 99, resetAt: "2026-08-20T20:01:00.000Z" } },
      });

      await runQuotaAutoPingTick(deps, state);

      expect(deps.getExecutor).toHaveBeenCalledTimes(1);
      expect(deps.updateProviderConnection).toHaveBeenCalledWith("codex-1", expect.not.objectContaining({
        lastPingedSlotKey: expect.anything(),
      }));
    });

    it("ignores a disabled schedule", async () => {
      vi.setSystemTime(new Date("2026-08-20T12:31:00.000Z"));
      deps.getSettings.mockResolvedValue(settingsWithSchedule({ enabled: false }));
      state.resetCache["codex:codex-1"] = "2026-08-20T20:00:00.000Z";
      getCodexUsage.mockResolvedValue({
        quotas: { session: { used: 1, total: 100, remaining: 99, resetAt: "2026-08-20T20:00:00.000Z" } },
      });

      await runQuotaAutoPingTick(deps, state);

      expect(deps.getExecutor).not.toHaveBeenCalled();
    });

    it("pings Claude on a slot before its reset is due", async () => {
      vi.setSystemTime(new Date("2026-08-20T12:31:00.000Z"));
      deps.getSettings.mockResolvedValue({
        claudeAutoPing: {
          connections: { "claude-1": true },
          schedules: { "claude-1": schedule },
        },
      });
      deps.getProviderConnections.mockImplementation(async ({ provider }) => (
        provider === "claude" ? [{ id: "claude-1", provider: "claude", authType: "oauth", accessToken: "token" }] : []
      ));
      state.resetCache["claude:claude-1"] = "2026-08-20T23:00:00.000Z";
      getClaudeUsage.mockResolvedValue({
        quotas: { "session (5h)": { resetAt: "2026-08-20T23:00:00.000Z" } },
      });

      await runQuotaAutoPingTick(deps, state);

      expect(deps.proxyAwareFetch).toHaveBeenCalledTimes(1);
      expect(deps.updateProviderConnection).toHaveBeenCalledWith("claude-1", expect.objectContaining({
        lastPingedSlotKey: "2026-08-20#0",
      }));
    });

    it("runs a schedule on a connection with the reactive ping switched off", async () => {
      vi.setSystemTime(new Date("2026-08-20T12:31:00.000Z"));
      deps.getSettings.mockResolvedValue({
        codexAutoPing: {
          connections: { "codex-1": false },
          schedules: { "codex-1": schedule },
        },
      });
      state.resetCache["codex:codex-1"] = "2026-08-20T20:00:00.000Z";
      getCodexUsage.mockResolvedValue({
        quotas: { session: { used: 1, total: 100, remaining: 99, resetAt: "2026-08-20T20:00:00.000Z" } },
      });

      await runQuotaAutoPingTick(deps, state);

      expect(deps.getExecutor).toHaveBeenCalledTimes(1);
      expect(deps.updateProviderConnection).toHaveBeenCalledWith("codex-1", expect.objectContaining({
        lastPingedSlotKey: "2026-08-20#0",
      }));
    });

    it("does not fall back to the reactive ping when only the schedule is on", async () => {
      // resetAt slides, which is exactly what the reactive Codex path pings on.
      vi.setSystemTime(new Date("2026-08-20T06:00:00.000Z"));
      deps.getSettings.mockResolvedValue({
        codexAutoPing: {
          connections: { "codex-1": false },
          schedules: { "codex-1": schedule },
        },
      });
      state.resetCache["codex:codex-1"] = "2026-08-20T20:00:00.000Z";
      getCodexUsage.mockResolvedValue({
        quotas: { session: { used: 1, total: 100, remaining: 99, resetAt: "2026-08-20T20:01:00.000Z" } },
      });

      await runQuotaAutoPingTick(deps, state);

      expect(deps.getExecutor).not.toHaveBeenCalled();
    });

    it("needs the scheduler running for a schedule alone", async () => {
      const { hasAnyAutoPingEnabled } = await import("../../src/shared/services/quotaAutoPing.js");

      expect(hasAnyAutoPingEnabled({ codexAutoPing: { connections: { "codex-1": false } } })).toBe(false);
      expect(hasAnyAutoPingEnabled({
        codexAutoPing: { connections: { "codex-1": false }, schedules: { "codex-1": schedule } },
      })).toBe(true);
      expect(hasAnyAutoPingEnabled({
        codexAutoPing: { connections: {}, schedules: { "codex-1": { ...schedule, enabled: false } } },
      })).toBe(false);
    });

    it("skips the slot when the quota is exhausted", async () => {
      vi.setSystemTime(new Date("2026-08-20T12:31:00.000Z"));
      deps.getSettings.mockResolvedValue(settingsWithSchedule());
      getCodexUsage.mockResolvedValue({
        quotas: { session: { used: 100, total: 100, remaining: 0, resetAt: "2026-08-20T20:00:00.000Z" } },
      });

      await runQuotaAutoPingTick(deps, state);

      expect(deps.getExecutor).not.toHaveBeenCalled();
    });
  });
});
