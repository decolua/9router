import { describe, expect, it, vi } from "vitest";
import * as proxyFetchModule from "open-sse/utils/proxyFetch.js";
import { getCodexUsage } from "open-sse/services/usage/codex.js";
import { getClaudeUsage } from "open-sse/services/usage/claude.js";
import {
  STAGGER_PROVIDERS,
  validateStaggerGroups,
  getStaggerGroup,
  isStaggerAutoPingEnabled,
  getStaggerPolicyMemberIds,
  updateStaggerState,
  getStaggerDecision,
  markStaggerPing,
} from "@/shared/services/quotaStagger.js";

describe("quota stagger core", () => {
  const baseConnections = [
    { id: "cx-1", provider: "codex", authType: "oauth", isActive: true },
    { id: "cx-2", provider: "codex", authType: "oauth", isActive: true },
    { id: "cx-3", provider: "codex", authType: "oauth", isActive: true },
    { id: "cx-4", provider: "codex", authType: "oauth", isActive: true },
    { id: "cl-1", provider: "claude", authType: "oauth", isActive: true },
    { id: "cl-2", provider: "claude", authType: "oauth", isActive: true },
    { id: "ag-1", provider: "antigravity", authType: "oauth", isActive: true },
    { id: "apiKey-1", provider: "codex", authType: "api_key", isActive: true },
    { id: "inactive-1", provider: "codex", authType: "oauth", isActive: false },
  ];

  describe("STAGGER_PROVIDERS metadata", () => {
    it("exposes expected provider labels, autoPing toggles, and descriptors", () => {
      expect(STAGGER_PROVIDERS.codex.label).toBe("OpenAI Codex");
      expect(STAGGER_PROVIDERS.codex.autoPing).toBe(true);
      expect(STAGGER_PROVIDERS.codex.session.resetMode).toBe("sliding");
      expect(STAGGER_PROVIDERS.codex.session.durationMs).toBe(18000000);
      expect(STAGGER_PROVIDERS.codex.weekly.resetMode).toBe("observed-sliding");
      expect(STAGGER_PROVIDERS.codex.weekly.durationMs).toBe(604800000);

      expect(STAGGER_PROVIDERS.claude.label).toBe("Claude");
      expect(STAGGER_PROVIDERS.claude.autoPing).toBe(true);
      expect(STAGGER_PROVIDERS.claude.session.resetMode).toBe("first-use");
      expect(STAGGER_PROVIDERS.claude.session.durationMs).toBe(18000000);
      expect(STAGGER_PROVIDERS.claude.weekly.resetMode).toBe("observed-sliding");
      expect(STAGGER_PROVIDERS.claude.weekly.reason).toBeTruthy();

      expect(STAGGER_PROVIDERS.antigravity.label).toBe("Antigravity");
      expect(STAGGER_PROVIDERS.antigravity.autoPing).toBe(false);
      expect(STAGGER_PROVIDERS.antigravity.session.resetMode).toBe("unsupported");
      expect(STAGGER_PROVIDERS.antigravity.session.reason).toBeTruthy();
      expect(STAGGER_PROVIDERS.antigravity.weekly.resetMode).toBe("unsupported");
    });
  });

  describe("settings validation", () => {
    const fixedNow = 1770000000000;

    it("rejects non-array inputs", () => {
      expect(() => validateStaggerGroups(null, baseConnections)).toThrow("quotaStaggerGroups must be an array");
      expect(() => validateStaggerGroups({}, baseConnections)).toThrow("quotaStaggerGroups must be an array");
      expect(() => validateStaggerGroups("invalid", baseConnections)).toThrow("quotaStaggerGroups must be an array");
    });

    it("enforces maximum bound of 20 groups", () => {
      const groups = Array.from({ length: 21 }, (_, i) => ({
        id: `group-${i}`,
        name: `Group ${i}`,
        enabled: false,
        connectionIds: ["cx-1", "cx-2"],
        session: { enabled: false },
        weekly: { enabled: false },
      }));
      expect(() => validateStaggerGroups(groups, baseConnections)).toThrow("Maximum 20 quota stagger groups allowed");
    });

    it("guards against prototype pollution keys", () => {
      expect(() =>
        validateStaggerGroups(
          [{ id: "__proto__", name: "Evil", enabled: false, connectionIds: ["cx-1", "cx-2"], session: { enabled: false }, weekly: { enabled: false } }],
          baseConnections
        )
      ).toThrow();

      expect(() =>
        validateStaggerGroups(
          [{ id: "g1", name: "Evil", enabled: false, connectionIds: ["__proto__", "cx-2"], session: { enabled: false }, weekly: { enabled: false } }],
          baseConnections
        )
      ).toThrow();
    });

    it("requires at least 2 distinct existing active OAuth connections for enabled groups", () => {
      expect(() =>
        validateStaggerGroups(
          [{ id: "g1", name: "Solo", enabled: true, connectionIds: ["cx-1"], session: { enabled: true }, weekly: { enabled: false } }],
          baseConnections
        )
      ).toThrow("Group must contain at least 2 distinct active OAuth connections");

      expect(() =>
        validateStaggerGroups(
          [{ id: "g1", name: "Dupe", enabled: true, connectionIds: ["cx-1", "cx-1"], session: { enabled: true }, weekly: { enabled: false } }],
          baseConnections
        )
      ).toThrow("Duplicate connection ID");

      expect(() =>
        validateStaggerGroups(
          [{ id: "g1", name: "Missing", enabled: true, connectionIds: ["cx-1", "non-existent"], session: { enabled: true }, weekly: { enabled: false } }],
          baseConnections
        )
      ).toThrow("Connection not found");

      expect(() =>
        validateStaggerGroups(
          [{ id: "g1", name: "Inactive", enabled: true, connectionIds: ["cx-1", "inactive-1"], session: { enabled: true }, weekly: { enabled: false } }],
          baseConnections
        )
      ).toThrow("Connection is not active");

      expect(() =>
        validateStaggerGroups(
          [{ id: "g1", name: "ApiKey", enabled: true, connectionIds: ["cx-1", "apiKey-1"], session: { enabled: true }, weekly: { enabled: false } }],
          baseConnections
        )
      ).toThrow("Connection is not OAuth");
    });

    it("relaxes membership requirements for disabled groups to allow drafts and cleanup", () => {
      const draftGroups = [
        { id: "g-empty", name: "Empty Draft", enabled: false, connectionIds: [], session: { enabled: false }, weekly: { enabled: false } },
        { id: "g-single", name: "Single Draft", enabled: false, connectionIds: ["cx-1"], session: { enabled: false }, weekly: { enabled: false } },
        { id: "g-stale", name: "Stale Member", enabled: false, connectionIds: ["cx-1", "deleted-id"], session: { enabled: false }, weekly: { enabled: false } },
      ];
      const result = validateStaggerGroups(draftGroups, baseConnections);
      expect(result).toHaveLength(3);
      expect(result[0].connectionIds).toEqual([]);
      expect(result[1].connectionIds).toEqual(["cx-1"]);
      expect(result[2].connectionIds).toEqual(["cx-1", "deleted-id"]);
    });

    it("rejects enabled groups with neither policy enabled", () => {
      expect(() =>
        validateStaggerGroups(
          [{ id: "g1", name: "NoPolicy", enabled: true, connectionIds: ["cx-1", "cx-2"], session: { enabled: false }, weekly: { enabled: false } }],
          baseConnections
        )
      ).toThrow("Enabled group must have at least one policy");
    });

    it("rejects overlapping membership across enabled groups", () => {
      const groups = [
        { id: "g1", name: "Group 1", enabled: true, connectionIds: ["cx-1", "cx-2"], session: { enabled: true }, weekly: { enabled: false } },
        { id: "g2", name: "Group 2", enabled: true, connectionIds: ["cx-2", "cx-3"], session: { enabled: true }, weekly: { enabled: false } },
      ];
      expect(() => validateStaggerGroups(groups, baseConnections)).toThrow("belongs to multiple enabled groups");
    });

    it("allows overlapping membership between disabled and enabled groups", () => {
      const groups = [
        { id: "g1", name: "Group 1", enabled: true, connectionIds: ["cx-1", "cx-2"], session: { enabled: true }, weekly: { enabled: false } },
        { id: "g2", name: "Group 2", enabled: false, connectionIds: ["cx-2", "cx-3"], session: { enabled: false }, weekly: { enabled: false } },
      ];
      const sanitized = validateStaggerGroups(groups, baseConnections, [], fixedNow);
      expect(sanitized).toHaveLength(2);
      expect(sanitized[0].enabled).toBe(true);
      expect(sanitized[1].enabled).toBe(false);
    });

    it("trims connection ID whitespace and guards against whitespace duplicates", () => {
      expect(() =>
        validateStaggerGroups(
          [{ id: "g1", name: "Spaces", enabled: false, connectionIds: ["cx-1", " cx-1 "], session: { enabled: false }, weekly: { enabled: false } }],
          baseConnections
        )
      ).toThrow("Duplicate connection ID");

      const trimmed = validateStaggerGroups(
        [{ id: "g1", name: "Spaces", enabled: false, connectionIds: [" cx-1 ", " cx-2 "], session: { enabled: false }, weekly: { enabled: false } }],
        baseConnections
      );
      expect(trimmed[0].connectionIds).toEqual(["cx-1", "cx-2"]);
    });

    it("enforces length bounds on id, name, and connectionIds", () => {
      const longId = "a".repeat(101);
      const longName = "b".repeat(101);
      expect(() =>
        validateStaggerGroups(
          [{ id: longId, name: "Name", enabled: false, connectionIds: [], session: { enabled: false }, weekly: { enabled: false } }],
          baseConnections
        )
      ).toThrow();

      expect(() =>
        validateStaggerGroups(
          [{ id: "id", name: longName, enabled: false, connectionIds: [], session: { enabled: false }, weekly: { enabled: false } }],
          baseConnections
        )
      ).toThrow();

      const tooManyConns = Array.from({ length: 101 }, (_, i) => `conn-${i}`);
      expect(() =>
        validateStaggerGroups(
          [{ id: "id", name: "Name", enabled: false, connectionIds: tooManyConns, session: { enabled: false }, weekly: { enabled: false } }],
          baseConnections
        )
      ).toThrow("count exceeds limit");
    });

    it("assigns stable policy anchor on creation and enable transition, preserving on normal edits", () => {
      const input = [
        {
          id: "g1",
          name: "Group 1",
          enabled: true,
          connectionIds: ["cx-1", "cx-2"],
          session: { enabled: true },
          weekly: { enabled: false },
        },
      ];
      const created = validateStaggerGroups(input, baseConnections, [], fixedNow);
      expect(created[0].session.anchorAt).toBe(new Date(fixedNow).toISOString());
      expect(created[0].weekly.anchorAt).toBeNull();

      const laterTime = fixedNow + 3600000;
      const edited = validateStaggerGroups(
        [
          {
            id: "g1",
            name: "Renamed Group",
            enabled: true,
            connectionIds: ["cx-2", "cx-1"],
            session: { enabled: true },
            weekly: { enabled: false },
          },
        ],
        baseConnections,
        created,
        laterTime
      );
      expect(edited[0].session.anchorAt).toBe(new Date(fixedNow).toISOString());

      const disabled = validateStaggerGroups(
        [
          {
            id: "g1",
            name: "Renamed Group",
            enabled: false,
            connectionIds: ["cx-2", "cx-1"],
            session: { enabled: true },
            weekly: { enabled: false },
          },
        ],
        baseConnections,
        edited,
        laterTime + 1000
      );
      expect(disabled[0].session.anchorAt).toBeNull();

      const reEnabled = validateStaggerGroups(
        [
          {
            id: "g1",
            name: "Renamed Group",
            enabled: true,
            connectionIds: ["cx-2", "cx-1"],
            session: { enabled: true },
            weekly: { enabled: false },
          },
        ],
        baseConnections,
        disabled,
        laterTime + 2000
      );
      expect(reEnabled[0].session.anchorAt).toBe(new Date(laterTime + 2000).toISOString());
    });
  });

  describe("default-off behavior", () => {
    it("returns null group and false autoPing for disabled groups", () => {
      const settings = {
        quotaStaggerGroups: [
          {
            id: "g-disabled",
            name: "Disabled Group",
            enabled: false,
            connectionIds: ["cx-1", "cx-2"],
            session: { enabled: true, anchorAt: null },
            weekly: { enabled: false, anchorAt: null },
          },
        ],
      };

      expect(getStaggerGroup(settings, "cx-1")).toBeNull();
      expect(isStaggerAutoPingEnabled(settings, { id: "cx-1", provider: "codex" })).toBe(false);
    });
  });

  describe("getStaggerPolicyMemberIds and effective membership", () => {
    const group = {
      id: "g-policy-members",
      name: "Policy Members",
      enabled: true,
      connectionIds: ["cx-1", "ag-1", "cx-2", "inactive-1", "apiKey-1"],
      session: { enabled: true, anchorAt: "2026-02-02T00:00:00.000Z" },
      weekly: { enabled: true, anchorAt: "2026-02-02T00:00:00.000Z" },
    };

    it("filters to active OAuth connections supporting that policy", () => {
      const sessionMembers = getStaggerPolicyMemberIds(group, baseConnections, "session");
      expect(sessionMembers).toEqual(["cx-1", "cx-2"]);

      const weeklyMembers = getStaggerPolicyMemberIds(group, baseConnections, "weekly");
      expect(weeklyMembers).toEqual(["cx-1", "cx-2"]);
    });

    it("returns empty array for Antigravity or unsupported policies", () => {
      const agOnlyGroup = {
        id: "g-ag-only",
        connectionIds: ["ag-1"],
      };
      expect(getStaggerPolicyMemberIds(agOnlyGroup, baseConnections, "session")).toEqual([]);
    });
  });

  describe("exact membership exclusion (two Codex plus Antigravity)", () => {
    const fixedNow = 1770000000000;
    const group = {
      id: "g-mixed",
      name: "Mixed Group",
      enabled: true,
      connectionIds: ["cx-1", "cx-2", "ag-1"],
      session: { enabled: true, anchorAt: new Date(fixedNow).toISOString() },
      weekly: { enabled: false, anchorAt: null },
      protectWindowStart: false,
    };
    const settings = { quotaStaggerGroups: [group] };

    it("validates successfully with Antigravity as unsupported member", () => {
      const validated = validateStaggerGroups([group], baseConnections, [], fixedNow);
      expect(validated[0].connectionIds).toEqual(["cx-1", "cx-2", "ag-1"]);
    });

    it("enables autoPing for Codex connections but disables for Antigravity", () => {
      expect(isStaggerAutoPingEnabled(settings, { id: "cx-1", provider: "codex" })).toBe(true);
      expect(isStaggerAutoPingEnabled(settings, { id: "cx-2", provider: "codex" })).toBe(true);
      expect(isStaggerAutoPingEnabled(settings, { id: "ag-1", provider: "antigravity" })).toBe(false);
    });

    it("uses N=2 denominator for Codex session excluding Antigravity", () => {
      const s1A = updateStaggerState({
        connection: { id: "cx-2", provider: "codex" },
        settings,
        connections: baseConnections,
        quotas: { session: { used: 0, total: 100, remaining: 100, resetAt: new Date(fixedNow + 18000000).toISOString() } },
        nowMs: fixedNow,
      });

      const s1B = updateStaggerState({
        connection: { id: "cx-2", provider: "codex", quotaStaggerState: s1A },
        settings,
        connections: baseConnections,
        quotas: { session: { used: 0, total: 100, remaining: 100, resetAt: new Date(fixedNow + 60000 + 18000000).toISOString() } },
        nowMs: fixedNow + 60000,
      });

      expect(s1B.pendingSlots.session).toBe(fixedNow + 0.5 * 18000000);
    });

    it("marks Antigravity windowStatus as unsupported and does not impose holds", () => {
      const state = updateStaggerState({
        connection: { id: "ag-1", provider: "antigravity" },
        settings,
        connections: baseConnections,
        quotas: {
          session: { used: 0, total: 100, remaining: 100, resetAt: new Date(fixedNow + 18000000).toISOString() },
        },
        nowMs: fixedNow,
      });

      expect(state.windowStatus.session).toBe("unsupported");
      expect(state.windowStatus.weekly).toBe("unsupported");
      expect(state.waiting).toBe(false);
      expect(state.ready).toBe(false);
      expect(state.notBeforeMs).toBeNull();
      expect(state.reason).toContain("Antigravity");
    });
  });

  describe("P1 realistic 60s + latency observation", () => {
    const fixedNow = 1770000000000;
    const duration5h = 18000000;

    it("ensures Conn A is immediately ready at anchor catch-up and Conn B waits for 2.5h", () => {
      const group = {
        id: "g-p1",
        name: "P1 Real Tick",
        enabled: true,
        connectionIds: ["cx-1", "cx-2"],
        session: { enabled: true, anchorAt: new Date(fixedNow).toISOString() },
        weekly: { enabled: false, anchorAt: null },
      };
      const settings = { quotaStaggerGroups: [group] };

      const t0 = fixedNow;
      const t1 = fixedNow + 65000;

      const sA0 = updateStaggerState({
        connection: { id: "cx-1", provider: "codex" },
        settings,
        connections: baseConnections,
        quotas: { session: { used: 0, total: 100, remaining: 100, resetAt: new Date(t0 + duration5h).toISOString() } },
        nowMs: t0,
      });

      const sB0 = updateStaggerState({
        connection: { id: "cx-2", provider: "codex" },
        settings,
        connections: baseConnections,
        quotas: { session: { used: 0, total: 100, remaining: 100, resetAt: new Date(t0 + duration5h).toISOString() } },
        nowMs: t0,
      });

      const sA1 = updateStaggerState({
        connection: { id: "cx-1", provider: "codex", quotaStaggerState: sA0 },
        settings,
        connections: baseConnections,
        quotas: { session: { used: 0, total: 100, remaining: 100, resetAt: new Date(t1 + duration5h).toISOString() } },
        nowMs: t1,
      });

      const sB1 = updateStaggerState({
        connection: { id: "cx-2", provider: "codex", quotaStaggerState: sB0 },
        settings,
        connections: baseConnections,
        quotas: { session: { used: 0, total: 100, remaining: 100, resetAt: new Date(t1 + duration5h).toISOString() } },
        nowMs: t1,
      });

      expect(sA1.pendingSlots.session).toBe(fixedNow);
      expect(sA1.ready).toBe(true);
      expect(sA1.waiting).toBe(false);

      expect(sB1.pendingSlots.session).toBe(fixedNow + 0.5 * duration5h);
      expect(sB1.ready).toBe(false);
      expect(sB1.waiting).toBe(true);
      expect(sB1.notBeforeMs).toBe(fixedNow + 9000000);
    });
  });

  describe("P2 weekly fixed rollover safeguards", () => {
    const fixedNow = 1770000000000;
    const duration7d = 604800000;
    const group = {
      id: "g-rollover",
      name: "Rollover Guard",
      enabled: true,
      connectionIds: ["cx-1", "cx-2"],
      session: { enabled: false, anchorAt: null },
      weekly: { enabled: true, anchorAt: new Date(fixedNow).toISOString() },
    };
    const settings = { quotaStaggerGroups: [group] };

    it("rejects fixed rollover from used:50 to used:0 as idle slide", () => {
      const sActive = updateStaggerState({
        connection: { id: "cx-2", provider: "codex" },
        settings,
        connections: baseConnections,
        quotas: {
          weekly: { used: 50, total: 100, remaining: 50, resetAt: new Date(fixedNow + 30000).toISOString() },
        },
        nowMs: fixedNow,
      });

      const sRollover = updateStaggerState({
        connection: { id: "cx-2", provider: "codex", quotaStaggerState: sActive },
        settings,
        connections: baseConnections,
        quotas: {
          weekly: { used: 0, total: 100, remaining: 100, resetAt: new Date(fixedNow + 60000 + duration7d).toISOString() },
        },
        nowMs: fixedNow + 60000,
      });

      expect(sRollover.windowStatus.weekly).toBe("observation_only");
      expect(sRollover.waiting).toBe(false);
      expect(sRollover.ready).toBe(false);
      expect(sRollover.pendingSlots.weekly).toBeUndefined();
    });

    it("requires two consecutive idle observations with elapsed-consistent slide", () => {
      const t1 = fixedNow;
      const t2 = fixedNow + 60000;

      const idle1 = updateStaggerState({
        connection: { id: "cx-2", provider: "codex" },
        settings,
        connections: baseConnections,
        quotas: {
          weekly: { used: 0, total: 100, remaining: 100, resetAt: new Date(t1 + duration7d).toISOString() },
        },
        nowMs: t1,
      });
      expect(idle1.windowStatus.weekly).toBe("observation_only");

      const idle2 = updateStaggerState({
        connection: { id: "cx-2", provider: "codex", quotaStaggerState: idle1 },
        settings,
        connections: baseConnections,
        quotas: {
          weekly: { used: 0, total: 100, remaining: 100, resetAt: new Date(t2 + duration7d).toISOString() },
        },
        nowMs: t2,
      });
      expect(idle2.windowStatus.weekly).toBe("inactive");
      expect(idle2.waiting).toBe(true);
      expect(idle2.pendingSlots.weekly).toBeDefined();
    });

    it("cached Claude samples preserve verified weekly protection without clearing pending or extending observation TTL", () => {
      const claudeWeeklyGroup = {
        id: "g-claude-weekly",
        name: "Claude Weekly",
        enabled: true,
        connectionIds: ["cl-1", "cl-2"],
        session: { enabled: false, anchorAt: null },
        weekly: { enabled: true, anchorAt: new Date(fixedNow).toISOString() },
      };
      const settingsClaude = { quotaStaggerGroups: [claudeWeeklyGroup] };

      const t0 = fixedNow;
      const t300 = fixedNow + 300000;
      const t360 = fixedNow + 360000;
      const t901 = fixedNow + 901000;

      const obs1 = updateStaggerState({
        connection: { id: "cl-2", provider: "claude" },
        settings: settingsClaude,
        connections: baseConnections,
        quotas: {
          "weekly (7d)": { used: 0, total: 100, remaining: 100, resetAt: new Date(t0 + duration7d).toISOString() },
        },
        nowMs: t0,
        observedAtMs: t0,
      });
      expect(obs1.windowStatus.weekly).toBe("observation_only");
      expect(obs1.waiting).toBe(false);

      const obs2 = updateStaggerState({
        connection: { id: "cl-2", provider: "claude", quotaStaggerState: obs1 },
        settings: settingsClaude,
        connections: baseConnections,
        quotas: {
          "weekly (7d)": { used: 0, total: 100, remaining: 100, resetAt: new Date(t300 + duration7d).toISOString() },
        },
        nowMs: t300,
        observedAtMs: t300,
      });
      expect(obs2.windowStatus.weekly).toBe("inactive");
      expect(obs2.waiting).toBe(true);
      expect(obs2.pendingSlots.weekly).toBeDefined();
      const verifiedSlot = obs2.pendingSlots.weekly;
      expect(obs2.observations.weekly.observedAtMs).toBe(t300);

      const cachedReplayAt360 = updateStaggerState({
        connection: { id: "cl-2", provider: "claude", quotaStaggerState: obs2 },
        settings: settingsClaude,
        connections: baseConnections,
        quotas: {
          "weekly (7d)": { used: 0, total: 100, remaining: 100, resetAt: new Date(t300 + duration7d).toISOString() },
        },
        nowMs: t360,
        observedAtMs: t300,
      });

      expect(cachedReplayAt360.windowStatus.weekly).toBe("inactive");
      expect(cachedReplayAt360.waiting).toBe(true);
      expect(cachedReplayAt360.pendingSlots.weekly).toBe(verifiedSlot);
      expect(cachedReplayAt360.observations.weekly.observedAtMs).toBe(t300);

      const staleReplayAt901 = updateStaggerState({
        connection: { id: "cl-2", provider: "claude", quotaStaggerState: cachedReplayAt360 },
        settings: settingsClaude,
        connections: baseConnections,
        quotas: {
          "weekly (7d)": { used: 0, total: 100, remaining: 100, resetAt: new Date(t300 + duration7d).toISOString() },
        },
        nowMs: t901,
        observedAtMs: t300,
      });

      expect(staleReplayAt901.windowStatus.weekly).toBe("stale_sample");
      expect(staleReplayAt901.waiting).toBe(false);
      expect(staleReplayAt901.pendingSlots.weekly).toBeUndefined();

      const pingTime = fixedNow + 370000;
      const pinged = markStaggerPing(cachedReplayAt360, pingTime);
      expect(pinged.waiting).toBe(false);

      const prePingReplay = updateStaggerState({
        connection: { id: "cl-2", provider: "claude", quotaStaggerState: pinged },
        settings: settingsClaude,
        connections: baseConnections,
        quotas: {
          "weekly (7d)": { used: 0, total: 100, remaining: 100, resetAt: new Date(t300 + duration7d).toISOString() },
        },
        nowMs: pingTime + 10000,
        observedAtMs: t300,
      });

      expect(prePingReplay.waiting).toBe(false);
      expect(prePingReplay.ready).toBe(false);
      expect(prePingReplay.pendingSlots.weekly).toBeUndefined();
    });
  });

  describe("independent windows toggles", () => {
    const fixedNow = 1770000000000;

    it("schedules only session when weekly is disabled", () => {
      const group = {
        id: "g-session-only",
        name: "Session Only",
        enabled: true,
        connectionIds: ["cl-1", "cl-2"],
        session: { enabled: true, anchorAt: new Date(fixedNow).toISOString() },
        weekly: { enabled: false, anchorAt: null },
      };
      const settings = { quotaStaggerGroups: [group] };

      const state = updateStaggerState({
        connection: { id: "cl-1", provider: "claude" },
        settings,
        connections: baseConnections,
        quotas: {
          "session (5h)": { used: 0, total: 100, remaining: 100, resetAt: null },
          "weekly (7d)": { used: 0, total: 100, remaining: 100, resetAt: new Date(fixedNow + 604800000).toISOString() },
        },
        nowMs: fixedNow,
      });

      expect(state.windowStatus.session).toBe("inactive");
      expect(state.windowStatus.weekly).toBe("disabled");
      expect(state.pendingSlots.session).toBeDefined();
      expect(state.pendingSlots.weekly).toBeUndefined();
    });

    it("schedules only weekly when session is disabled", () => {
      const group = {
        id: "g-weekly-only",
        name: "Weekly Only",
        enabled: true,
        connectionIds: ["cx-1", "cx-2"],
        session: { enabled: false, anchorAt: null },
        weekly: { enabled: true, anchorAt: new Date(fixedNow).toISOString() },
      };
      const settings = { quotaStaggerGroups: [group] };

      const t1 = fixedNow;
      const t2 = fixedNow + 60000;
      const initial = updateStaggerState({
        connection: { id: "cx-1", provider: "codex" },
        settings,
        connections: baseConnections,
        quotas: {
          session: { used: 0, total: 100, remaining: 100, resetAt: new Date(t1 + 18000000).toISOString() },
          weekly: { used: 0, total: 100, remaining: 100, resetAt: new Date(t1 + 604800000).toISOString() },
        },
        nowMs: t1,
      });

      const second = updateStaggerState({
        connection: { id: "cx-1", provider: "codex", quotaStaggerState: initial },
        settings,
        connections: baseConnections,
        quotas: {
          session: { used: 0, total: 100, remaining: 100, resetAt: new Date(t2 + 18000000).toISOString() },
          weekly: { used: 0, total: 100, remaining: 100, resetAt: new Date(t1 + 604800000 + 40000).toISOString() },
        },
        nowMs: t2,
      });

      expect(second.windowStatus.session).toBe("disabled");
      expect(second.windowStatus.weekly).toBe("inactive");
      expect(second.pendingSlots.weekly).toBeDefined();
      expect(second.pendingSlots.session).toBeUndefined();
    });

    it("uses max deadline when both policies are pending", () => {
      const group = {
        id: "g-both",
        name: "Both Policies",
        enabled: true,
        connectionIds: ["cx-2", "cx-1"],
        session: { enabled: true, anchorAt: new Date(fixedNow).toISOString() },
        weekly: { enabled: true, anchorAt: new Date(fixedNow).toISOString() },
      };
      const settings = { quotaStaggerGroups: [group] };

      const t1 = fixedNow;
      const t2 = fixedNow + 60000;
      const initial = updateStaggerState({
        connection: { id: "cx-1", provider: "codex" },
        settings,
        connections: baseConnections,
        quotas: {
          session: { used: 0, total: 100, remaining: 100, resetAt: new Date(t1 + 18000000).toISOString() },
          weekly: { used: 0, total: 100, remaining: 100, resetAt: new Date(t1 + 604800000).toISOString() },
        },
        nowMs: t1,
      });

      const second = updateStaggerState({
        connection: { id: "cx-1", provider: "codex", quotaStaggerState: initial },
        settings,
        connections: baseConnections,
        quotas: {
          session: { used: 0, total: 100, remaining: 100, resetAt: new Date(t2 + 18000000).toISOString() },
          weekly: { used: 0, total: 100, remaining: 100, resetAt: new Date(t1 + 604800000 + 45000).toISOString() },
        },
        nowMs: t2,
      });

      expect(second.windowStatus.session).toBe("inactive");
      expect(second.windowStatus.weekly).toBe("inactive");
      expect(second.effectiveDeadlineMs).toBe(Math.max(second.pendingSlots.session, second.pendingSlots.weekly));
    });
  });

  describe("two, three, and four phases calculations", () => {
    const fixedNow = 1770000000000;
    const duration5h = 18000000;

    it("calculates 2 phases: index 0 at 0, index 1 at 2.5h", () => {
      const group = {
        id: "g-2p",
        name: "2 Phases",
        enabled: true,
        connectionIds: ["cl-1", "cl-2"],
        session: { enabled: true, anchorAt: new Date(fixedNow).toISOString() },
        weekly: { enabled: false, anchorAt: null },
      };
      const settings = { quotaStaggerGroups: [group] };

      const s0 = updateStaggerState({
        connection: { id: "cl-1", provider: "claude" },
        settings,
        connections: baseConnections,
        quotas: { "session (5h)": { used: 0, total: 100, remaining: 100, resetAt: null } },
        nowMs: fixedNow,
      });
      const s1 = updateStaggerState({
        connection: { id: "cl-2", provider: "claude" },
        settings,
        connections: baseConnections,
        quotas: { "session (5h)": { used: 0, total: 100, remaining: 100, resetAt: null } },
        nowMs: fixedNow,
      });

      expect(s0.pendingSlots.session).toBe(fixedNow);
      expect(s0.ready).toBe(true);
      expect(s0.waiting).toBe(false);

      expect(s1.pendingSlots.session).toBe(fixedNow + 0.5 * duration5h);
      expect(s1.waiting).toBe(true);
      expect(s1.ready).toBe(false);
    });

    it("calculates 3 phases: index 0 at 0, index 1 at 1/3, index 2 at 2/3", () => {
      const group = {
        id: "g-3p",
        name: "3 Phases",
        enabled: true,
        connectionIds: ["cx-1", "cx-2", "cx-3"],
        session: { enabled: true, anchorAt: new Date(fixedNow).toISOString() },
        weekly: { enabled: false, anchorAt: null },
      };
      const settings = { quotaStaggerGroups: [group] };

      const mkSlide = (id, now) => {
        const s1 = updateStaggerState({
          connection: { id, provider: "codex" },
          settings,
          connections: baseConnections,
          quotas: { session: { used: 0, total: 100, remaining: 100, resetAt: new Date(now + duration5h).toISOString() } },
          nowMs: now,
        });
        return updateStaggerState({
          connection: { id, provider: "codex", quotaStaggerState: s1 },
          settings,
          connections: baseConnections,
          quotas: { session: { used: 0, total: 100, remaining: 100, resetAt: new Date(now + 60000 + duration5h).toISOString() } },
          nowMs: now + 60000,
        });
      };

      const s0 = mkSlide("cx-1", fixedNow);
      const s1 = mkSlide("cx-2", fixedNow);
      const s2 = mkSlide("cx-3", fixedNow);

      expect(s0.pendingSlots.session).toBe(fixedNow);
      expect(s1.pendingSlots.session).toBe(fixedNow + Math.round((1 / 3) * duration5h));
      expect(s2.pendingSlots.session).toBe(fixedNow + Math.round((2 / 3) * duration5h));
    });

    it("calculates 4 phases: index 0 at 0, 1 at 1/4, 2 at 2/4, 3 at 3/4", () => {
      const group = {
        id: "g-4p",
        name: "4 Phases",
        enabled: true,
        connectionIds: ["cx-1", "cx-2", "cx-3", "cx-4"],
        session: { enabled: true, anchorAt: new Date(fixedNow).toISOString() },
        weekly: { enabled: false, anchorAt: null },
      };
      const settings = { quotaStaggerGroups: [group] };

      const mkSlide = (id, now) => {
        const s1 = updateStaggerState({
          connection: { id, provider: "codex" },
          settings,
          connections: baseConnections,
          quotas: { session: { used: 0, total: 100, remaining: 100, resetAt: new Date(now + duration5h).toISOString() } },
          nowMs: now,
        });
        return updateStaggerState({
          connection: { id, provider: "codex", quotaStaggerState: s1 },
          settings,
          connections: baseConnections,
          quotas: { session: { used: 0, total: 100, remaining: 100, resetAt: new Date(now + 60000 + duration5h).toISOString() } },
          nowMs: now + 60000,
        });
      };

      const s1 = mkSlide("cx-2", fixedNow);
      const s2 = mkSlide("cx-3", fixedNow);
      const s3 = mkSlide("cx-4", fixedNow);

      expect(s1.pendingSlots.session).toBe(fixedNow + 0.25 * duration5h);
      expect(s2.pendingSlots.session).toBe(fixedNow + 0.5 * duration5h);
      expect(s3.pendingSlots.session).toBe(fixedNow + 0.75 * duration5h);
    });
  });

  describe("mixed actual durations", () => {
    const fixedNow = 1770000000000;

    it("uses that connection's own window duration rather than global 5h", () => {
      const group = {
        id: "g-mixed-durations",
        name: "Mixed Durations",
        enabled: true,
        connectionIds: ["cx-1", "cx-2"],
        session: { enabled: true, anchorAt: new Date(fixedNow).toISOString() },
        weekly: { enabled: false, anchorAt: null },
      };
      const settings = { quotaStaggerGroups: [group] };

      const s1A = updateStaggerState({
        connection: { id: "cx-2", provider: "codex" },
        settings,
        connections: baseConnections,
        quotas: {
          session: {
            used: 0,
            total: 100,
            remaining: 100,
            limit_window_seconds: 14400,
            resetAt: new Date(fixedNow + 14400000).toISOString(),
          },
        },
        nowMs: fixedNow,
      });

      const s1B = updateStaggerState({
        connection: { id: "cx-2", provider: "codex", quotaStaggerState: s1A },
        settings,
        connections: baseConnections,
        quotas: {
          session: {
            used: 0,
            total: 100,
            remaining: 100,
            limit_window_seconds: 14400,
            resetAt: new Date(fixedNow + 60000 + 14400000).toISOString(),
          },
        },
        nowMs: fixedNow + 60000,
      });

      expect(s1B.pendingSlots.session).toBe(fixedNow + (1 / 2) * 14400000);
    });
  });

  describe("findQuotaForPolicy quota isolation", () => {
    const fixedNow = 1770000000000;
    const group = {
      id: "g-isolation",
      name: "Isolation",
      enabled: true,
      connectionIds: ["cx-1", "cx-2"],
      session: { enabled: true, anchorAt: new Date(fixedNow).toISOString() },
      weekly: { enabled: true, anchorAt: new Date(fixedNow).toISOString() },
    };
    const settings = { quotaStaggerGroups: [group] };

    it("never falls back to spark_session or review_session when main session is missing", () => {
      const state = updateStaggerState({
        connection: { id: "cx-1", provider: "codex" },
        settings,
        connections: baseConnections,
        quotas: {
          spark_session: { used: 0, total: 100, remaining: 100, resetAt: new Date(fixedNow + 18000000).toISOString() },
          review_session: { used: 0, total: 100, remaining: 100, resetAt: new Date(fixedNow + 18000000).toISOString() },
        },
        nowMs: fixedNow,
      });

      expect(state.windowStatus.session).toBe("missing");
      expect(state.pendingSlots.session).toBeUndefined();
    });
  });

  describe("null, invalid, and contradictory quotas", () => {
    const fixedNow = 1770000000000;
    const group = {
      id: "g-quota-checks",
      name: "Quota Checks",
      enabled: true,
      connectionIds: ["cl-1", "cx-1"],
      session: { enabled: true, anchorAt: new Date(fixedNow).toISOString() },
      weekly: { enabled: false, anchorAt: null },
    };
    const settings = { quotaStaggerGroups: [group] };

    it("clears holds when quotas are missing", () => {
      const state = updateStaggerState({
        connection: { id: "cl-1", provider: "claude" },
        settings,
        connections: baseConnections,
        quotas: null,
        nowMs: fixedNow,
      });

      expect(state.windowStatus.session).toBe("missing");
      expect(state.waiting).toBe(false);
      expect(state.ready).toBe(false);
      expect(state.notBeforeMs).toBeNull();
    });

    it("rejects negative used, total contradictions, and invalid numbers", () => {
      const negativeUsed = updateStaggerState({
        connection: { id: "cl-1", provider: "claude" },
        settings,
        connections: baseConnections,
        quotas: { "session (5h)": { used: -5, remaining: 105, total: 100 } },
        nowMs: fixedNow,
      });
      expect(negativeUsed.windowStatus.session).toBe("invalid");

      const totalContradiction = updateStaggerState({
        connection: { id: "cl-1", provider: "claude" },
        settings,
        connections: baseConnections,
        quotas: { "session (5h)": { used: 120, remaining: -20, total: 100 } },
        nowMs: fixedNow,
      });
      expect(totalContradiction.windowStatus.session).toBe("invalid");

      const nanQuota = updateStaggerState({
        connection: { id: "cl-1", provider: "claude" },
        settings,
        connections: baseConnections,
        quotas: { "session (5h)": { used: "not-a-number", remaining: "invalid", total: 100 } },
        nowMs: fixedNow,
      });
      expect(nanQuota.windowStatus.session).toBe("invalid");
    });

    it("treats null reset with 0 used as inactive for documented Claude session", () => {
      const state = updateStaggerState({
        connection: { id: "cl-1", provider: "claude" },
        settings,
        connections: baseConnections,
        quotas: {
          "session (5h)": { used: 0, total: 100, remaining: 100, resetAt: null },
        },
        nowMs: fixedNow,
      });

      expect(state.windowStatus.session).toBe("inactive");
      expect(state.pendingSlots.session).toBeDefined();
    });

    it("does not treat null reset with 0 used as inactive for Codex session", () => {
      const state = updateStaggerState({
        connection: { id: "cx-1", provider: "codex" },
        settings,
        connections: baseConnections,
        quotas: {
          session: { used: 0, total: 100, remaining: 100, resetAt: null },
        },
        nowMs: fixedNow,
      });

      expect(state.windowStatus.session).toBe("invalid");
      expect(state.waiting).toBe(false);
      expect(state.pendingSlots.session).toBeUndefined();
    });
  });

  describe("active traffic reset change", () => {
    const fixedNow = 1770000000000;
    const group = {
      id: "g-active-traffic",
      name: "Active Traffic",
      enabled: true,
      connectionIds: ["cl-1", "cl-2"],
      session: { enabled: true, anchorAt: new Date(fixedNow).toISOString() },
      weekly: { enabled: false, anchorAt: null },
    };
    const settings = { quotaStaggerGroups: [group] };

    it("clears holds immediately when usage is detected", () => {
      const inactiveState = updateStaggerState({
        connection: { id: "cl-2", provider: "claude" },
        settings,
        connections: baseConnections,
        quotas: {
          "session (5h)": { used: 0, total: 100, remaining: 100, resetAt: null },
        },
        nowMs: fixedNow,
      });
      expect(inactiveState.waiting).toBe(true);

      const activeState = updateStaggerState({
        connection: { id: "cl-2", provider: "claude", quotaStaggerState: inactiveState },
        settings,
        connections: baseConnections,
        quotas: {
          "session (5h)": { used: 15, total: 100, remaining: 85, resetAt: new Date(fixedNow + 18000000).toISOString() },
        },
        nowMs: fixedNow + 60000,
      });

      expect(activeState.windowStatus.session).toBe("active");
      expect(activeState.waiting).toBe(false);
      expect(activeState.ready).toBe(false);
      expect(activeState.notBeforeMs).toBeNull();
      expect(activeState.pendingSlots.session).toBeUndefined();
    });
  });

  describe("restart, poll persistence, and observedAtMs freshness", () => {
    const fixedNow = 1770000000000;
    const group = {
      id: "g-persistence",
      name: "Persistence",
      enabled: true,
      connectionIds: ["cl-1", "cl-2"],
      session: { enabled: true, anchorAt: new Date(fixedNow).toISOString() },
      weekly: { enabled: false, anchorAt: null },
    };
    const settings = { quotaStaggerGroups: [group] };

    it("persists exact deadline across repeated polling cycles without sliding", () => {
      const initial = updateStaggerState({
        connection: { id: "cl-2", provider: "claude" },
        settings,
        connections: baseConnections,
        quotas: { "session (5h)": { used: 0, total: 100, remaining: 100, resetAt: null } },
        nowMs: fixedNow,
      });

      const originalDeadline = initial.pendingSlots.session;
      expect(originalDeadline).toBe(fixedNow + 9000000);

      const poll1 = updateStaggerState({
        connection: { id: "cl-2", provider: "claude", quotaStaggerState: initial },
        settings,
        connections: baseConnections,
        quotas: { "session (5h)": { used: 0, total: 100, remaining: 100, resetAt: null } },
        nowMs: fixedNow + 60000,
      });
      expect(poll1.pendingSlots.session).toBe(originalDeadline);

      const serialized = JSON.parse(JSON.stringify(poll1));
      const pollAfterRestart = updateStaggerState({
        connection: { id: "cl-2", provider: "claude", quotaStaggerState: serialized },
        settings,
        connections: baseConnections,
        quotas: { "session (5h)": { used: 0, total: 100, remaining: 100, resetAt: null } },
        nowMs: fixedNow + 120000,
      });
      expect(pollAfterRestart.pendingSlots.session).toBe(originalDeadline);
    });

    it("fails open when upstream sample is expired (>10min old)", () => {
      const state = updateStaggerState({
        connection: { id: "cl-2", provider: "claude" },
        settings,
        connections: baseConnections,
        quotas: { "session (5h)": { used: 0, total: 100, remaining: 100, resetAt: null } },
        nowMs: fixedNow,
        observedAtMs: fixedNow - 700000,
      });

      expect(state.windowStatus.session).toBe("stale_sample");
      expect(state.waiting).toBe(false);
      expect(state.ready).toBe(false);
      expect(state.notBeforeMs).toBeNull();
    });

    it("reports ready when now reaches the persisted deadline", () => {
      const initial = updateStaggerState({
        connection: { id: "cl-2", provider: "claude" },
        settings,
        connections: baseConnections,
        quotas: { "session (5h)": { used: 0, total: 100, remaining: 100, resetAt: null } },
        nowMs: fixedNow,
      });
      const deadline = initial.notBeforeMs;

      const freshStateBefore = updateStaggerState({
        connection: { id: "cl-2", provider: "claude", quotaStaggerState: initial },
        settings,
        connections: baseConnections,
        quotas: { "session (5h)": { used: 0, total: 100, remaining: 100, resetAt: null } },
        nowMs: deadline - 5000,
      });

      const decisionBefore = getStaggerDecision({
        connection: { id: "cl-2", provider: "claude", quotaStaggerState: freshStateBefore },
        settings,
        connections: baseConnections,
        nowMs: deadline - 1000,
      });
      expect(decisionBefore.waiting).toBe(true);
      expect(decisionBefore.ready).toBe(false);

      const decisionDue = getStaggerDecision({
        connection: { id: "cl-2", provider: "claude", quotaStaggerState: freshStateBefore },
        settings,
        connections: baseConnections,
        nowMs: deadline,
      });
      expect(decisionDue.waiting).toBe(false);
      expect(decisionDue.ready).toBe(true);
    });

    it("expires hold TTL with cached sample near expiry and no subsequent scheduler polls", () => {
      const t0 = fixedNow;
      const tNearExpiry = t0 + 550000;
      const state = updateStaggerState({
        connection: { id: "cl-2", provider: "claude" },
        settings,
        connections: baseConnections,
        quotas: { "session (5h)": { used: 0, total: 100, remaining: 100, resetAt: null } },
        nowMs: tNearExpiry,
        observedAtMs: t0,
      });

      expect(state.lastObservedAtMs).toBe(t0);
      expect(state.waiting).toBe(true);
      expect(state.notBeforeMs).toBeDefined();

      const decisionWithinTtl = getStaggerDecision({
        connection: { id: "cl-2", provider: "claude", quotaStaggerState: state },
        settings,
        connections: baseConnections,
        nowMs: t0 + 590000,
      });
      expect(decisionWithinTtl.waiting).toBe(true);
      expect(decisionWithinTtl.notBeforeMs).toBe(state.notBeforeMs);

      const decisionExpired = getStaggerDecision({
        connection: { id: "cl-2", provider: "claude", quotaStaggerState: state },
        settings,
        connections: baseConnections,
        nowMs: t0 + 601000,
      });
      expect(decisionExpired.waiting).toBe(false);
      expect(decisionExpired.ready).toBe(false);
      expect(decisionExpired.notBeforeMs).toBeNull();
    });

    it("rejects future or nonfinite upstream sample and places no hold", () => {
      const futureState = updateStaggerState({
        connection: { id: "cl-2", provider: "claude" },
        settings,
        connections: baseConnections,
        quotas: { "session (5h)": { used: 0, total: 100, remaining: 100, resetAt: null } },
        nowMs: fixedNow,
        observedAtMs: fixedNow + 70000,
      });

      expect(futureState.waiting).toBe(false);
      expect(futureState.ready).toBe(false);
      expect(futureState.notBeforeMs).toBeNull();
      expect(futureState.pendingSlots).toEqual({});
      expect(futureState.windowStatus.session).toBe("stale_sample");

      const futureDecision = getStaggerDecision({
        connection: { id: "cl-2", provider: "claude", quotaStaggerState: futureState },
        settings,
        connections: baseConnections,
        nowMs: fixedNow,
      });
      expect(futureDecision.waiting).toBe(false);
      expect(futureDecision.ready).toBe(false);
      expect(futureDecision.notBeforeMs).toBeNull();

      const nanState = updateStaggerState({
        connection: { id: "cl-2", provider: "claude" },
        settings,
        connections: baseConnections,
        quotas: { "session (5h)": { used: 0, total: 100, remaining: 100, resetAt: null } },
        nowMs: fixedNow,
        observedAtMs: NaN,
      });
      expect(nanState.waiting).toBe(false);
      expect(nanState.ready).toBe(false);
      expect(nanState.notBeforeMs).toBeNull();
      expect(nanState.pendingSlots).toEqual({});
      expect(nanState.windowStatus.session).toBe("stale_sample");
    });

    it("does not fabricate phase when duration is explicitly invalid", () => {
      const invalidOverrides = [
        { windowDurationMs: 0 },
        { windowDurationMs: -1000 },
        { windowDurationMs: Infinity },
        { limit_window_seconds: 0 },
        { limit_window_seconds: -10 },
        { limit_window_seconds: Infinity },
      ];

      for (const override of invalidOverrides) {
        const state = updateStaggerState({
          connection: { id: "cl-2", provider: "claude" },
          settings,
          connections: baseConnections,
          quotas: {
            "session (5h)": {
              used: 0,
              total: 100,
              remaining: 100,
              resetAt: null,
              ...override,
            },
          },
          nowMs: fixedNow,
        });

        expect(state.windowStatus.session).toBe("unsupported");
        expect(state.pendingSlots.session).toBeUndefined();
        expect(state.waiting).toBe(false);
        expect(state.ready).toBe(false);
        expect(state.notBeforeMs).toBeNull();
      }
    });
  });

  describe("group edit invalidation", () => {
    const fixedNow = 1770000000000;
    const initialGroup = {
      id: "g-edits",
      name: "Initial Group",
      enabled: true,
      connectionIds: ["cl-1", "cl-2"],
      session: { enabled: true, anchorAt: new Date(fixedNow).toISOString() },
      weekly: { enabled: false, anchorAt: null },
    };

    it("invalidates previous holds when membership order changes", () => {
      const settings1 = { quotaStaggerGroups: [initialGroup] };
      const state1 = updateStaggerState({
        connection: { id: "cl-2", provider: "claude" },
        settings: settings1,
        connections: baseConnections,
        quotas: { "session (5h)": { used: 0, total: 100, remaining: 100, resetAt: null } },
        nowMs: fixedNow,
      });
      expect(state1.waiting).toBe(true);

      const reorderedGroup = {
        ...initialGroup,
        connectionIds: ["cl-2", "cl-1"],
      };
      const settings2 = { quotaStaggerGroups: [reorderedGroup] };

      const state2 = updateStaggerState({
        connection: { id: "cl-2", provider: "claude", quotaStaggerState: state1 },
        settings: settings2,
        connections: baseConnections,
        quotas: { "session (5h)": { used: 0, total: 100, remaining: 100, resetAt: null } },
        nowMs: fixedNow,
      });

      expect(state2.signature).not.toBe(state1.signature);
      expect(state2.pendingSlots.session).toBe(fixedNow);
      expect(state2.waiting).toBe(false);
      expect(state2.ready).toBe(true);
    });

    it("getStaggerDecision ignores state with invalid signature", () => {
      const settings1 = { quotaStaggerGroups: [initialGroup] };
      const state1 = updateStaggerState({
        connection: { id: "cl-2", provider: "claude" },
        settings: settings1,
        connections: baseConnections,
        quotas: { "session (5h)": { used: 0, total: 100, remaining: 100, resetAt: null } },
        nowMs: fixedNow,
      });

      const modifiedSettings = {
        quotaStaggerGroups: [
          {
            ...initialGroup,
            protectWindowStart: true,
          },
        ],
      };

      const decision = getStaggerDecision({
        connection: { id: "cl-2", provider: "claude", quotaStaggerState: state1 },
        settings: modifiedSettings,
        connections: baseConnections,
        nowMs: fixedNow,
      });

      expect(decision.waiting).toBe(false);
      expect(decision.ready).toBe(false);
      expect(decision.notBeforeMs).toBeNull();
    });

    it("getStaggerDecision rejects observations older than 10 minutes", () => {
      const settings = { quotaStaggerGroups: [initialGroup] };
      const state = updateStaggerState({
        connection: { id: "cl-2", provider: "claude" },
        settings,
        connections: baseConnections,
        quotas: { "session (5h)": { used: 0, total: 100, remaining: 100, resetAt: null } },
        nowMs: fixedNow,
      });

      const staleDecision = getStaggerDecision({
        connection: { id: "cl-2", provider: "claude", quotaStaggerState: state },
        settings,
        connections: baseConnections,
        nowMs: fixedNow + 600001,
      });

      expect(staleDecision.waiting).toBe(false);
      expect(staleDecision.ready).toBe(false);
      expect(staleDecision.notBeforeMs).toBeNull();
    });
  });

  describe("disabled, deleted, and deactivated members", () => {
    const fixedNow = 1770000000000;
    const group = {
      id: "g-members",
      name: "Members",
      enabled: true,
      connectionIds: ["cx-1", "cx-2", "cx-3"],
      session: { enabled: true, anchorAt: new Date(fixedNow).toISOString() },
      weekly: { enabled: false, anchorAt: null },
    };
    const settings = { quotaStaggerGroups: [group] };

    it("excludes deactivated connection from signature and re-phases remaining active members", () => {
      const connectionsWithDeactivated = baseConnections.map((c) =>
        c.id === "cx-2" ? { ...c, isActive: false } : c
      );

      const decision = getStaggerDecision({
        connection: {
          id: "cx-2",
          provider: "codex",
          quotaStaggerState: { signature: "some-sig" },
        },
        settings,
        connections: connectionsWithDeactivated,
        nowMs: fixedNow,
      });

      expect(decision.waiting).toBe(false);
      expect(decision.ready).toBe(false);

      const stateCx3 = updateStaggerState({
        connection: { id: "cx-3", provider: "codex" },
        settings,
        connections: connectionsWithDeactivated,
        quotas: { session: { used: 0, total: 100, remaining: 100, resetAt: null } },
        nowMs: fixedNow,
      });

      expect(stateCx3.signature).toContain("cx-1:codex,cx-3:codex");
      expect(stateCx3.signature).not.toContain("cx-2");
    });

    it("switches to observation_only without hold when policy members drop below 2", () => {
      const onlyOneActive = baseConnections.map((c) =>
        c.id === "cx-1" ? c : { ...c, isActive: false }
      );

      const state = updateStaggerState({
        connection: { id: "cx-1", provider: "codex" },
        settings,
        connections: onlyOneActive,
        quotas: { session: { used: 0, total: 100, remaining: 100, resetAt: null } },
        nowMs: fixedNow,
      });

      expect(state.windowStatus.session).toBe("observation_only");
      expect(state.waiting).toBe(false);
      expect(state.ready).toBe(false);
      expect(state.notBeforeMs).toBeNull();
      expect(state.reason).toContain("Fewer than 2");
    });
  });

  describe("markStaggerPing and post-ping suppression", () => {
    const fixedNow = 1770000000000;
    const group = {
      id: "g-ping",
      name: "Ping Test",
      enabled: true,
      connectionIds: ["cl-1", "cl-2"],
      session: { enabled: true, anchorAt: new Date(fixedNow).toISOString() },
      weekly: { enabled: false, anchorAt: null },
    };
    const settings = { quotaStaggerGroups: [group] };

    it("clears pending holds and sets 5min propagation suppression without modifying reset observations", () => {
      const state = updateStaggerState({
        connection: { id: "cl-2", provider: "claude" },
        settings,
        connections: baseConnections,
        quotas: { "session (5h)": { used: 0, total: 100, remaining: 100, resetAt: null } },
        nowMs: fixedNow,
      });
      expect(state.waiting).toBe(true);

      const pingTime = fixedNow + 1000;
      const pingedState = markStaggerPing(state, pingTime);

      expect(pingedState.waiting).toBe(false);
      expect(pingedState.ready).toBe(false);
      expect(pingedState.notBeforeMs).toBeNull();
      expect(pingedState.effectiveDeadlineMs).toBeNull();
      expect(pingedState.pendingSlots).toEqual({});
      expect(pingedState.lastPingAtMs).toBe(pingTime);
      expect(pingedState.suppressUntilMs).toBe(pingTime + 300000);

      const updateDuringSuppression = updateStaggerState({
        connection: { id: "cl-2", provider: "claude", quotaStaggerState: pingedState },
        settings,
        connections: baseConnections,
        quotas: { "session (5h)": { used: 0, total: 100, remaining: 100, resetAt: null } },
        nowMs: pingTime + 60000,
      });

      expect(updateDuringSuppression.waiting).toBe(false);
      expect(updateDuringSuppression.ready).toBe(false);
      expect(updateDuringSuppression.pendingSlots).toEqual({});
    });

    it("cached Claude idle response after ping never blocks active traffic", () => {
      const state = updateStaggerState({
        connection: { id: "cl-2", provider: "claude" },
        settings,
        connections: baseConnections,
        quotas: { "session (5h)": { used: 0, total: 100, remaining: 100, resetAt: null } },
        nowMs: fixedNow,
      });

      const pingTime = fixedNow + 1000;
      const pingedState = markStaggerPing(state, pingTime);

      const cachedDuringSuppression = updateStaggerState({
        connection: { id: "cl-2", provider: "claude", quotaStaggerState: pingedState },
        settings,
        connections: baseConnections,
        quotas: { "session (5h)": { used: 0, total: 100, remaining: 100, resetAt: null } },
        nowMs: pingTime + 120000,
        observedAtMs: fixedNow,
      });

      expect(cachedDuringSuppression.waiting).toBe(false);
      expect(cachedDuringSuppression.ready).toBe(false);
      expect(cachedDuringSuppression.pendingSlots).toEqual({});

      const activeTrafficAfterPing = updateStaggerState({
        connection: { id: "cl-2", provider: "claude", quotaStaggerState: cachedDuringSuppression },
        settings,
        connections: baseConnections,
        quotas: { "session (5h)": { used: 10, total: 100, remaining: 90, resetAt: new Date(fixedNow + 18000000).toISOString() } },
        nowMs: pingTime + 180000,
        observedAtMs: pingTime + 180000,
      });

      expect(activeTrafficAfterPing.windowStatus.session).toBe("active");
      expect(activeTrafficAfterPing.waiting).toBe(false);
      expect(activeTrafficAfterPing.ready).toBe(false);
      expect(activeTrafficAfterPing.notBeforeMs).toBeNull();
    });
  });

  describe("quota metadata normalization and observedAtMs", () => {
    it("normalizes Codex limit_window_seconds to windowDurationMs", async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        json: async () => ({
          rate_limit: {
            primary_window: {
              used_percent: 20,
              limit_window_seconds: 18000,
              reset_at: "2026-08-22T05:00:00.000Z",
            },
            secondary_window: {
              used_percent: 40,
              limit_window_seconds: 604800,
              reset_at: "2026-08-28T05:00:00.000Z",
            },
          },
        }),
      };
      const spy = vi.spyOn(proxyFetchModule, "proxyAwareFetch").mockResolvedValue(mockResponse);
      const usage = await getCodexUsage("token-test");
      spy.mockRestore();

      expect(usage.quotas.session.windowDurationMs).toBe(18000000);
      expect(usage.quotas.weekly.windowDurationMs).toBe(604800000);
    });

    it("normalizes Claude session and weekly windowDurationMs and returns observedAtMs on fresh fetch", async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        json: async () => ({
          five_hour: {
            utilization: 10,
            resets_at: "2026-08-22T05:00:00.000Z",
          },
          seven_day: {
            utilization: 30,
            resets_at: "2026-08-28T05:00:00.000Z",
          },
        }),
      };
      const spy = vi.spyOn(proxyFetchModule, "proxyAwareFetch").mockResolvedValue(mockResponse);
      const usage = await getClaudeUsage("token-test-claude", null, { force: true });
      spy.mockRestore();

      expect(usage.quotas["session (5h)"].windowDurationMs).toBe(18000000);
      expect(usage.quotas["weekly (7d)"].windowDurationMs).toBe(604800000);
      expect(typeof usage.observedAtMs).toBe("number");
      expect(usage.observedAtMs).toBeGreaterThan(0);
    });
  });
});
