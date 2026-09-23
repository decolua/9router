import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QUOTA_ROUTING_PROVIDERS, QUOTA_ROUTING_MAX_AGE_MS, QUOTA_ROUTING_REFRESH_MS, hasQuotaResetFirstEnabled, isQuotaResetFirstEnabled, createQuotaRoutingSnapshot, getConnectionQuotaReset, preferEarliestQuotaReset } from "@/shared/services/quotaRouting.js";

const mocks = vi.hoisted(() => ({ connections: vi.fn(), settings: vi.fn(), update: vi.fn(), group: vi.fn(), decision: vi.fn() }));
vi.mock("@/lib/localDb", () => ({ getProviderConnections: mocks.connections, getSettings: mocks.settings, updateProviderConnection: mocks.update, validateApiKey: vi.fn(), getProxyPools: vi.fn() }));
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: vi.fn(async () => ({})), pickProxyPoolId: vi.fn() }));
vi.mock("@/shared/services/quotaStagger.js", () => ({ getStaggerGroup: mocks.group, getStaggerDecision: mocks.decision }));
vi.mock("@/sse/utils/logger.js", () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn() }));
import { getProviderCredentials } from "@/sse/services/auth.js";

const NOW = 1770000000000;
const row = (delay, remaining = 80) => ({ resetAt: new Date(NOW + delay).toISOString(), remaining, used: 100 - remaining, total: 100 });
const conn = (id, quotas, provider = "codex") => ({ id, provider, authType: "oauth", isActive: true, quotaRoutingSnapshot: createQuotaRoutingSnapshot(provider, { quotas }, NOW) });
const rank = (connection, model = "gpt-5.4") => getConnectionQuotaReset(connection, model, NOW);
const enabled = { providerStrategies: { codex: { quotaResetFirst: true } } };

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("network forbidden"); }));
  mocks.settings.mockResolvedValue(enabled);
  mocks.group.mockReturnValue(null);
});
afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("quota routing snapshots", () => {
  it("requires a strict per-provider opt-in", () => {
    expect(QUOTA_ROUTING_PROVIDERS).toEqual(["codex", "claude", "antigravity", "gemini-cli"]);
    expect(QUOTA_ROUTING_MAX_AGE_MS).toBe(600000);
    expect(QUOTA_ROUTING_REFRESH_MS).toBe(300000);
    expect(hasQuotaResetFirstEnabled(enabled)).toBe(true);
    for (const settings of [{}, { quotaResetFirst: true }, { providerStrategies: { codex: { quotaResetFirst: "true" } } }]) {
      expect(hasQuotaResetFirstEnabled(settings)).toBe(false);
    }
    expect(isQuotaResetFirstEnabled(enabled, "claude")).toBe(false);
    expect(isQuotaResetFirstEnabled({ providerStrategies: { github: { quotaResetFirst: true } } }, "github")).toBe(false);
  });

  it("keeps bounded normalized rows and preserves cached observation time", () => {
    const snapshot = createQuotaRoutingSnapshot("codex", { observedAtMs: NOW - 300000, accessToken: "discard", quotas: { session: { ...row(5000), raw: "discard" }, bad: { ...row(5000), remaining: "80" } } }, NOW);
    expect(snapshot).toEqual({ version: 1, provider: "codex", observedAtMs: NOW - 300000, quotas: { session: { resetMs: NOW + 5000, remaining: 80, used: 20, total: 100, unlimited: false } } });
    const many = Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`key${i}`, row(5000)]));
    expect(Object.keys(createQuotaRoutingSnapshot("codex", { quotas: many }, NOW).quotas)).toHaveLength(256);
  });

  it.each([NOW - 600001, NOW + 60001, null, "1770000000000", NaN, Infinity])("rejects invalid observation %s without restamping", (observedAtMs) => {
    expect(createQuotaRoutingSnapshot("codex", { observedAtMs, quotas: { session: row(10000) } }, NOW)).toBeNull();
    const c = conn("a", { session: row(10000) });
    c.quotaRoutingSnapshot.observedAtMs = observedAtMs;
    expect(rank(c)).toBeNull();
  });

  it("ignores malformed, unlimited, past and unrelated rows", () => {
    for (const value of [null, {}, { ...row(1000), remaining: NaN }, { ...row(1000), total: 0 }, { ...row(1000), used: -1 }, { ...row(1000), resetAt: "bad" }, { ...row(1000), unlimited: true }, row(0), row(-1)]) {
      expect(rank(conn("a", { session: value }))).toBeNull();
    }
    expect(rank(conn("a", { unrelated: row(1000) }))).toBeNull();
    expect(rank(conn("a", { session: row(1000) }), "unknown")).toBeNull();
    expect(rank(conn("a", { session: row(1000) }), "other/gpt-5.4")).toBeNull();
    expect(rank({ ...conn("a", { session: row(1000) }), authType: "apikey" })).toBeNull();
    expect(rank({ ...conn("a", { session: row(1000) }), provider: "github" })).toBeNull();
  });

  it("uses the supplied request start as fallback and preserves original observation time", () => {
    const startedAtMs = NOW - 120000;
    expect(createQuotaRoutingSnapshot("codex", { quotas: { session: row(5000) } }, startedAtMs).observedAtMs).toBe(startedAtMs);
    expect(createQuotaRoutingSnapshot("codex", { observedAtMs: NOW - 240000, quotas: { session: row(5000) } }, startedAtMs).observedAtMs).toBe(NOW - 240000);
  });

  it.each([null, undefined, "", "   ", 42])("does not rank or block without a model: %s", (model) => {
    for (const provider of QUOTA_ROUTING_PROVIDERS) {
      expect(getConnectionQuotaReset(conn("a", { session: row(5000, 0), weekly: row(1000) }, provider), model, NOW)).toBeNull();
    }
  });

  it("rejects invalid snapshot containers, versions and providers", () => {
    const c = conn("a", { session: row(1000) });
    const snapshot = c.quotaRoutingSnapshot;
    for (const quotas of [null, undefined, "invalid", 1, true, Object.assign([], { session: row(1000) })]) {
      expect(createQuotaRoutingSnapshot("codex", { quotas }, NOW)).toBeNull();
      expect(rank({ ...c, quotaRoutingSnapshot: { ...snapshot, quotas } })).toBeNull();
    }
    for (const version of [undefined, null, "1", 0, 2]) {
      expect(rank({ ...c, quotaRoutingSnapshot: { ...snapshot, version } })).toBeNull();
    }
    for (const provider of [undefined, "claude", "unknown"]) {
      expect(rank({ ...c, quotaRoutingSnapshot: { ...snapshot, provider } })).toBeNull();
    }
    expect(rank({ ...c, quotaRoutingSnapshot: null, providerSpecificData: { quotaRouting: snapshot } })).toBeNull();
  });

  it.each([{ used: 101 }, { remaining: 101 }, { used: true }, { remaining: false }, { total: "100" }, { unlimited: "false" }])("rejects misleading row values %j at creation and consumption", (invalid) => {
    const value = { ...row(1000), ...invalid };
    expect(createQuotaRoutingSnapshot("codex", { quotas: { session: value } }, NOW).quotas).toEqual({});
    const c = conn("a", {});
    c.quotaRoutingSnapshot.quotas.session = value;
    expect(rank(c)).toBeNull();
  });

  it("ranks the current Astra model with thinking suffix without guessing unknown Codex pools", () => {
    const c = conn("a", { session: row(9000), weekly: row(3000) });
    expect(rank(c, "gpt-6-astra(max)")).toEqual({ resetMs: NOW + 3000, blockedUntilMs: null });
    expect(rank(c, "gpt-unknown(max)")).toBeNull();
  });

  it("uses exact AG new-model quota without guessing its weekly family", () => {
    const c = conn("a", { "gemini-new-model": row(5000), gemini_weekly: row(1000, 0) }, "antigravity");
    expect(rank(c, "ag/gemini-new-model(max)")).toEqual({ resetMs: NOW + 5000, blockedUntilMs: null });
  });

  it("selects whichever session or weekly resets first and gates all exhausted windows", () => {
    expect(rank(conn("a", { session: row(9000), weekly: row(3000) }))).toEqual({ resetMs: NOW + 3000, blockedUntilMs: null });
    expect(rank(conn("a", { session: row(9000, 0), weekly: row(3000, 0) }))).toEqual({ resetMs: null, blockedUntilMs: NOW + 9000 });
    expect(rank(conn("a", { session: row(9000, 0), weekly: row(3000) }))).toEqual({ resetMs: NOW + 3000, blockedUntilMs: NOW + 9000 });
  });

  it("isolates Codex normal, review and explicit Spark pools", () => {
    const c = conn("a", { session: row(9000), weekly: row(8000), review_session: row(7000), review_weekly: row(6000), spark_session: row(5000), spark_weekly: row(4000) });
    expect(rank(c, "cx/gpt-5.4(high)").resetMs).toBe(NOW + 8000);
    expect(rank(c, "codex/gpt-5.4-review(high)").resetMs).toBe(NOW + 6000);
    expect(rank(c, "gpt-5.3-codex-spark").resetMs).toBe(NOW + 4000);
    expect(rank(c, "gpt-5.3-codex-spark-review").resetMs).toBe(NOW + 6000);
    expect(rank(conn("b", { spark_session: row(1000), review_weekly: row(2000) }))).toBeNull();
    expect(rank(c, "gpt-unknown-spark")).toBeNull();
  });

  it.each(["sonnet", "opus", "fable", "haiku"])("uses exact Claude %s family and global windows", (family) => {
    const c = conn("a", { "session (5h)": row(9000), "weekly (7d)": row(8000), [`weekly ${family} (7d)`]: row(3000), "weekly notsonnet (7d)": row(1000) }, "claude");
    expect(rank(c, `cc/claude-${family}-4-6(high)`).resetMs).toBe(NOW + 3000);
    expect(rank(conn("b", { [`weekly ${family} (7d)`]: row(1000) }, "claude"), "claude-notsonnet-4-6")).toBeNull();
    const other = family === "opus" ? "sonnet" : "opus";
    expect(rank(c, `claude-${other}-4-6`).resetMs).toBe(NOW + 8000);
  });

  it("maps AG registry upstream ids and only the applicable weekly family", () => {
    const c = conn("a", { "gemini-3.7-flash-tiered": row(5000), gemini_weekly: row(3000), claude_gpt_weekly: row(1000), "claude-sonnet-4-6": row(9000) }, "antigravity");
    expect(rank(c, "ag/gemini-3.7-flash-high(high)").resetMs).toBe(NOW + 3000);
    expect(rank(c, "claude-sonnet-4-6").resetMs).toBe(NOW + 1000);
    expect(rank(c, "gpt-oss-120b-medium").resetMs).toBe(NOW + 1000);
    expect(rank(c, "gemini-3.1-flash-image")).toBeNull();
    expect(rank(c, "gemini-unknown")).toBeNull();
    expect(rank(conn("b", { "gemini-3.7-flash-tiered": row(5000) }, "antigravity"), "gemini-3.7-flash-low").resetMs).toBe(NOW + 5000);
  });

  it("uses Gemini exact model only", () => {
    const c = conn("a", { "gemini-2.5-pro": row(5000), "gemini-2.5-flash": row(1000), gemini_weekly: row(500) }, "gemini-cli");
    expect(rank(c, "gc/gemini-2.5-pro(high)").resetMs).toBe(NOW + 5000);
    expect(rank(c, "gemini-unknown")).toBeNull();
  });

  it("returns an order-preserving equal-earliest cohort or unchanged fallback", () => {
    const list = [conn("unknown", {}), conn("later", { session: row(9000) }), conn("early", { weekly: row(1000) }), conn("tie", { session: row(1000) })];
    expect(preferEarliestQuotaReset(list, "gpt-5.4", NOW).map((c) => c.id)).toEqual(["early", "tie"]);
    expect(preferEarliestQuotaReset(list, "unknown", NOW)).toBe(list);
  });
});

describe("auth earliest-reset routing", () => {
  it("returns quota 429 rather than a stale authentication error", async () => {
    mocks.connections.mockResolvedValue([{ ...conn("a", { session: row(5000, 0) }), errorCode: 401, lastError: "old authentication failure" }]);
    expect(await getProviderCredentials("codex", null, "gpt-6-astra(max)")).toMatchObject({
      allRateLimited: true,
      retryAfter: new Date(NOW + 5000).toISOString(),
      lastErrorCode: 429,
      lastError: `Quota exhausted until ${new Date(NOW + 5000).toISOString()}`,
    });
  });

  it("keeps no-model selection unchanged despite exhausted snapshots", async () => {
    mocks.connections.mockResolvedValue([conn("a", { session: row(5000, 0) }), conn("b", { weekly: row(1000) })]);
    expect((await getProviderCredentials("codex")).connectionId).toBe("a");
  });

  it("selects the actual earliest eligible Astra account and releases past exhausted windows", async () => {
    mocks.connections.mockResolvedValue([
      conn("exhausted", { session: row(1000), weekly: row(10000, 0) }),
      conn("later", { session: row(9000) }),
      conn("earliest", { session: row(-1000, 0), weekly: row(3000) }),
      conn("unknown", {}),
    ]);
    expect((await getProviderCredentials("codex", null, "gpt-6-astra(max)")).connectionId).toBe("earliest");
    expect((await getProviderCredentials("codex", "earliest", "gpt-6-astra(max)")).connectionId).toBe("later");
  });
  it("ranks known before unknown and stale; eligible pins still win", async () => {
    const list = [conn("unknown", {}), conn("late", { session: row(9000) }), conn("early", { weekly: row(1000) })];
    mocks.connections.mockResolvedValue(list);
    expect((await getProviderCredentials("codex", null, "gpt-5.4")).connectionId).toBe("early");
    expect((await getProviderCredentials("codex", null, "gpt-5.4", { preferredConnectionId: "late" })).connectionId).toBe("late");
    list[2].quotaRoutingSnapshot.observedAtMs = NOW - 600001;
    expect((await getProviderCredentials("codex", null, "gpt-5.4")).connectionId).toBe("late");
  });

  it("applies exclusion, locks and quota exhaustion before pinning", async () => {
    const list = [conn("excluded", { weekly: row(1000) }), { ...conn("locked", { weekly: row(2000) }), modelLock___all: new Date(NOW + 10000).toISOString() }, conn("empty", { session: row(3000, 0) }), conn("ok", { session: row(9000) })];
    mocks.connections.mockResolvedValue(list);
    for (const preferredConnectionId of ["excluded", "locked", "empty"]) {
      expect((await getProviderCredentials("codex", new Set(["excluded"]), "gpt-5.4", { preferredConnectionId })).connectionId).toBe("ok");
    }
  });

  it("takes max account gate including stagger, then earliest account retry", async () => {
    const list = [{ ...conn("a", { session: row(8000, 0) }), modelLock___all: new Date(NOW + 10000).toISOString() }, conn("b", { weekly: row(15000, 0) })];
    mocks.connections.mockResolvedValue(list);
    mocks.group.mockImplementation((settings, id) => id === "a" ? { protectWindowStart: true } : null);
    mocks.decision.mockReturnValue({ waiting: true, notBeforeMs: NOW + 12000 });
    const result = await getProviderCredentials("codex", null, "gpt-5.4", { preferredConnectionId: "a" });
    expect(result.allRateLimited).toBe(true);
    expect(result.retryAfter).toBe(new Date(NOW + 12000).toISOString());
    mocks.decision.mockReturnValue({ waiting: true, notBeforeMs: NOW + 7000 });
    expect((await getProviderCredentials("codex", null, "gpt-5.4")).retryAfter).toBe(new Date(NOW + 10000).toISOString());
  });

  it("stagger blocks an otherwise earliest pinned account", async () => {
    mocks.connections.mockResolvedValue([conn("a", { weekly: row(1000) }), conn("b", { weekly: row(5000) })]);
    mocks.group.mockImplementation((settings, id) => id === "a" ? { protectWindowStart: true } : null);
    mocks.decision.mockReturnValue({ waiting: true, notBeforeMs: NOW + 12000 });
    expect((await getProviderCredentials("codex", null, "gpt-5.4", { preferredConnectionId: "a" })).connectionId).toBe("b");
  });

  it("keeps off behavior and missing-data fallback unchanged", async () => {
    mocks.settings.mockResolvedValue({ quotaResetFirst: true });
    mocks.connections.mockResolvedValue([conn("a", { weekly: row(1000, 0) }), conn("b", { weekly: row(5000) })]);
    expect((await getProviderCredentials("codex", null, "gpt-5.4")).connectionId).toBe("a");
    mocks.settings.mockResolvedValue(enabled);
    mocks.connections.mockResolvedValue([conn("unknown", {}), conn("unknown2", {})]);
    expect((await getProviderCredentials("codex", null, "gpt-5.4")).connectionId).toBe("unknown");
  });

  it("preserves RR ties but a sticky later reset loses", async () => {
    mocks.settings.mockResolvedValue({ providerStrategies: { codex: { quotaResetFirst: true, fallbackStrategy: "round-robin", stickyRoundRobinLimit: 3 } } });
    const list = [{ ...conn("sticky", { session: row(9000) }), lastUsedAt: new Date(NOW - 1000).toISOString(), consecutiveUseCount: 1 }, conn("early", { weekly: row(1000) })];
    mocks.connections.mockResolvedValue(list);
    expect((await getProviderCredentials("codex", null, "gpt-5.4")).connectionId).toBe("early");
    list[0].quotaRoutingSnapshot = createQuotaRoutingSnapshot("codex", { quotas: { session: row(1000) } }, NOW);
    expect((await getProviderCredentials("codex", null, "gpt-5.4")).connectionId).toBe("sticky");
    list[0].consecutiveUseCount = 3;
    expect((await getProviderCredentials("codex", null, "gpt-5.4")).connectionId).toBe("early");
    mocks.settings.mockResolvedValue({ fallbackStrategy: "round-robin" });
    list[0].consecutiveUseCount = 1;
    expect((await getProviderCredentials("codex", null, "gpt-5.4")).connectionId).toBe("sticky");
  });
});
