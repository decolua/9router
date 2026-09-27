import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";

// getApiKeyUsageSeries reads the DB via getAdapter and joins against
// getApiKeys — routed-usage.test.js / usage-stats-no-raw-keys.test.js is the
// pattern: swap the adapter, no real SQLite. Mocking these does not affect
// bucketApiKeyRows/bucketsFor below: they never call getAdapter or getApiKeys.
const daily = [];

vi.mock("@/lib/db/driver.js", () => ({
  getAdapter: async () => ({
    all: (sql) => (sql.includes("usageDaily") ? daily : []),
    get: () => null,
    run: () => ({ changes: 0 }),
    transaction: (fn) => fn(),
  }),
}));

vi.mock("@/lib/db/repos/apiKeysRepo.js", () => ({
  getApiKeys: async () => [],
}));

const { bucketApiKeyRows, bucketsFor, getApiKeyUsageSeries, deletedKeyLabel, apiKeyBucketId } =
  await import("@/lib/db/repos/apiKeyUsageRepo.js");

const MAP = { "sk-9router-abcdefgh-live": { id: "key-1", name: "hermes" } };
const H = 3600000;

// Three one-hour buckets starting at epoch 0, end exclusive.
const BUCKETS = [
  { label: "00:00", start: 0, end: H },
  { label: "01:00", start: H, end: 2 * H },
  { label: "02:00", start: 2 * H, end: 3 * H },
];

const row = (ms, apiKey, p, c) => ({
  timestamp: new Date(ms).toISOString(), apiKey, promptTokens: p, completionTokens: c,
});

describe("bucketApiKeyRows", () => {
  it("sums prompt and completion tokens per key per bucket", () => {
    const out = bucketApiKeyRows([
      row(10, "sk-9router-abcdefgh-live", 100, 50),
      row(20, "sk-9router-abcdefgh-live", 10, 5),
    ], BUCKETS, MAP);

    expect(out[0]).toEqual({ label: "00:00", byKey: { "key-1": 165 } });
  });

  it("gives every bucket an entry, including empty ones", () => {
    const out = bucketApiKeyRows([row(10, "sk-9router-abcdefgh-live", 1, 1)], BUCKETS, MAP);
    expect(out.length).toBe(3);
    expect(out[1]).toEqual({ label: "01:00", byKey: {} });
    expect(out[2]).toEqual({ label: "02:00", byKey: {} });
  });

  it("keeps a deleted key and keyless traffic as their own series", () => {
    // "251371a1" is sha256("sk-9router-zzzzzzzz-gone").slice(0, 8) —
    // apiKeyBucketId's deleted-key fallback, not maskApiKey's masked form
    // (which would be "sk-9rout***" for every deleted key on an install).
    const out = bucketApiKeyRows([
      row(10, "sk-9router-zzzzzzzz-gone", 4, 0),
      row(20, null, 2, 0),
    ], BUCKETS, MAP);

    expect(out[0].byKey).toEqual({ "251371a1": 4, "local-no-key": 2 });
    expect(Object.keys(out[0].byKey).join()).not.toContain("zzzzzzzz");
  });

  it("gives two different deleted keys two different series ids", () => {
    // Both raw keys share the same sk-9router-...-gone shape (same first 8
    // chars a real install's machineId would produce), so maskApiKey alone
    // could not tell them apart — this is the whole point of the hash fallback.
    const out = bucketApiKeyRows([
      row(10, "sk-9router-zzzzzzzz-gone", 4, 0),
      row(10, "sk-9router-yyyyyyyy-gone", 7, 0),
    ], BUCKETS, MAP);

    expect(out[0].byKey).toEqual({ "251371a1": 4, "e0578e9d": 7 });
  });

  it("drops rows outside every bucket rather than misplacing them", () => {
    const out = bucketApiKeyRows([
      row(-1, "sk-9router-abcdefgh-live", 9, 9),
      row(3 * H, "sk-9router-abcdefgh-live", 9, 9),
    ], BUCKETS, MAP);

    expect(out.every((b) => Object.keys(b.byKey).length === 0)).toBe(true);
  });

  it("returns a bucket per input bucket when there are no rows at all", () => {
    expect(bucketApiKeyRows([], BUCKETS, MAP)).toEqual([
      { label: "00:00", byKey: {} },
      { label: "01:00", byKey: {} },
      { label: "02:00", byKey: {} },
    ]);
  });
});

// bucketsFor's daily path used to compute a bucket's `end` as `start + 24h`.
// That's wrong on any day a DST transition happens in the local timezone: the
// US spring-forward day (2026-03-08, clocks jump 02:00->03:00) is only 23h of
// epoch time, so `+24h` overshoots a full hour into 03-09 — which collides
// with 03-09's own bucket (whose `start` is computed correctly via setDate).
// bucketApiKeyRows.findIndex then matches 03-08 first, silently moving all of
// 03-09's usage onto 03-08's bar. This machine's own timezone (Asia/Seoul) has
// no DST and can't expose that, so the timezone is pinned for these two tests.
describe("bucketsFor daily boundaries across a DST transition", () => {
  const ORIGINAL_TZ = process.env.TZ;

  beforeAll(() => {
    // 2026 US spring-forward is the night of Mar 8 -> Mar 9.
    process.env.TZ = "America/New_York";
    vi.useFakeTimers();
    // "today" = Mar 20, so a 30d window (Feb 19 - Mar 20) spans the transition
    // regardless of the real date the suite happens to run on.
    vi.setSystemTime(new Date(2026, 2, 20, 12, 0, 0));
  });

  afterAll(() => {
    vi.useRealTimers();
    if (ORIGINAL_TZ === undefined) delete process.env.TZ;
    else process.env.TZ = ORIGINAL_TZ;
  });

  it("partitions time with no gap or overlap, even across the transition", () => {
    const { buckets } = bucketsFor("30d", null);
    expect(buckets.length).toBe(30);
    for (let i = 0; i < buckets.length - 1; i++) {
      expect(buckets[i].end).toBe(buckets[i + 1].start);
    }
  });

  it("a row stamped at 03-09's local midnight lands in 03-09's bucket, not 03-08's", () => {
    const { buckets } = bucketsFor("30d", null);
    const mar8 = buckets.findIndex((b) => b.label === "2026-03-08");
    const mar9 = buckets.findIndex((b) => b.label === "2026-03-09");
    expect(mar8).toBeGreaterThanOrEqual(0);
    expect(mar9).toBe(mar8 + 1);

    const row = { timestamp: new Date(2026, 2, 9, 0, 0, 0).toISOString(), apiKey: null, promptTokens: 1, completionTokens: 0 };
    const out = bucketApiKeyRows([row], buckets, {});
    expect(out[mar9].byKey["local-no-key"]).toBe(1);
    expect(out[mar8].byKey["local-no-key"]).toBeUndefined();
  });
});

// The equality between the chart legend and the table's deleted-key label
// (api-key-usage-bucket-id.test.js) previously compared two hand-built
// strings — neither side touched the real `(deleted) ${id}` template inside
// getApiKeyUsageSeries, so a change to that template (drop the space, change
// the prefix) would pass every committed test while the chart and the table
// diverge on screen. This exercises the real function instead.
describe("getApiKeyUsageSeries", () => {
  beforeEach(() => { daily.length = 0; });

  it("labels a deleted key in the real chart-legend map exactly like deletedKeyLabel does", async () => {
    const rawKey = "sk-9router-zzzzzzzz-gone";
    const today = new Date();
    const dateKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    daily.push({
      dateKey,
      data: JSON.stringify({
        byApiKey: { [`${rawKey}|model|prov`]: { apiKey: rawKey, promptTokens: 10, completionTokens: 5 } },
      }),
    });

    const { keys } = await getApiKeyUsageSeries("7d");
    // Same identity apiKeyBucketId gives this key (empty map: it has no
    // apiKeys record, so this is its hash) — indexing directly, not
    // Object.keys().find(...), so a stray extra id gives a clear failure.
    const id = apiKeyBucketId(rawKey, {});

    expect(keys[id]).toBe(deletedKeyLabel(rawKey));
  });
});
