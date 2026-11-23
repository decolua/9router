import { describe, it, expect } from "vitest";
import { getAccountWindowReset, orderAccountsByWindow, validateAccountSelectionSettings, SNAPSHOT_MAX_AGE_MS } from "../../src/shared/utils/accountOrdering.js";

const now = Date.parse("2026-11-19T12:00:00Z");
const quota = ms => ({ resetAt: new Date(now + ms).toISOString() });
const snapshot = (weekly, session) => ({ fetchedAt: now, quotas: { weekly: quota(weekly), session: quota(session) } });
const accounts = [{ id: "a", priority: 2 }, { id: "b", priority: 1 }, { id: "missing", priority: 0 }];
const snapshots = { a: snapshot(1000, 9000), b: snapshot(9000, 1000) };
const ids = (mode, data = snapshots) => orderAccountsByWindow(accounts, mode, data, null, now).map(c => c.id);

describe("account reset order", () => {
  it("sorts weekly and session in both directions, missing data always last", () => {
    expect(ids("weekly-reset-asc")).toEqual(["a", "b", "missing"]);
    expect(ids("weekly-reset-desc")).toEqual(["b", "a", "missing"]);
    expect(ids("session-reset-asc")).toEqual(["b", "a", "missing"]);
    expect(ids("session-reset-desc")).toEqual(["a", "b", "missing"]);
  });
  it("retains manual priorities and treats zero as valid", () => {
    expect(ids("weekly-reset-asc", {})).toEqual(["missing", "b", "a"]);
    expect(accounts.map(c => c.id)).toEqual(["a", "b", "missing"]);
    expect(accounts.map(c => c.priority)).toEqual([2, 1, 0]);
  });
  it("breaks equal resets by manual priority, then ID", () => {
    expect(ids("weekly-reset-desc", { a: snapshot(1000, 1000), b: snapshot(1000, 1000) })).toEqual(["b", "a", "missing"]);
    expect(orderAccountsByWindow([{ id: "z", priority: 1 }, { id: "a", priority: 1 }], "weekly-reset-asc", {}, null, now).map(c => c.id)).toEqual(["a", "z"]);
  });
  it.each([null, {}, { fetchedAt: now - SNAPSHOT_MAX_AGE_MS, quotas: { weekly: quota(1000) } }, { fetchedAt: now + 1, quotas: { weekly: quota(1000) } }, snapshot(-1, -1), { fetchedAt: now, quotas: { weekly: { resetAt: "invalid" } } }, { fetchedAt: now, quotas: { weekly: { ...quota(1000), unlimited: true } } }])("rejects absent, stale, invalid, elapsed or unlimited windows: %j", data => {
    expect(getAccountWindowReset(data, "weekly-reset-asc", null, now)).toBeNull();
  });
  it("uses Claude windows and matching model limits, not unrelated ones", () => {
    const data = { fetchedAt: new Date(now).toISOString(), quotas: {
      "weekly (7d)": quota(9000), "session (5h)": quota(5000),
      "weekly sonnet (7d)": quota(2000), "weekly opus (7d)": quota(1000),
    } };
    expect(getAccountWindowReset(data, "weekly-reset-asc", "claude-sonnet-4", now)).toBe(now + 2000);
    expect(getAccountWindowReset(data, "weekly-reset-asc", "claude-opus-4", now)).toBe(now + 1000);
    expect(getAccountWindowReset(data, "weekly-reset-asc", "unrelated", now)).toBe(now + 9000);
    expect(getAccountWindowReset(data, "session-reset-asc", "claude-opus-4", now)).toBe(now + 5000);
  });
});

describe("selection settings validation", () => {
  it("allows supported strategies and preserves unrelated overrides", () => {
    expect(validateAccountSelectionSettings({ providerStrategies: { claude: { fallbackStrategy: "weekly-reset-asc", stickyRoundRobinLimit: 1, rotateStrategy: "random", proxyPoolId: "pool" }, custom: { fallbackStrategy: "random" } } })).toBeNull();
    expect(validateAccountSelectionSettings({ unrelated: true })).toBeNull();
  });
  it.each([
    { fallbackStrategy: "invalid" }, { fallbackStrategy: "weekly-reset-asc" },
    { stickyRoundRobinLimit: 0 }, { stickyRoundRobinLimit: "2" }, { stickyRoundRobinLimit: 1.5 },
    { providerStrategies: [] }, { providerStrategies: null }, { providerStrategies: { claude: null } },
    { providerStrategies: { claude: { fallbackStrategy: "wat" } } },
    { providerStrategies: { openai: { fallbackStrategy: "weekly-reset-asc" } } },
    { providerStrategies: { codex: { stickyRoundRobinLimit: -1 } } },
  ])("rejects invalid input: %j", body => expect(validateAccountSelectionSettings(body)).toEqual(expect.any(String)));
});
