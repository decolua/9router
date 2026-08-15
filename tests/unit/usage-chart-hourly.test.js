import { describe, expect, it } from "vitest";

import { buildHourlyUsageBuckets } from "../../src/lib/db/repos/usageRepo.js";

const HOUR_MS = 60 * 60 * 1000;
const NOW = Date.UTC(2026, 6, 20, 15, 37, 0);

describe("buildHourlyUsageBuckets", () => {
  it("creates 168 hourly slots including the current partial hour", () => {
    const { buckets } = buildHourlyUsageBuckets([], NOW);

    expect(buckets).toHaveLength(168);
    expect(buckets.every((bucket) => bucket.requests === 0)).toBe(true);
    expect(buckets.at(-1).label).toMatch(/Jul 20 \d{2}:00/);
  });

  it("places tokens, request count, and cost in their hourly slots", () => {
    const currentHour = Math.floor(NOW / HOUR_MS) * HOUR_MS;
    const rows = [
      {
        timestamp: new Date(currentHour + 10 * 60 * 1000).toISOString(),
        promptTokens: 120,
        completionTokens: 30,
        cost: 0.25,
      },
      {
        timestamp: new Date(currentHour - HOUR_MS + 20 * 60 * 1000).toISOString(),
        promptTokens: 40,
        completionTokens: 10,
        cost: 0.1,
      },
      {
        timestamp: new Date(currentHour - 168 * HOUR_MS).toISOString(),
        promptTokens: 999,
        completionTokens: 1,
        cost: 9,
      },
    ];

    const { buckets } = buildHourlyUsageBuckets(rows, NOW);

    expect(buckets.at(-1)).toMatchObject({
      tokens: 150,
      requests: 1,
      cost: 0.25,
    });
    expect(buckets.at(-2)).toMatchObject({
      tokens: 50,
      requests: 1,
      cost: 0.1,
    });
    expect(buckets.reduce((sum, bucket) => sum + bucket.tokens, 0)).toBe(200);
  });
});
