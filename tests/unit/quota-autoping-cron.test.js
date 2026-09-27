import { describe, it, expect, vi, afterEach } from "vitest";
import {
  parseCronExpression,
  isValidCronExpression,
  cronMatches,
  cronFireKey,
  firstMatchingExpression,
  latestDueFire,
  zonedParts,
} from "@/shared/services/cronMatcher";
import { readCronEntry, runCronPing, runQuotaAutoPingTick, configureQuotaAutoPing, stopQuotaAutoPing } from "@/shared/services/quotaAutoPing";
import { QUOTA_AUTOPING_CONFIG } from "@/shared/constants/config";

// 2026-09-21 is a Monday.
const at = (iso) => new Date(iso);

describe("cron expression parsing", () => {
  it("accepts the shapes the UI can produce", () => {
    for (const expression of ["* * * * *", "0 */5 * * *", "30 9 * * 1-5", "0 0,6,12,18 * * *", "15 3 1 jan mon", "@hourly"]) {
      expect(isValidCronExpression(expression)).toBe(true);
    }
  });

  it("rejects malformed expressions instead of matching everything", () => {
    for (const expression of ["", "* * * *", "* * * * * *", "60 * * * *", "* 24 * * *", "a * * * *", "*/0 * * * *", "5-1 * * * *", null, undefined]) {
      expect(isValidCronExpression(expression)).toBe(false);
      expect(cronMatches(expression, at("2026-09-21T00:00:00Z"))).toBe(false);
    }
  });

  it("expands steps and ranges", () => {
    const cron = parseCronExpression("0 */6 * * *");
    expect([...cron.hour]).toEqual([0, 6, 12, 18]);
    expect([...cron.minute]).toEqual([0]);
  });

  it("treats day-of-week 7 as Sunday", () => {
    expect([...parseCronExpression("0 0 * * 7").dayOfWeek]).toEqual([0]);
  });
});

describe("cron matching", () => {
  it("matches on the exact minute only", () => {
    expect(cronMatches("30 9 * * *", at("2026-09-21T09:30:00Z"), "UTC")).toBe(true);
    expect(cronMatches("30 9 * * *", at("2026-09-21T09:31:00Z"), "UTC")).toBe(false);
    expect(cronMatches("30 9 * * *", at("2026-09-21T10:30:00Z"), "UTC")).toBe(false);
  });

  it("evaluates in the configured timezone, not the server's", () => {
    // 00:00 UTC is 09:00 in Seoul (UTC+9).
    expect(cronMatches("0 9 * * *", at("2026-09-21T00:00:00Z"), "Asia/Seoul")).toBe(true);
    expect(cronMatches("0 9 * * *", at("2026-09-21T00:00:00Z"), "UTC")).toBe(false);
  });

  it("falls back to local time for an invalid timezone", () => {
    expect(() => zonedParts(at("2026-09-21T00:00:00Z"), "Not/AZone")).not.toThrow();
  });

  it("ORs day-of-month with day-of-week when both are restricted", () => {
    // 2026-09-21 is a Monday and the 21st.
    expect(cronMatches("0 0 21 * 5", at("2026-09-21T00:00:00Z"), "UTC")).toBe(true); // dom hits
    expect(cronMatches("0 0 1 * 1", at("2026-09-21T00:00:00Z"), "UTC")).toBe(true);  // dow hits
    expect(cronMatches("0 0 1 * 5", at("2026-09-21T00:00:00Z"), "UTC")).toBe(false); // neither
  });

  it("picks the first matching expression of a list", () => {
    const expressions = ["0 3 * * *", "0 9 * * *", "0 15 * * *"];
    expect(firstMatchingExpression(expressions, at("2026-09-21T09:00:00Z"), "UTC")).toBe("0 9 * * *");
    expect(firstMatchingExpression(expressions, at("2026-09-21T10:00:00Z"), "UTC")).toBe(null);
  });

  it("produces a stable per-minute fire key", () => {
    const a = cronFireKey("0 9 * * *", at("2026-09-21T09:00:00Z"), "UTC");
    const b = cronFireKey("0 9 * * *", at("2026-09-21T09:00:59Z"), "UTC");
    const next = cronFireKey("0 9 * * *", at("2026-09-22T09:00:00Z"), "UTC");
    expect(a).toBe(b);
    expect(a).not.toBe(next);
  });
});

describe("readCronEntry", () => {
  it("returns null unless the entry is usable", () => {
    expect(readCronEntry(undefined)).toBe(null);
    expect(readCronEntry({ enabled: false, expressions: ["0 * * * *"] })).toBe(null);
    expect(readCronEntry({ expressions: [] })).toBe(null);
    expect(readCronEntry({ expressions: ["  "] })).toBe(null);
  });

  it("defaults the ping text and api transport", () => {
    const entry = readCronEntry({ expressions: ["0 */5 * * *"] });
    expect(entry.text).toBe(QUOTA_AUTOPING_CONFIG.cronPingText);
    expect(entry.via).toBe("api");
  });

  it("keeps an explicit text, timezone and cli transport", () => {
    const entry = readCronEntry({ expressions: ["0 9 * * *"], text: "Only Hi", timezone: "Asia/Seoul", via: "cli" });
    expect(entry).toMatchObject({ text: "Only Hi", timezone: "Asia/Seoul", via: "cli" });
  });

  it("caps the number of expressions", () => {
    const many = Array.from({ length: 50 }, (_, i) => `${i % 60} * * * *`);
    expect(readCronEntry({ expressions: many }).expressions).toHaveLength(QUOTA_AUTOPING_CONFIG.cronMaxExpressions);
  });
});

function harness(overrides = {}) {
  const connection = { id: "conn-1", accessToken: "tok", providerSpecificData: {}, ...overrides.connection };
  const deps = {
    resolveConnectionProxyConfig: vi.fn(async () => ({})),
    refreshAndUpdateCredentials: vi.fn(async (conn) => ({ connection: conn })),
    updateProviderConnection: vi.fn(async () => {}),
    getExecutor: vi.fn(),
  };
  const handler = {
    getUsage: vi.fn(async () => ({ quotas: { "session (5h)": { remaining: 100 } } })),
    sendPing: vi.fn(async () => true),
    sendPingViaCli: vi.fn(async () => true),
    ...overrides.handler,
  };
  const state = { resetCache: {}, failureCache: {}, running: false };
  return { connection, deps, handler, state, providerConfig: QUOTA_AUTOPING_CONFIG.providers.claude };
}

describe("runCronPing", () => {
  const cron = { expressions: ["0 9 * * *"], timezone: "UTC", text: "Only Hi", via: "api" };

  it("does nothing when no expression matches the current minute", async () => {
    const h = harness();
    await runCronPing(h.connection, "claude", h.providerConfig, h.handler, cron, h.deps, h.state, at("2026-09-21T10:00:00Z"));
    expect(h.handler.sendPing).not.toHaveBeenCalled();
  });

  it("sends the configured text and records the fire key", async () => {
    const h = harness();
    await runCronPing(h.connection, "claude", h.providerConfig, h.handler, cron, h.deps, h.state, at("2026-09-21T09:00:00Z"));
    expect(h.handler.sendPing).toHaveBeenCalledTimes(1);
    expect(h.handler.sendPing.mock.calls[0][1].pingText).toBe("Only Hi");
    const update = h.deps.updateProviderConnection.mock.calls[0][1];
    expect(update.lastCronFireKey).toBe(cronFireKey("0 9 * * *", at("2026-09-21T09:00:00Z"), "UTC"));
    expect(update.lastPingAt).toBeTruthy();
  });

  it("does not re-fire within the same minute after a restart", async () => {
    const fireKey = cronFireKey("0 9 * * *", at("2026-09-21T09:00:00Z"), "UTC");
    const h = harness({ connection: { lastCronFireKey: fireKey } });
    await runCronPing(h.connection, "claude", h.providerConfig, h.handler, cron, h.deps, h.state, at("2026-09-21T09:00:30Z"));
    expect(h.handler.sendPing).not.toHaveBeenCalled();
  });

  it("skips when the quota is already exhausted", async () => {
    const h = harness({ handler: { getUsage: vi.fn(async () => ({ quotas: { "session (5h)": { remaining: 0 } } })) } });
    await runCronPing(h.connection, "claude", h.providerConfig, h.handler, cron, h.deps, h.state, at("2026-09-21T09:00:00Z"));
    expect(h.handler.sendPing).not.toHaveBeenCalled();
    expect(h.deps.updateProviderConnection).not.toHaveBeenCalled();
  });

  it("still pings when the usage probe itself fails", async () => {
    const h = harness({ handler: { getUsage: vi.fn(async () => { throw new Error("usage down"); }) } });
    await runCronPing(h.connection, "claude", h.providerConfig, h.handler, cron, h.deps, h.state, at("2026-09-21T09:00:00Z"));
    expect(h.handler.sendPing).toHaveBeenCalledTimes(1);
  });

  it("routes through the CLI when the schedule opts in", async () => {
    const h = harness();
    await runCronPing(h.connection, "claude", h.providerConfig, h.handler, { ...cron, via: "cli" }, h.deps, h.state, at("2026-09-21T09:00:00Z"));
    expect(h.handler.sendPingViaCli).toHaveBeenCalledTimes(1);
    expect(h.handler.sendPing).not.toHaveBeenCalled();
  });

  it("records a failure and does not mark the minute as fired", async () => {
    const h = harness({ handler: { sendPing: vi.fn(async () => false) } });
    await runCronPing(h.connection, "claude", h.providerConfig, h.handler, cron, h.deps, h.state, at("2026-09-21T09:00:00Z"));
    // The failure is recorded so the dashboard can show it — but never as the
    // fire key, or the retry inside the catch-up window would be suppressed.
    expect(h.deps.updateProviderConnection).toHaveBeenCalledTimes(1);
    const update = h.deps.updateProviderConnection.mock.calls[0][1];
    expect(update.lastCronFireKey).toBeUndefined();
    expect(update.lastCronFailedAt).toBeTruthy();
    expect(update.lastCronFailedFor).toBe(cronFireKey("0 9 * * *", at("2026-09-21T09:00:00Z"), "UTC"));
    expect(h.state.failureCache["cron:claude:conn-1"]).toBeTruthy();
  });

  it("does not ping while a recent failure is still cooling down", async () => {
    const h = harness();
    h.state.failureCache["cron:claude:conn-1"] = at("2026-09-21T09:00:00Z").getTime();
    await runCronPing(h.connection, "claude", h.providerConfig, h.handler, cron, h.deps, h.state, at("2026-09-21T09:00:00Z"));
    expect(h.handler.sendPing).not.toHaveBeenCalled();
  });

  it("aborts when the credential refresh fails", async () => {
    const h = harness();
    h.deps.refreshAndUpdateCredentials = vi.fn(async () => { throw new Error("refresh failed"); });
    await runCronPing(h.connection, "claude", h.providerConfig, h.handler, cron, h.deps, h.state, at("2026-09-21T09:00:00Z"));
    expect(h.handler.sendPing).not.toHaveBeenCalled();
    expect(h.state.failureCache["cron:claude:conn-1"]).toBeTruthy();
  });
});

function tickHarness({ settings, connections, handler = {} }) {
  const sendPing = vi.fn(async () => true);
  const deps = {
    getSettings: vi.fn(async () => settings),
    getProviderConnections: vi.fn(async () => connections),
    updateProviderConnection: vi.fn(async () => {}),
    resolveConnectionProxyConfig: vi.fn(async () => ({})),
    refreshAndUpdateCredentials: vi.fn(async (conn) => ({ connection: conn })),
    proxyAwareFetch: vi.fn(),
    getExecutor: vi.fn(),
    providerHandlers: {
      claude: {
        getUsage: vi.fn(async () => ({ quotas: { "session (5h)": { remaining: 100, resetAt: new Date(Date.now() + 3600000).toISOString() } } })),
        sendPing,
        ...handler,
      },
    },
  };
  return { deps, sendPing, state: { resetCache: {}, failureCache: {}, running: false } };
}

const oauthConn = (overrides = {}) => ({
  id: "conn-1",
  authType: "oauth",
  accessToken: "tok",
  providerSpecificData: {},
  ...overrides,
});

describe("runQuotaAutoPingTick with cron schedules", () => {
  // "* * * * *" matches whatever minute the test runs in.
  const everyMinute = { enabled: true, expressions: ["* * * * *"], timezone: "UTC", text: "Only Hi" };

  it("pings a cron-only connection even when the reset-based toggle is off", async () => {
    const h = tickHarness({
      settings: { claudeAutoPing: { connections: {}, cron: { "conn-1": everyMinute } } },
      connections: [oauthConn()],
    });
    await runQuotaAutoPingTick(h.deps, h.state);
    expect(h.sendPing).toHaveBeenCalledTimes(1);
    expect(h.sendPing.mock.calls[0][1].pingText).toBe("Only Hi");
  });

  it("ignores a disabled schedule", async () => {
    const h = tickHarness({
      settings: { claudeAutoPing: { connections: {}, cron: { "conn-1": { ...everyMinute, enabled: false } } } },
      connections: [oauthConn()],
    });
    await runQuotaAutoPingTick(h.deps, h.state);
    expect(h.sendPing).not.toHaveBeenCalled();
    expect(h.deps.getProviderConnections).not.toHaveBeenCalled();
  });

  it("does not ping a connection that has no schedule of its own", async () => {
    const h = tickHarness({
      settings: { claudeAutoPing: { connections: {}, cron: { "other-conn": everyMinute } } },
      connections: [oauthConn()],
    });
    await runQuotaAutoPingTick(h.deps, h.state);
    expect(h.sendPing).not.toHaveBeenCalled();
  });

  it("skips non-oauth connections", async () => {
    const h = tickHarness({
      settings: { claudeAutoPing: { connections: {}, cron: { "conn-1": everyMinute } } },
      connections: [oauthConn({ authType: "apikey" })],
    });
    await runQuotaAutoPingTick(h.deps, h.state);
    expect(h.sendPing).not.toHaveBeenCalled();
  });

  it("keeps a failing connection from aborting the rest of the tick", async () => {
    const h = tickHarness({
      settings: { claudeAutoPing: { connections: {}, cron: { "conn-1": everyMinute, "conn-2": everyMinute } } },
      connections: [oauthConn(), oauthConn({ id: "conn-2" })],
    });
    h.deps.resolveConnectionProxyConfig = vi.fn(async (data) => {
      if (data?.boom) throw new Error("proxy config exploded");
      return {};
    });
    h.deps.getProviderConnections = vi.fn(async () => [
      oauthConn({ providerSpecificData: { boom: true } }),
      oauthConn({ id: "conn-2" }),
    ]);
    await runQuotaAutoPingTick(h.deps, h.state);
    expect(h.sendPing).toHaveBeenCalledTimes(1);
  });
});

describe("configureQuotaAutoPing", () => {
  afterEach(() => stopQuotaAutoPing());

  it("starts the scheduler for a cron-only configuration", () => {
    configureQuotaAutoPing({ claudeAutoPing: { connections: {}, cron: { "conn-1": { expressions: ["0 9 * * *"] } } } });
    expect(global.__quotaAutoPing.interval).toBeTruthy();
  });

  it("stays stopped when nothing is configured", () => {
    configureQuotaAutoPing({ claudeAutoPing: { connections: {}, cron: {} } });
    expect(global.__quotaAutoPing.interval).toBeFalsy();
  });

  it("starts for a claude-cli schedule too", () => {
    configureQuotaAutoPing({ claudeCliAutoPing: { connections: {}, cron: { "cli-1": { expressions: ["0 9 * * *"] } } } });
    expect(global.__quotaAutoPing.interval).toBeTruthy();
  });
});

// The Claude Code CLI provider differs from every other auto-ping provider in
// three ways that each used to stop its schedule dead:
//   - its accounts are stored with authType "none", and the tick skipped
//     anything that was not "oauth";
//   - it has no OAuth token on this server, so the unconditional token refresh
//     failed on every tick and returned before pinging;
//   - it has no usage endpoint, so there is no quota to consult.
// These drive the real shipped handler (no providerHandlers override) so the
// executor wiring is exercised, not a stand-in for it.
describe("claude-cli schedules (local credentials)", () => {
  const everyMinute = { enabled: true, expressions: ["* * * * *"], timezone: "UTC", text: "Only Hi", via: "cli" };

  const cliConn = (overrides = {}) => ({
    id: "cli-1",
    authType: "none",
    accessToken: "cli",
    providerSpecificData: { oauthToken: "sk-ant-oat01-for-this-account", kind: "token" },
    ...overrides,
  });

  function cliHarness({ settings, connections = [cliConn()], ok = true, body = "data: {}\n\n" }) {
    const executed = [];
    const deps = {
      getSettings: vi.fn(async () => settings),
      getProviderConnections: vi.fn(async () => connections),
      updateProviderConnection: vi.fn(async () => {}),
      resolveConnectionProxyConfig: vi.fn(async () => ({})),
      refreshAndUpdateCredentials: vi.fn(async (conn) => ({ connection: conn })),
      proxyAwareFetch: vi.fn(),
      getExecutor: vi.fn(() => ({
        execute: async (args) => {
          executed.push(args);
          return { response: { ok, text: async () => body, body: null } };
        },
      })),
    };
    return { deps, executed, state: { resetCache: {}, failureCache: {}, running: false } };
  }

  const cronOnly = { claudeCliAutoPing: { connections: {}, cron: { "cli-1": everyMinute } } };

  it("pings an account stored with authType none", async () => {
    const h = cliHarness({ settings: cronOnly });
    await runQuotaAutoPingTick(h.deps, h.state);
    expect(h.executed).toHaveLength(1);
  });

  it("runs the binary as that account, not whatever the host is signed into", async () => {
    const h = cliHarness({ settings: cronOnly });
    await runQuotaAutoPingTick(h.deps, h.state);
    expect(h.deps.getExecutor).toHaveBeenCalledWith("claude-cli");
    // The executor reads configDir/oauthToken out of this to pick an identity;
    // an empty object silently pinged the ambient login instead.
    expect(h.executed[0].credentials.providerSpecificData.oauthToken)
      .toBe("sk-ant-oat01-for-this-account");
  });

  it("never tries to refresh a credential this server does not hold", async () => {
    const h = cliHarness({ settings: cronOnly });
    await runQuotaAutoPingTick(h.deps, h.state);
    expect(h.deps.refreshAndUpdateCredentials).not.toHaveBeenCalled();
  });

  it("sends the configured schedule text on the cli ping model", async () => {
    const h = cliHarness({ settings: cronOnly });
    await runQuotaAutoPingTick(h.deps, h.state);
    expect(h.executed[0].model).toBe(QUOTA_AUTOPING_CONFIG.providers["claude-cli"].cliPingModel);
    expect(h.executed[0].body.messages[0].content).toBe("Only Hi");
  });

  it("records the fire so the same minute does not ping twice", async () => {
    const h = cliHarness({ settings: cronOnly });
    await runQuotaAutoPingTick(h.deps, h.state);
    expect(h.deps.updateProviderConnection).toHaveBeenCalledTimes(1);
    expect(h.deps.updateProviderConnection.mock.calls[0][1].lastCronFireKey).toBeTruthy();
  });

  it("treats an error frame in the stream as a failed ping", async () => {
    const h = cliHarness({ settings: cronOnly, body: "data: {\"error\":\"claude_cli_error\"}\n\n" });
    await runQuotaAutoPingTick(h.deps, h.state);
    expect(h.deps.updateProviderConnection).toHaveBeenCalledTimes(1);
    expect(h.deps.updateProviderConnection.mock.calls[0][1].lastCronFireKey).toBeUndefined();
    expect(h.deps.updateProviderConnection.mock.calls[0][1].lastCronFailedAt).toBeTruthy();
    expect(h.state.failureCache["cron:claude-cli:cli-1"]).toBeTruthy();
  });

  // Reactive mode reads a reset time out of a usage endpoint. claude-cli has
  // none, so the toggle must not fire a ping on every single tick.
  it("does not run reactive mode for a provider with no usage endpoint", async () => {
    const h = cliHarness({
      settings: { claudeCliAutoPing: { connections: { "cli-1": true }, cron: {} } },
    });
    await runQuotaAutoPingTick(h.deps, h.state);
    expect(h.executed).toHaveLength(0);
  });

  it("still pings a config-directory account, whose credential is a path", async () => {
    const h = cliHarness({
      settings: cronOnly,
      connections: [cliConn({ providerSpecificData: { configDir: "/home/node/.claude-acct-1", kind: "isolated" } })],
    });
    await runQuotaAutoPingTick(h.deps, h.state);
    expect(h.executed[0].credentials.providerSpecificData.configDir)
      .toBe("/home/node/.claude-acct-1");
  });
});

// A schedule that fires only on its exact minute loses the whole slot whenever
// that one tick does not reach it: a tick still busy with a previous ping, an
// earlier account's `claude -p` pushing the next one past the minute, or a pod
// restart across it. For a keepalive meant to open a 5h window on a fixed
// clock, a skipped slot is the whole point lost — so a missed slot is caught up.
describe("latestDueFire (catch-up)", () => {
  const ex = ["0 7 * * *", "0 12 * * *"];

  it("returns the slot on its own minute", () => {
    const due = latestDueFire(ex, at("2026-09-21T07:00:20Z"), "UTC", 15);
    expect(due.expression).toBe("0 7 * * *");
    expect(due.at.toISOString()).toBe("2026-09-21T07:00:00.000Z");
  });

  it("still returns a slot a few minutes late, dated to when it was due", () => {
    const due = latestDueFire(ex, at("2026-09-21T07:09:45Z"), "UTC", 15);
    expect(due.expression).toBe("0 7 * * *");
    expect(due.at.toISOString()).toBe("2026-09-21T07:00:00.000Z");
  });

  it("gives up on a slot older than the window", () => {
    expect(latestDueFire(ex, at("2026-09-21T07:16:00Z"), "UTC", 15)).toBeNull();
  });

  it("returns the most recent slot when two fall inside the window", () => {
    const due = latestDueFire(["0 7 * * *", "5 7 * * *"], at("2026-09-21T07:06:00Z"), "UTC", 15);
    expect(due.expression).toBe("5 7 * * *");
  });

  it("evaluates the window in the schedule's timezone", () => {
    // 07:00 KST is 22:00 UTC the previous day.
    const due = latestDueFire(["0 7 * * *"], at("2026-09-20T22:04:00Z"), "Asia/Seoul", 15);
    expect(due.at.toISOString()).toBe("2026-09-20T22:00:00.000Z");
    expect(latestDueFire(["0 7 * * *"], at("2026-09-21T07:04:00Z"), "Asia/Seoul", 15)).toBeNull();
  });

  it("with a zero window behaves like the exact-minute match", () => {
    expect(latestDueFire(ex, at("2026-09-21T07:00:59Z"), "UTC", 0).expression).toBe("0 7 * * *");
    expect(latestDueFire(ex, at("2026-09-21T07:01:00Z"), "UTC", 0)).toBeNull();
  });
});

describe("runCronPing catch-up", () => {
  const cron = { expressions: ["0 9 * * *"], timezone: "UTC", text: "Only Hi", via: "api" };
  const slotKey = cronFireKey("0 9 * * *", at("2026-09-21T09:00:00Z"), "UTC");

  it("fires a slot the tick missed, keyed to the slot rather than the late minute", async () => {
    const h = harness();
    await runCronPing(h.connection, "claude", h.providerConfig, h.handler, cron, h.deps, h.state, at("2026-09-21T09:07:00Z"));
    expect(h.handler.sendPing).toHaveBeenCalledTimes(1);
    expect(h.deps.updateProviderConnection.mock.calls[0][1].lastCronFireKey).toBe(slotKey);
  });

  it("does not fire the same slot again later in the window", async () => {
    const h = harness({ connection: { lastCronFireKey: slotKey } });
    await runCronPing(h.connection, "claude", h.providerConfig, h.handler, cron, h.deps, h.state, at("2026-09-21T09:08:00Z"));
    expect(h.handler.sendPing).not.toHaveBeenCalled();
  });

  it("retries a failed slot once the cooldown has passed, inside the window", async () => {
    const h = harness();
    h.state.failureCache["cron:claude:conn-1"] = at("2026-09-21T09:00:00Z").getTime();
    const cooled = at("2026-09-21T09:00:00Z").getTime() + QUOTA_AUTOPING_CONFIG.cronFailureCooldownMs + 1000;
    await runCronPing(h.connection, "claude", h.providerConfig, h.handler, cron, h.deps, h.state, new Date(cooled));
    expect(h.handler.sendPing).toHaveBeenCalledTimes(1);
    expect(h.deps.updateProviderConnection.mock.calls[0][1].lastCronFireKey).toBe(slotKey);
  });

  it("does not fire a slot that is past the window", async () => {
    const h = harness();
    const late = at("2026-09-21T09:00:00Z").getTime() + (QUOTA_AUTOPING_CONFIG.cronCatchUpMinutes + 1) * 60000;
    await runCronPing(h.connection, "claude", h.providerConfig, h.handler, cron, h.deps, h.state, new Date(late));
    expect(h.handler.sendPing).not.toHaveBeenCalled();
  });

  it("leaves room for more than one retry before the window closes", () => {
    const { cronCatchUpMinutes, cronFailureCooldownMs } = QUOTA_AUTOPING_CONFIG;
    expect(cronCatchUpMinutes * 60000).toBeGreaterThanOrEqual(2 * cronFailureCooldownMs);
  });
});

describe("runQuotaAutoPingTick catch-up across accounts", () => {
  afterEach(() => vi.useRealTimers());

  // Each ping takes real time, so on a shared slot a later account used to be
  // evaluated after the minute had rolled over, matched nothing, and lost its
  // window entirely.
  it("still pings a later account after an earlier one's ping crossed the minute", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(at("2026-09-21T09:00:30Z"));
    const schedule = { enabled: true, expressions: ["0 9 * * *"], timezone: "UTC", text: "Only Hi" };
    const sendPing = vi.fn(async () => {
      vi.setSystemTime(new Date(Date.now() + 70000)); // a slow ping
      return true;
    });
    const h = tickHarness({
      settings: { claudeAutoPing: { connections: {}, cron: { "conn-1": schedule, "conn-2": schedule } } },
      connections: [oauthConn(), oauthConn({ id: "conn-2" })],
      handler: { sendPing },
    });
    await runQuotaAutoPingTick(h.deps, h.state);
    expect(sendPing).toHaveBeenCalledTimes(2);
  });
});
