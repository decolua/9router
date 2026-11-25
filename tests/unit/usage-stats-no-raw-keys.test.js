import { describe, it, expect, vi, beforeEach } from "vitest";

const daily = [];
const history = [];

// routed-usage.test.js is the pattern: swap the adapter, no real SQLite.
vi.mock("@/lib/db/driver.js", () => ({
  getAdapter: async () => ({
    all: (sql) => (sql.includes("usageDaily") ? daily : history),
    get: () => null,
    run: () => ({ changes: 0 }),
    transaction: (fn) => fn(),
  }),
}));

vi.mock("@/lib/db/repos/apiKeysRepo.js", () => ({
  getApiKeys: async () => [{ id: "key-1", key: "sk-9router-abcdefgh-live", name: "hermes" }],
}));
vi.mock("@/lib/db/repos/connectionsRepo.js", () => ({ getProviderConnections: async () => [] }));
vi.mock("@/lib/db/repos/nodesRepo.js", () => ({ getProviderNodes: async () => [] }));

const { getUsageStats } = await import("@/lib/db/repos/usageRepo.js");

beforeEach(() => { daily.length = 0; history.length = 0; });

const LIVE = "sk-9router-abcdefgh-live";
const GONE = "sk-9router-zzzzzzzz-gone";
const GONE2 = "sk-9router-yyyyyyyy-gone";

function day(dateKey, byApiKey) {
  return { dateKey, data: JSON.stringify({ requests: 1, promptTokens: 0, completionTokens: 0, cost: 0, byProvider: {}, byModel: {}, byAccount: {}, byApiKey, byEndpoint: {} }) };
}

function bucket(apiKey, rawModel = "claude-cli-opus-1m") {
  // rawModel is parameterized (brief's fixture hardcoded it) so the
  // local-no-key/haiku entry below actually exercises a distinct model:
  // the response composite is built from this value field (ak.rawModel),
  // never by re-parsing the storage key, so a hardcoded rawModel here would
  // make the "haiku" assertion below unsatisfiable regardless of the
  // implementation under test.
  return { requests: 2, promptTokens: 100, completionTokens: 50, cachedTokens: 10, cost: 0.5, rawModel, provider: "claude-cli", apiKey };
}

describe("getUsageStats byApiKey keying", () => {
  it("never puts a raw API key in a property name", async () => {
    daily.push(day("2026-09-25", {
      [`${LIVE}|claude-cli-opus-1m|claude-cli`]: bucket(LIVE),
      [`${GONE}|claude-cli-opus-1m|claude-cli`]: bucket(GONE),
      [`${GONE2}|claude-cli-opus-1m|claude-cli`]: bucket(GONE2),
      [`local-no-key|claude-cli-haiku|claude-cli`]: bucket(null, "claude-cli-haiku"),
    }));

    const stats = await getUsageStats("7d");
    const names = Object.keys(stats.byApiKey);

    // GONE and GONE2 must land in two different buckets, not one. Both share
    // the same sk-9router-...-gone shape a real install's machineId would
    // produce, so maskApiKey's masked form — identical for both — used to
    // merge every deleted key's history into one row/series (the bug
    // apiKeyBucketId's hash fallback exists to fix; see apiKeyUsageRepo.js).
    expect(names.length).toBe(4);
    for (const name of names) {
      expect(name, `"${name}" leaks a raw key`).not.toContain(LIVE);
      expect(name, `"${name}" leaks a raw key`).not.toContain(GONE);
      expect(name, `"${name}" leaks a raw key`).not.toContain(GONE2);
    }
    expect(names).toContain("key-1|claude-cli-opus-1m|claude-cli");
    expect(names).toContain("251371a1|claude-cli-opus-1m|claude-cli");
    expect(names).toContain("e0578e9d|claude-cli-opus-1m|claude-cli");
    expect(names).toContain("local-no-key|claude-cli-haiku|claude-cli");
  });

  it("gives two different deleted keys two different keyName labels", async () => {
    // The table (UsageStats.js) groups rows by keyName, not by the property
    // name above. Before this fix both deleted keys' keyName fell back to
    // `${apiKeyVal.slice(0, 8)}...`, identical for every key on an install —
    // the same collision apiKeyBucketId's hash fallback fixed one level down,
    // still live here where the user actually sees it.
    daily.push(day("2026-09-25", {
      [`${GONE}|claude-cli-opus-1m|claude-cli`]: bucket(GONE),
      [`${GONE2}|claude-cli-opus-1m|claude-cli`]: bucket(GONE2),
    }));

    const stats = await getUsageStats("7d");
    const keyNameGone = stats.byApiKey["251371a1|claude-cli-opus-1m|claude-cli"].keyName;
    const keyNameGone2 = stats.byApiKey["e0578e9d|claude-cli-opus-1m|claude-cli"].keyName;

    expect(keyNameGone).not.toBe(keyNameGone2);
    expect(keyNameGone).toBe("(deleted) 251371a1");
    expect(keyNameGone2).toBe("(deleted) e0578e9d");
  });

  it("keeps the values the table renders", async () => {
    daily.push(day("2026-09-25", { [`${LIVE}|claude-cli-opus-1m|claude-cli`]: bucket(LIVE) }));

    const stats = await getUsageStats("7d");
    const row = stats.byApiKey["key-1|claude-cli-opus-1m|claude-cli"];
    expect(row).toMatchObject({
      requests: 2, promptTokens: 100, completionTokens: 50, cachedTokens: 10,
      keyName: "hermes", rawModel: "claude-cli-opus-1m",
    });
    expect(row.apiKeyMasked).toBe("sk-9rout***live");
  });

  it("keeps two providers with one display name apart", async () => {
    // The composite must use the raw provider id. Display names are not unique.
    daily.push(day("2026-09-25", {
      [`${LIVE}|m|prov-a`]: { ...bucket(LIVE), provider: "prov-a" },
      [`${LIVE}|m|prov-b`]: { ...bucket(LIVE), provider: "prov-b" },
    }));

    const stats = await getUsageStats("7d");
    expect(Object.keys(stats.byApiKey).length).toBe(2);
  });

  it("overlays lastUsed from history onto the re-keyed bucket", async () => {
    daily.push(day("2026-09-25", { [`${LIVE}|claude-cli-opus-1m|claude-cli`]: bucket(LIVE) }));
    const ts = new Date().toISOString();
    history.push({ timestamp: ts, provider: "claude-cli", model: "claude-cli-opus-1m", connectionId: null, apiKey: LIVE, endpoint: "chat" });

    const stats = await getUsageStats("7d");
    expect(stats.byApiKey["key-1|claude-cli-opus-1m|claude-cli"].lastUsed).toBe(ts);
  });

  it("keeps the no-key bucket's key shape the same across periods", async () => {
    // Daily path (7d/30d/60d/all) and the 24h/today live-history path must
    // produce the same "local-no-key|model|provider" shape. Before this fix
    // the 24h/today path merged every model/provider into one bare
    // "local-no-key" row, so toggling the period selector on the API Key
    // Usage page would reshape this row from several to one.
    daily.push(day("2026-09-25", { ["local-no-key|claude-cli-opus-1m|claude-cli"]: bucket(null) }));
    history.push({
      timestamp: new Date().toISOString(), provider: "claude-cli", model: "claude-cli-opus-1m",
      connectionId: null, apiKey: null, endpoint: "chat", cost: 0, tokens: JSON.stringify({}),
    });

    const expectedKey = "local-no-key|claude-cli-opus-1m|claude-cli";
    const dailyStats = await getUsageStats("7d");
    const liveStats = await getUsageStats("24h");

    expect(Object.keys(dailyStats.byApiKey)).toContain(expectedKey);
    expect(Object.keys(liveStats.byApiKey)).toContain(expectedKey);
    expect(liveStats.byApiKey).not.toHaveProperty("local-no-key");
  });
});
