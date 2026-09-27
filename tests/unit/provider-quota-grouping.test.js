import { describe, expect, it } from "vitest";
import {
  calculateProviderGroupSummary,
  formatResetTimeDisplay,
  getProviderFailedAccounts,
  groupConnectionsByProvider,
} from "../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js";

describe("provider quota grouping and summary calculations", () => {
  const conn1 = { id: "c1", provider: "gapgpt", name: "09981828080", isActive: true };
  const conn2 = { id: "c2", provider: "gapgpt", name: "09123456789", isActive: true };
  const conn3 = { id: "c3", provider: "antigravity", email: "rmonedev@gmail.com", isActive: true };

  it("groups connections by provider while preserving order and counting active/inactive", () => {
    const conn4 = { id: "c4", provider: "antigravity", email: "inactive@gmail.com", isActive: false };
    const groups = groupConnectionsByProvider([conn1, conn2, conn3, conn4]);

    expect(groups).toHaveLength(2);
    expect(groups[0].provider).toBe("gapgpt");
    expect(groups[0].totalAccounts).toBe(2);
    expect(groups[0].activeAccounts).toBe(2);
    expect(groups[0].inactiveAccounts).toBe(0);

    expect(groups[1].provider).toBe("antigravity");
    expect(groups[1].totalAccounts).toBe(2);
    expect(groups[1].activeAccounts).toBe(1);
    expect(groups[1].inactiveAccounts).toBe(1);
  });

  it("averages remaining percentage across usable accounts", () => {
    const quotaData = {
      c1: {
        quotas: [
          { name: "5h", used: 10, total: 100, remainingPercentage: 90, resetAt: "2026-10-01T12:00:00Z" },
          { name: "Weekly", used: 5, total: 100, remainingPercentage: 95, resetAt: "2026-10-05T00:00:00Z" },
        ],
      },
      c2: {
        quotas: [
          { name: "5h", used: 30, total: 100, remainingPercentage: 70, resetAt: "2026-10-01T10:00:00Z" },
          { name: "Weekly", used: 20, total: 100, remainingPercentage: 80, resetAt: "2026-10-06T00:00:00Z" },
        ],
      },
    };

    const summary = calculateProviderGroupSummary("gapgpt", [conn1, conn2], quotaData, {}, {}, {});

    expect(summary.totalAccounts).toBe(2);
    expect(summary.checkedAccountsCount).toBe(2);
    expect(summary.errorCount).toBe(0);
    expect(summary.failedAccounts).toHaveLength(0);
    expect(summary.buckets).toHaveLength(2);

    const fiveHour = summary.buckets.find((b) => b.name === "5h");
    expect(fiveHour).toBeDefined();
    // The available percentage averages usable accounts (90% and 70%).
    expect(fiveHour.availablePercent).toBe(80);
    expect(fiveHour.usableAccounts).toBe(2);
    expect(fiveHour.exhaustedAccounts).toBe(0);
    expect(fiveHour.checkedAccounts).toBe(2);

    const weekly = summary.buckets.find((b) => b.name === "Weekly");
    expect(weekly).toBeDefined();
    expect(weekly.availablePercent).toBe(88);
    expect(weekly.checkedAccounts).toBe(2);
  });

  it("tracks failed accounts and surfaces them in the summary", () => {
    const quotaData = {
      c1: {
        quotas: [{ name: "5h", used: 0, total: 100, remainingPercentage: 100 }],
      },
      c2: {
        quotas: [],
        message: "401 Unauthorized: Invalid token",
      },
    };
    const errors = {
      c3: "Network timeout connecting to provider",
    };

    const failed = getProviderFailedAccounts([conn1, conn2, conn3], quotaData, errors);
    expect(failed).toHaveLength(2);
    expect(failed[0].connectionId).toBe("c2");
    expect(failed[0].error).toContain("401 Unauthorized");
    expect(failed[1].connectionId).toBe("c3");
    expect(failed[1].error).toContain("Network timeout");

    const summary = calculateProviderGroupSummary("gapgpt", [conn1, conn2], quotaData, errors, {}, {});
    expect(summary.totalAccounts).toBe(2);
    expect(summary.checkedAccountsCount).toBe(1);
    expect(summary.errorCount).toBe(1);
    expect(summary.failedAccounts).toHaveLength(1);
    expect(summary.failedAccounts[0].connectionId).toBe("c2");
  });

  it("updates card summary and clears error immediately when a failed account is retried successfully", () => {
    let quotaData = {
      c1: {
        quotas: [{ name: "5h", used: 10, total: 100, remainingPercentage: 90 }],
      },
      c2: {
        quotas: [],
        message: "Network Error",
      },
    };
    let errors = {
      c2: "Failed to fetch quota",
    };

    // Before retry: c2 has failed
    let summary = calculateProviderGroupSummary("gapgpt", [conn1, conn2], quotaData, errors, {}, {});
    expect(summary.errorCount).toBe(1);
    expect(summary.checkedAccountsCount).toBe(1);
    expect(summary.buckets[0].availablePercent).toBe(90);

    // Simulate clicking retry on c2 and succeeding:
    errors = {};
    quotaData = {
      ...quotaData,
      c2: {
        quotas: [{ name: "5h", used: 40, total: 100, remainingPercentage: 60 }],
        message: null,
      },
    };

    // After retry: c2 error cleared and new quota data included in summary
    summary = calculateProviderGroupSummary("gapgpt", [conn1, conn2], quotaData, errors, {}, {});
    expect(summary.errorCount).toBe(0);
    expect(summary.checkedAccountsCount).toBe(2);
    expect(summary.buckets[0].availablePercent).toBe(75);
    expect(summary.buckets[0].checkedAccounts).toBe(2);
  });

  it("respects visibility settings by excluding hidden quota buckets from provider summary", () => {
    const quotaData = {
      c1: {
        quotas: [
          { name: "5h", used: 10, total: 100, remainingPercentage: 90 },
          { name: "Weekly", used: 5, total: 100, remainingPercentage: 95 },
        ],
      },
    };
    const visibility = {
      gapgpt: { hidden: ["Weekly"] },
    };

    const summary = calculateProviderGroupSummary("gapgpt", [conn1], quotaData, {}, {}, visibility);
    expect(summary.buckets).toHaveLength(1);
    expect(summary.buckets[0].name).toBe("5h");
    expect(summary.hiddenRows).toHaveLength(1);
    expect(summary.hiddenRows[0].name).toBe("Weekly");
  });

  it("reports loading progress and partial coverage when accounts are loading", () => {
    const quotaData = {
      c1: {
        quotas: [{ name: "5h", used: 10, total: 100, remainingPercentage: 90 }],
      },
    };
    const loading = {
      c2: true,
    };

    const summary = calculateProviderGroupSummary("gapgpt", [conn1, conn2], quotaData, {}, loading, {});
    expect(summary.loadingCount).toBe(1);
    expect(summary.isFullyLoaded).toBe(false);
    expect(summary.checkedAccountsCount).toBe(1);
    expect(summary.buckets[0].checkedAccounts).toBe(1);
    expect(summary.buckets[0].totalAccounts).toBe(2);
  });

  it("formats reset time display properly", () => {
    expect(formatResetTimeDisplay(null)).toBeNull();
    const futureDate = new Date(Date.now() + 86400000 * 5).toISOString();
    const formatted = formatResetTimeDisplay(futureDate);
    expect(formatted).toBeTruthy();
  });
});

describe("provider quota availability", () => {
  it("keeps three usable Antigravity accounts available when a fourth is exhausted", () => {
    const connections = ["a", "b", "c", "d"].map((id) => ({ id, provider: "antigravity", isActive: true }));
    const rows = [87, 0, 86, 90];
    const quotaData = Object.fromEntries(connections.map((conn, index) => [conn.id, {
      quotas: [
        { name: "Gemini (5h)", modelKey: "gemini_session", remainingPercentage: rows[index], resetAt: "2099-01-01T00:00:00Z" },
        { name: "Gemini (Weekly)", modelKey: "gemini_weekly", remainingPercentage: index === 1 ? 0 : 66, resetAt: "2099-01-02T00:00:00Z" },
      ],
    }]));

    const summary = calculateProviderGroupSummary("antigravity", connections, quotaData);
    for (const bucket of summary.buckets) {
      expect(bucket.checkedAccounts).toBe(4);
      expect(bucket.usableAccounts).toBe(3);
      expect(bucket.exhaustedAccounts).toBe(1);
      expect(bucket.availablePercent).toBeGreaterThan(0);
    }
    expect(summary.buckets[0].availablePercent).toBe(88);
    expect(summary.buckets[1].availablePercent).toBe(66);
  });

  it("reports zero usable only when every checked account is exhausted", () => {
    const connections = [{ id: "a", provider: "gapgpt" }, { id: "b", provider: "gapgpt" }];
    const data = Object.fromEntries(connections.map((conn) => [conn.id, {
      quotas: [{ name: "5h", used: 100, total: 100 }],
    }]));
    const bucket = calculateProviderGroupSummary("gapgpt", connections, data).buckets[0];
    expect(bucket.usableAccounts).toBe(0);
    expect(bucket.exhaustedAccounts).toBe(2);
    expect(bucket.availablePercent).toBe(0);
    expect(bucket.nextUsableResetAt).toBeNull();
  });
});

  it("provides single-account used and total values directly on bucket for non-aggregated display", () => {
    const connections = [{ id: "codex-1", provider: "codex", name: "rmonedev@gmail.com" }];
    const data = {
      "codex-1": {
        quotas: [{ name: "5h", used: 27, total: 100, remainingPercentage: 73, resetAt: "2099-01-01T00:00:00Z" }],
      },
    };
    const summary = calculateProviderGroupSummary("codex", connections, data);
    expect(summary.totalAccounts).toBe(1);
    expect(summary.buckets[0].used).toBe(27);
    expect(summary.buckets[0].total).toBe(100);
    expect(summary.buckets[0].availablePercent).toBe(73);
  });
