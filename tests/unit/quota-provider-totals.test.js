import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildProviderQuotaSummaries,
  formatProviderQuotaSummaryValue,
  getQuotaCacheEntriesForConnections,
  parseQuotaData,
  runWithConcurrency,
  QUOTA_CACHE_KEY,
} from "../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js";

let originalWindow;

beforeEach(() => {
  originalWindow = globalThis.window;
});

afterEach(() => {
  if (originalWindow === undefined) {
    delete globalThis.window;
  } else {
    globalThis.window = originalWindow;
  }
});

describe("buildProviderQuotaSummaries", () => {
  it("totals finite quota rows per provider and quota name", () => {
    const connections = [
      { id: "ac-1", provider: "autoclaw" },
      { id: "ac-2", provider: "autoclaw" },
      { id: "qoder-1", provider: "qoder" },
    ];
    const quotaData = {
      "ac-1": {
        quotas: [{ name: "points", used: 0, total: 2299, unit: "points" }],
      },
      "ac-2": {
        quotas: [{ name: "points", used: 100, total: 2300, unit: "points" }],
      },
      "qoder-1": {
        quotas: [
          { name: "Personal", used: 200, total: 1000, unit: "credits" },
          { name: "Organization", used: 0, total: 0, unit: "credits" },
        ],
      },
    };

    expect(buildProviderQuotaSummaries(connections, quotaData)).toEqual([
      {
        provider: "autoclaw",
        accountCount: 2,
        quotaCount: 2,
        unlimitedCount: 0,
        units: [
          {
            unit: "points",
            used: 100,
            total: 4599,
            remaining: 4499,
            remainingPercentage: 98,
          },
        ],
      },
      {
        provider: "qoder",
        accountCount: 1,
        quotaCount: 2,
        unlimitedCount: 1,
        units: [
          {
            unit: "Personal",
            used: 200,
            total: 1000,
            remaining: 800,
            remainingPercentage: 80,
          },
        ],
      },
    ]);
  });

  it("keeps quota rows in first-seen order for the same provider", () => {
    const summaries = buildProviderQuotaSummaries(
      [{ id: "multi-1", provider: "mixed" }],
      {
        "multi-1": {
          quotas: [
            { name: "tokens", used: 5, total: 10, unit: "tokens" },
            { name: "requests", used: 2, total: 20, unit: "requests" },
          ],
        },
      },
    );

    expect(summaries[0].units.map((summary) => summary.unit)).toEqual([
      "tokens",
      "requests",
    ]);
  });

  it("keeps Codex session and weekly quotas separate in provider summaries", () => {
    const summaries = buildProviderQuotaSummaries(
      [
        { id: "codex-1", provider: "codex" },
        { id: "codex-2", provider: "codex" },
      ],
      {
        "codex-1": {
          quotas: [
            { name: "session", used: 1, total: 100 },
            { name: "weekly", used: 0, total: 100 },
          ],
        },
        "codex-2": {
          quotas: [
            { name: "session", used: 1, total: 100 },
            { name: "weekly", used: 0, total: 100 },
          ],
        },
      },
    );

    expect(summaries[0].units).toEqual([
      {
        unit: "session",
        used: 2,
        total: 200,
        remaining: 198,
        remainingPercentage: 99,
      },
      {
        unit: "weekly",
        used: 0,
        total: 200,
        remaining: 200,
        remainingPercentage: 100,
      },
    ]);
  });

  it("keeps Antigravity model quotas separate in provider summaries", () => {
    const summaries = buildProviderQuotaSummaries(
      [
        { id: "ag-1", provider: "antigravity" },
        { id: "ag-2", provider: "antigravity" },
      ],
      {
        "ag-1": {
          quotas: [
            { name: "Gemini 3.5 Flash (High)", used: 0, total: 1000 },
            { name: "Claude Sonnet 4.6 (Thinking)", used: 100, total: 1000 },
          ],
        },
        "ag-2": {
          quotas: [
            { name: "Gemini 3.5 Flash (High)", used: 10, total: 1000 },
            { name: "Claude Sonnet 4.6 (Thinking)", used: 0, total: 1000 },
          ],
        },
      },
    );

    expect(summaries[0].units.map((summary) => summary.unit)).toEqual([
      "Gemini 3.5 Flash (High)",
      "Claude Sonnet 4.6 (Thinking)",
    ]);
    expect(summaries[0].units.map((summary) => formatProviderQuotaSummaryValue(summary))).toEqual([
      "10 / 2,000",
      "100 / 2,000",
    ]);
  });

  it("preserves provider quota units before building totals", () => {
    const quotas = parseQuotaData("autoclaw", {
      quotas: {
        points: {
          used: 0,
          total: 2300,
          unit: "points",
        },
      },
    });

    expect(buildProviderQuotaSummaries(
      [{ id: "ac-1", provider: "autoclaw" }],
      { "ac-1": { quotas } },
    )[0].units[0].unit).toBe("points");
  });

  it("formats provider summary totals as used over total", () => {
    expect(formatProviderQuotaSummaryValue({
      used: 300,
      remaining: 2000,
      total: 2300,
    })).toBe("300 / 2,300");
  });
});

describe("getQuotaCacheEntriesForConnections", () => {
  it("loads cached quota entries only for requested account ids", () => {
    const cachedQuota = {
      "ac-1": { quotas: [{ unit: "points", used: 1, total: 10 }] },
      "ac-2": { quotas: [{ unit: "points", used: 2, total: 10 }] },
      "hidden-1": { quotas: [{ unit: "points", used: 9, total: 10 }] },
    };
    globalThis.window = {
      localStorage: {
        getItem: (key) =>
          key === QUOTA_CACHE_KEY ? JSON.stringify(cachedQuota) : null,
      },
    };

    expect(getQuotaCacheEntriesForConnections([
      { id: "ac-1" },
      { id: "ac-2" },
      { id: "missing" },
    ])).toEqual({
      "ac-1": cachedQuota["ac-1"],
      "ac-2": cachedQuota["ac-2"],
    });
  });
});

describe("runWithConcurrency", () => {
  it("processes every item without exceeding the concurrency limit", async () => {
    let active = 0;
    let maxActive = 0;
    const processed = [];

    await runWithConcurrency([1, 2, 3, 4, 5], 2, async (item) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      processed.push(item);
      active -= 1;
    });

    expect(maxActive).toBeLessThanOrEqual(2);
    expect(processed.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });
});
