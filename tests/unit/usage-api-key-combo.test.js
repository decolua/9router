import { describe, it, expect, vi, beforeEach } from "vitest";

// Same adapter swap as usage-stats-no-raw-keys.test.js: no real SQLite.
const daily = [];
const history = [];
const runs = [];

vi.mock("@/lib/db/driver.js", () => ({
  getAdapter: async () => ({
    all: (sql) => (sql.includes("usageDaily") ? daily : history),
    get: () => null,
    run: (sql, params) => { runs.push({ sql, params }); return { changes: 1 }; },
    transaction: (fn) => fn(),
  }),
}));
vi.mock("@/lib/db/repos/apiKeysRepo.js", () => ({
  getApiKeys: async () => [{ id: "key-1", key: "sk-9router-abcdefgh-live", name: "hermes" }],
}));
vi.mock("@/lib/db/repos/connectionsRepo.js", () => ({ getProviderConnections: async () => [] }));
vi.mock("@/lib/db/repos/nodesRepo.js", () => ({ getProviderNodes: async () => [] }));
vi.mock("@/lib/db/repos/pricingRepo.js", () => ({ getPricingForModel: async () => null }));

const { getUsageStats, saveRequestUsage } = await import("@/lib/db/repos/usageRepo.js");

const KEY = "sk-9router-abcdefgh-live";

beforeEach(() => { daily.length = 0; history.length = 0; runs.length = 0; });

describe("per-key combo tracking", () => {
  it("stores the combo in the history row and splits the key's daily bucket by it", async () => {
    await saveRequestUsage({
      provider: "codex", model: "gpt-6-luna", apiKey: KEY, combo: "Mini",
      tokens: { prompt_tokens: 10, completion_tokens: 5 }, timestamp: "2026-11-03T03:00:00.000Z",
    });
    const insert = runs.find((r) => r.sql.includes("INSERT INTO usageHistory"));
    expect(JSON.parse(insert.params.at(-1))).toEqual({ combo: "Mini" });

    const dailyWrite = runs.find((r) => r.sql.includes("INSERT INTO usageDaily"));
    const byApiKey = JSON.parse(dailyWrite.params[1]).byApiKey;
    expect(Object.keys(byApiKey)).toEqual([`${KEY}|gpt-6-luna|codex|Mini`]);
    expect(byApiKey[`${KEY}|gpt-6-luna|codex|Mini`].combo).toBe("Mini");
  });

  it("keeps a direct call on the pre-combo storage key", async () => {
    await saveRequestUsage({
      provider: "codex", model: "gpt-6-luna", apiKey: KEY,
      tokens: { prompt_tokens: 10, completion_tokens: 5 }, timestamp: "2026-11-03T03:00:00.000Z",
    });
    const dailyWrite = runs.find((r) => r.sql.includes("INSERT INTO usageDaily"));
    expect(Object.keys(JSON.parse(dailyWrite.params[1]).byApiKey)).toEqual([`${KEY}|gpt-6-luna|codex`]);
  });

  it("reports the combo per key row, for daily and live-history periods", async () => {
    daily.push({
      dateKey: "2026-11-03",
      data: JSON.stringify({
        byApiKey: {
          [`${KEY}|gpt-6-luna|codex|Mini`]: { requests: 2, rawModel: "gpt-6-luna", provider: "codex", apiKey: KEY, combo: "Mini" },
          [`${KEY}|gpt-6-luna|codex`]: { requests: 1, rawModel: "gpt-6-luna", provider: "codex", apiKey: KEY },
        },
      }),
    });
    const week = await getUsageStats("7d");
    expect(week.byApiKey["key-1|gpt-6-luna|codex|Mini"]).toMatchObject({ combo: "Mini", requests: 2, keyName: "hermes" });
    expect(week.byApiKey["key-1|gpt-6-luna|codex"]).toMatchObject({ combo: null, requests: 1 });

    history.push({
      timestamp: new Date().toISOString(), provider: "codex", model: "gpt-6-luna", apiKey: KEY,
      promptTokens: 1, completionTokens: 1, cost: 0, tokens: "{}", meta: JSON.stringify({ combo: "Mini" }),
    });
    const day = await getUsageStats("24h");
    expect(day.byApiKey["key-1|gpt-6-luna|codex|Mini"]).toMatchObject({ combo: "Mini", requests: 1 });
  });
});
