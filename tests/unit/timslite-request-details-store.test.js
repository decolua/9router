import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { DB_DIR, TIMSLITE_REQUEST_DETAILS_PATH } from "@/lib/db/paths.js";
import {
  TIMSLITE_RECORD_MAX_BYTES,
  TIMSLITE_RECORD_SAFE_BYTES,
  TIMSLITE_VALUE_CACHE_MAX_ENTRIES,
  TIMSLITE_VALUE_REF_PATTERN,
  _resetGlobalValueCache,
  computeCrossRecordTtlMicroseconds,
  createMonotonicCentisecondId,
  createRequestDetailsStore,
  createValueCache,
  getTimsliteRetentionDays,
  isTimsliteDataStoreEnabled,
  truncateUtf8Json,
} from "@/lib/timslite/requestDetailsStore.js";

function makeFakeAdapter(options = {}) {
  const records = new Map();
  const calls = {
    storeOpen: [],
    createDataset: [],
    openDataset: [],
    write: [],
    read: [],
    readLatest: 0,
    flush: 0,
    close: 0,
  };
  let latestTimestamp = 0n;
  const forceReadOnly = options.forceReadOnly || false;
  return {
    calls,
    records,
    setLatestTimestamp(ts) {
      latestTimestamp = BigInt(ts);
      if (!records.has(latestTimestamp.toString())) {
        records.set(latestTimestamp.toString(), JSON.stringify({ __seed: true }));
      }
    },
    adapter: {
      async openStore(dataDir, config) {
        calls.storeOpen.push({ dataDir, config });
        const isReadOnly = forceReadOnly || (config && config.readOnly === true);
        return {
          readOnly: isReadOnly,
          async createDataset(name, type, options) {
            calls.createDataset.push({ name, type, options });
          },
          async openDataset(name, type) {
            calls.openDataset.push({ name, type });
            return {
              async write(timestamp, data) {
                calls.write.push({ timestamp: BigInt(timestamp), data });
                const ts = BigInt(timestamp);
                records.set(ts.toString(), data.toString("utf8"));
                if (ts > latestTimestamp) latestTimestamp = ts;
              },
              async read(timestamp) {
                calls.read.push(BigInt(timestamp));
                const ts = BigInt(timestamp);
                const value = records.get(ts.toString());
                if (value === undefined) return null;
                return [ts, Buffer.from(value, "utf8")];
              },
              async readLatest() {
                calls.readLatest += 1;
                if (latestTimestamp === 0n) return null;
                const value = records.get(latestTimestamp.toString());
                if (value === undefined) return null;
                return [latestTimestamp, Buffer.from(value, "utf8")];
              },
              async flush() { calls.flush += 1; },
              async close() { calls.close += 1; },
            };
          },
          async close() { calls.close += 1; },
        };
      },
    },
  };
}

describe("Timslite request-details configuration", () => {
  it("uses the SQLite sibling request-details path", () => {
    expect(TIMSLITE_REQUEST_DETAILS_PATH).toBe(path.join(DB_DIR, "timslite", "9router"));
  });

  it.each([undefined, "", "0", "-3", "1.5", "30days", "not-a-number"])("defaults invalid retention %j to 7 days", (value) => {
    expect(getTimsliteRetentionDays({ OBSERVABILITY_TIMSLITE_RETENTION_DAYS: value })).toBe(7);
  });

  it("uses a positive whole-day retention value", () => {
    expect(getTimsliteRetentionDays({ OBSERVABILITY_TIMSLITE_RETENTION_DAYS: "30" })).toBe(30);
  });
});

describe("isTimsliteDataStoreEnabled — literal-only gate", () => {
  it.each([
    ["true", true],
    ["TRUE", false],
    ["True", false],
    ["tRuE", false],
    [" true", false],
    ["true ", false],
    [" true ", false],
    ["1", false],
    ["0", false],
    ["yes", false],
    ["", false],
  ])("value %j → enabled %s", (value, expected) => {
    expect(isTimsliteDataStoreEnabled({ OBSERVABILITY_TIMSLITE_DATA_STORE: value })).toBe(expected);
  });

  it("returns false when the variable is absent, undefined, or null", () => {
    expect(isTimsliteDataStoreEnabled({})).toBe(false);
    expect(isTimsliteDataStoreEnabled({ OBSERVABILITY_TIMSLITE_DATA_STORE: undefined })).toBe(false);
    expect(isTimsliteDataStoreEnabled({ OBSERVABILITY_TIMSLITE_DATA_STORE: null })).toBe(false);
  });

  it("defaults to process.env and restores it afterwards", () => {
    const original = process.env.OBSERVABILITY_TIMSLITE_DATA_STORE;
    try {
      process.env.OBSERVABILITY_TIMSLITE_DATA_STORE = "true";
      expect(isTimsliteDataStoreEnabled()).toBe(true);
      process.env.OBSERVABILITY_TIMSLITE_DATA_STORE = "TRUE";
      expect(isTimsliteDataStoreEnabled()).toBe(false);
    } finally {
      if (original === undefined) delete process.env.OBSERVABILITY_TIMSLITE_DATA_STORE;
      else process.env.OBSERVABILITY_TIMSLITE_DATA_STORE = original;
    }
  });
});

describe("Timslite request-details store", () => {
  it("exposes a 4 MiB record cap constant", () => {
    expect(TIMSLITE_RECORD_MAX_BYTES).toBe(4 * 1024 * 1024);
  });

  it("keeps the serialization budget below the hard record cap", () => {
    expect(TIMSLITE_RECORD_SAFE_BYTES).toBe(TIMSLITE_RECORD_MAX_BYTES - 64 * 1024);
  });

  it.each([undefined, "", "false", "0", "1", "yes", "True", "TRUE", " true", "true ", " true ", "TRUE ", "tRuE"])(
    "is disabled unless OBSERVABILITY_TIMSLITE_DATA_STORE is the literal string true (%j)",
    (value) => {
      const fake = makeFakeAdapter();
      const store = createRequestDetailsStore({ adapter: fake.adapter, env: { OBSERVABILITY_TIMSLITE_DATA_STORE: value } });
      expect(store.enabled).toBe(false);
    }
  );

  it("is enabled only for the exact literal string true", () => {
    const fake = makeFakeAdapter();
    const store = createRequestDetailsStore({ adapter: fake.adapter, env: { OBSERVABILITY_TIMSLITE_DATA_STORE: "true" } });
    expect(store.enabled).toBe(true);
  });

  it("disabled store does not open the dataset on flush", async () => {
    const fake = makeFakeAdapter();
    const store = createRequestDetailsStore({ adapter: fake.adapter, env: {} });
    expect(store.enabled).toBe(false);
    await store.flush();
    expect(fake.calls.storeOpen).toEqual([]);
    expect(fake.calls.flush).toBe(0);
  });

  it("opens local 9router/requestDetails with the configured path and configures 7-day retention", async () => {
    const fake = makeFakeAdapter();
    const store = createRequestDetailsStore({
      adapter: fake.adapter,
      env: { OBSERVABILITY_TIMSLITE_DATA_STORE: "true" },
    });
    await store.stage({ id: "detail-a", request: { body: "hello" } });
    await store.flush();
    expect(fake.calls.storeOpen).toHaveLength(1);
    expect(fake.calls.storeOpen[0].dataDir).toBe(TIMSLITE_REQUEST_DETAILS_PATH);
    expect(fake.calls.createDataset).toHaveLength(1);
    expect(fake.calls.createDataset[0]).toMatchObject({
      name: "requestDetails",
      type: "raw",
    });
    expect(fake.calls.createDataset[0].options.retentionWindow).toBe(7n * 24n * 60n * 60n * 100n);
  });

  it("uses a custom retention when configured", async () => {
    const fake = makeFakeAdapter();
    const store = createRequestDetailsStore({
      adapter: fake.adapter,
      env: { OBSERVABILITY_TIMSLITE_DATA_STORE: "true", OBSERVABILITY_TIMSLITE_RETENTION_DAYS: "30" },
    });
    await store.stage({ id: "x" });
    await store.flush();
    expect(fake.calls.createDataset[0].options.retentionWindow).toBe(30n * 24n * 60n * 60n * 100n);
  });

  it("stage returns exactly { timslite_id } as a decimal string pointer with no metadata", async () => {
    const fake = makeFakeAdapter();
    const store = createRequestDetailsStore({
      adapter: fake.adapter,
      env: { OBSERVABILITY_TIMSLITE_DATA_STORE: "true" },
    });
    const pointer = await store.stage({ id: "a", request: { body: "hello" } });
    expect(Object.keys(pointer)).toEqual(["timslite_id"]);
    expect(pointer.timslite_id).toMatch(/^\d+$/);
    expect(typeof pointer.timslite_id).toBe("string");
  });

  it("writes staged values then issues exactly one flush for the batch", async () => {
    const fake = makeFakeAdapter();
    const store = createRequestDetailsStore({
      adapter: fake.adapter,
      env: { OBSERVABILITY_TIMSLITE_DATA_STORE: "true" },
    });
    await store.stage({ id: "a", request: { x: 1 } });
    await store.stage({ id: "b", response: { y: 2 } });
    await store.flush();
    expect(fake.calls.write).toHaveLength(2);
    expect(fake.calls.flush).toBe(1);
  });

  it("does not call delete at any point", async () => {
    const fake = makeFakeAdapter();
    const store = createRequestDetailsStore({
      adapter: fake.adapter,
      env: { OBSERVABILITY_TIMSLITE_DATA_STORE: "true" },
    });
    await store.stage({ id: "a" });
    await store.flush();
    await store.close();
    expect(fake.calls.write).toHaveLength(1);
  });

  it("flush with no staged records still opens and configures retention but does not write", async () => {
    const fake = makeFakeAdapter();
    const store = createRequestDetailsStore({
      adapter: fake.adapter,
      env: { OBSERVABILITY_TIMSLITE_DATA_STORE: "true" },
    });
    await store.flush();
    expect(fake.calls.storeOpen).toHaveLength(1);
    expect(fake.calls.createDataset).toHaveLength(1);
    expect(fake.calls.write).toHaveLength(0);
    expect(fake.calls.flush).toBe(1);
  });

  it("does not mutate the caller's detail object", async () => {
    const fake = makeFakeAdapter();
    const store = createRequestDetailsStore({
      adapter: fake.adapter,
      env: { OBSERVABILITY_TIMSLITE_DATA_STORE: "true" },
    });
    const detail = { id: "a", request: { body: "hello" } };
    const snapshot = JSON.parse(JSON.stringify(detail));
    await store.stage(detail);
    expect(detail).toEqual(snapshot);
  });

  it("stored values are JSON parseable", async () => {
    const fake = makeFakeAdapter();
    const store = createRequestDetailsStore({
      adapter: fake.adapter,
      env: { OBSERVABILITY_TIMSLITE_DATA_STORE: "true" },
    });
    await store.stage({ id: "a", request: { body: "hello" } });
    await store.flush();
    for (const value of fake.records.values()) {
      expect(() => JSON.parse(value)).not.toThrow();
    }
  });
});

describe("Monotonic logical IDs — seconds x 100 + sequence", () => {
  it("generates decimal ids as unixSeconds*100 with sequence starting at 00", async () => {
    const idGen = createMonotonicCentisecondId(() => 1_726_480_000_123, async () => {});
    expect(await idGen.next()).toBe(172_648_000_000n);
    expect((172_648_000_000n % 100n)).toBe(0n);
    expect(await idGen.next()).toBe(172_648_000_001n);
    expect(await idGen.next()).toBe(172_648_000_002n);
  });

  it("waits for the next second on the 101st call within one second instead of throwing", async () => {
    let nowMs = 1_726_480_000_123;
    const waits = [];
    const idGen = createMonotonicCentisecondId(() => nowMs, async (ms) => {
      waits.push(ms);
      nowMs += ms;
    });
    const base = 172_648_000_000n;
    for (let i = 0; i < 100; i += 1) {
      expect(await idGen.next()).toBe(base + BigInt(i));
    }
    const hundredFirst = await idGen.next();
    expect(waits).toEqual([877]);
    expect(hundredFirst).toBe(base + 100n);
    expect(hundredFirst % 100n).toBe(0n);
    expect(hundredFirst > base + 99n).toBe(true);
  });

  it("stays strictly increasing when the clock moves backward without waiting", async () => {
    let nowMs = 2_000_000_005_000;
    const waits = [];
    const idGen = createMonotonicCentisecondId(() => nowMs, async (ms) => {
      waits.push(ms);
      nowMs += ms;
    });
    const first = await idGen.next();
    nowMs = 1_999_999_995_000;
    const second = await idGen.next();
    expect(second).toBe(first + 1n);
    expect(waits).toEqual([]);
  });

  it("waits for next-second boundary when clock rolls back at sequence 99 instead of overflowing", async () => {
    const SECOND = 1_726_480_000;
    let nowMs = (SECOND + 1) * 1000;
    const waits = [];
    const idGen = createMonotonicCentisecondId(() => nowMs, async (ms) => {
      waits.push(ms);
      nowMs += ms;
    });
    // Seed to ...99 (sequence cap)
    idGen.seedFrom(BigInt(SECOND) * 100n + 99n);
    // Roll clock back before that second
    nowMs = (SECOND - 1) * 1000;

    const id = await idGen.next();

    // Should have waited for wall clock to reach the next second
    expect(waits).toEqual([2000]);
    // Emit exactly lastId + 1 ending in 00 (sequence 0 of next second)
    expect(id).toBe(BigInt(SECOND) * 100n + 100n);
    expect(id % 100n).toBe(0n);
  });
});

describe("UTF-8 JSON truncation", () => {
  it("returns small payloads unchanged", () => {
    const payload = { request: { body: "hello" } };
    const result = truncateUtf8Json(payload);
    expect(JSON.parse(result)).toEqual(payload);
    expect(Buffer.byteLength(result, "utf8")).toBeLessThanOrEqual(TIMSLITE_RECORD_MAX_BYTES);
  });

  it("truncates oversized payloads while keeping JSON parseable", () => {
    const bigString = "x".repeat(5 * 1024 * 1024);
    const payload = { request: { body: bigString }, id: "keep-me" };
    const result = truncateUtf8Json(payload);
    expect(Buffer.byteLength(result, "utf8")).toBeLessThanOrEqual(TIMSLITE_RECORD_MAX_BYTES);
    expect(() => JSON.parse(result)).not.toThrow();
    const parsed = JSON.parse(result);
    expect(parsed.id).toBe("keep-me");
  });

  it("stores a near-boundary payload within the safe budget and below the hard cap", async () => {
    const fake = makeFakeAdapter();
    const store = createRequestDetailsStore({
      adapter: fake.adapter,
      env: { OBSERVABILITY_TIMSLITE_DATA_STORE: "true" },
    });
    await store.stage({ request: { body: "x".repeat(TIMSLITE_RECORD_MAX_BYTES) } });
    await store.flush();

    const stored = fake.calls.write[0].data;
    expect(stored.byteLength).toBeLessThan(TIMSLITE_RECORD_MAX_BYTES);
    expect(stored.byteLength).toBeLessThanOrEqual(TIMSLITE_RECORD_SAFE_BYTES);
  });

  it("truncation result includes a stable marker and original byte count", () => {
    const bigString = "x".repeat(5 * 1024 * 1024);
    const payload = { request: { body: bigString } };
    const originalBytes = Buffer.byteLength(JSON.stringify(payload), "utf8");
    const result = truncateUtf8Json(payload);
    const parsed = JSON.parse(result);
    expect(parsed.__truncated).toBe(true);
    expect(parsed.__originalBytes).toBe(originalBytes);
  });

  it("handles multi-byte UTF-8 characters without splitting surrogate pairs", () => {
    const emoji = "😀";
    const payload = { request: { body: emoji.repeat(1_200_000) } };
    const result = truncateUtf8Json(payload);
    expect(Buffer.byteLength(result, "utf8")).toBeLessThanOrEqual(TIMSLITE_RECORD_MAX_BYTES);
    expect(() => JSON.parse(result)).not.toThrow();
  });

  it("throws RangeError when minimum marker cannot fit", () => {
    const payload = { id: "test" };
    expect(() => truncateUtf8Json(payload, 5)).toThrow(RangeError);
  });
});

describe("getMany bounded point reads", () => {
  it("reads each unique requested pointer once and returns a Map", async () => {
    const fake = makeFakeAdapter();
    const store = createRequestDetailsStore({
      adapter: fake.adapter,
      env: { OBSERVABILITY_TIMSLITE_DATA_STORE: "true" },
    });
    const p1 = await store.stage({ id: "a" });
    const p2 = await store.stage({ id: "b" });
    await store.flush();

    const result = await store.getMany([p1.timslite_id, p2.timslite_id]);
    expect(result).toBeInstanceOf(Map);
    expect(result.size).toBe(2);
    expect(result.get(p1.timslite_id)).toEqual({ id: "a" });
    expect(result.get(p2.timslite_id)).toEqual({ id: "b" });
    expect(fake.calls.read).toHaveLength(2);
  });

  it("deduplicates repeated IDs", async () => {
    const fake = makeFakeAdapter();
    const store = createRequestDetailsStore({
      adapter: fake.adapter,
      env: { OBSERVABILITY_TIMSLITE_DATA_STORE: "true" },
    });
    const p1 = await store.stage({ id: "a" });
    await store.flush();

    await store.getMany([p1.timslite_id, p1.timslite_id, p1.timslite_id]);
    expect(fake.calls.read).toHaveLength(1);
  });

  it("maps missing records to null", async () => {
    const fake = makeFakeAdapter();
    const store = createRequestDetailsStore({
      adapter: fake.adapter,
      env: { OBSERVABILITY_TIMSLITE_DATA_STORE: "true" },
    });
    const result = await store.getMany(["999999"]);
    expect(result.get("999999")).toBeNull();
  });

  it("maps malformed JSON to null", async () => {
    const fake = makeFakeAdapter();
    fake.records.set("999999", "not-json{{{");
    const store = createRequestDetailsStore({
      adapter: fake.adapter,
      env: { OBSERVABILITY_TIMSLITE_DATA_STORE: "true" },
    });
    const result = await store.getMany(["999999"]);
    expect(result.get("999999")).toBeNull();
  });

  it("maps per-record read failures to null without throwing", async () => {
    const fake = makeFakeAdapter();
    const originalOpenDataset = fake.adapter.openStore;
    fake.adapter.openStore = async (dataDir, config) => {
      const store = await originalOpenDataset(dataDir, config);
      const origOpenDataset = store.openDataset.bind(store);
      store.openDataset = async (name, type) => {
        const ds = await origOpenDataset(name, type);
        const origRead = ds.read.bind(ds);
        ds.read = async (timestamp) => {
          if (timestamp === 888888n) throw new Error("read failure");
          return origRead(timestamp);
        };
        return ds;
      };
      return store;
    };
    const store = createRequestDetailsStore({
      adapter: fake.adapter,
      env: { OBSERVABILITY_TIMSLITE_DATA_STORE: "true" },
    });
    const p1 = await store.stage({ id: "ok" });
    await store.flush();

    const result = await store.getMany([p1.timslite_id, "888888"]);
    expect(result.get(p1.timslite_id)).toEqual({ id: "ok" });
    expect(result.get("888888")).toBeNull();
  });

  it("preserves string IDs in the returned Map", async () => {
    const fake = makeFakeAdapter();
    const store = createRequestDetailsStore({
      adapter: fake.adapter,
      env: { OBSERVABILITY_TIMSLITE_DATA_STORE: "true" },
    });
    const p1 = await store.stage({ id: "a" });
    await store.flush();

    const result = await store.getMany([p1.timslite_id]);
    for (const key of result.keys()) {
      expect(typeof key).toBe("string");
    }
  });

  it("returns empty Map for empty input", async () => {
    const fake = makeFakeAdapter();
    const store = createRequestDetailsStore({
      adapter: fake.adapter,
      env: { OBSERVABILITY_TIMSLITE_DATA_STORE: "true" },
    });
    const result = await store.getMany([]);
    expect(result).toBeInstanceOf(Map);
    expect(result.size).toBe(0);
  });

  it("validates decimal IDs and rejects non-decimal strings", async () => {
    const fake = makeFakeAdapter();
    const store = createRequestDetailsStore({
      adapter: fake.adapter,
      env: { OBSERVABILITY_TIMSLITE_DATA_STORE: "true" },
    });
    const result = await store.getMany(["abc", "12.5", "-1", "1e10"]);
    expect(result.get("abc")).toBeNull();
    expect(result.get("12.5")).toBeNull();
    expect(result.get("-1")).toBeNull();
    expect(result.get("1e10")).toBeNull();
  });
});

describe("Idempotent close", () => {
  it("close is idempotent - calling twice closes the dataset once", async () => {
    const fake = makeFakeAdapter();
    const store = createRequestDetailsStore({
      adapter: fake.adapter,
      env: { OBSERVABILITY_TIMSLITE_DATA_STORE: "true" },
    });
    await store.stage({ id: "a" });
    await store.flush();
    await store.close();
    await store.close();
    await store.close();
    expect(fake.calls.close).toBe(2);
  });

  it("close on disabled store is a no-op", async () => {
    const fake = makeFakeAdapter();
    const store = createRequestDetailsStore({ adapter: fake.adapter, env: {} });
    await store.close();
    expect(fake.calls.close).toBe(0);
    expect(fake.calls.storeOpen).toEqual([]);
  });

  it("close does not implicitly flush staged records", async () => {
    const fake = makeFakeAdapter();
    const store = createRequestDetailsStore({
      adapter: fake.adapter,
      env: { OBSERVABILITY_TIMSLITE_DATA_STORE: "true" },
    });
    await store.stage({ id: "a" });
    await store.close();
    expect(fake.calls.write).toHaveLength(0);
    expect(fake.calls.flush).toBe(0);
  });
});

describe("Official Timslite API adapter", () => {
  it("uses Store.open, createDataset, and dataset operations", async () => {
    const fake = makeFakeAdapter();
    const store = createRequestDetailsStore({
      adapter: fake.adapter,
      env: { OBSERVABILITY_TIMSLITE_DATA_STORE: "true" },
    });
    await store.stage({ id: "a" });
    await store.flush();
    expect(fake.calls.storeOpen).toHaveLength(1);
    expect(fake.calls.createDataset).toHaveLength(1);
    expect(fake.calls.write).toHaveLength(1);
    expect(fake.calls.flush).toBe(1);
  });

  it("write uses bigint timestamp and Buffer data", async () => {
    const fake = makeFakeAdapter();
    const store = createRequestDetailsStore({
      adapter: fake.adapter,
      env: { OBSERVABILITY_TIMSLITE_DATA_STORE: "true" },
    });
    await store.stage({ id: "a" });
    await store.flush();
    expect(fake.calls.write[0].timestamp).toEqual(expect.any(BigInt));
    expect(fake.calls.write[0].data).toBeInstanceOf(Buffer);
  });

  it("retentionWindow uses the same seconds-x-100 unit as logical ids", async () => {
    const fake = makeFakeAdapter();
    const store = createRequestDetailsStore({
      adapter: fake.adapter,
      env: { OBSERVABILITY_TIMSLITE_DATA_STORE: "true", OBSERVABILITY_TIMSLITE_RETENTION_DAYS: "1" },
    });
    await store.stage({ id: "a" });
    await store.flush();
    expect(fake.calls.createDataset[0].options.retentionWindow).toBe(8_640_000n);
  });
});

describe("Writable mode and read-only fallback", () => {
  it("writable mode required for writes", async () => {
    const fake = makeFakeAdapter();
    const store = createRequestDetailsStore({
      adapter: fake.adapter,
      env: { OBSERVABILITY_TIMSLITE_DATA_STORE: "true" },
    });
    await store.stage({ id: "a" });
    await store.flush();
    expect(fake.calls.write).toHaveLength(1);
  });

  it("read-only fallback never emits pointers", async () => {
    const fake = makeFakeAdapter();
    const store = createRequestDetailsStore({
      adapter: fake.adapter,
      env: {},
    });
    expect(store.enabled).toBe(false);
    const pointer = await store.stage({ id: "a" });
    expect(pointer).toBeNull();
    await store.flush();
    expect(fake.calls.write).toHaveLength(0);
  });
});

describe("Explicit writable-store semantics", () => {
  it("write initialization passes readOnly: false", async () => {
    const fake = makeFakeAdapter();
    const store = createRequestDetailsStore({
      adapter: fake.adapter,
      env: { OBSERVABILITY_TIMSLITE_DATA_STORE: "true" },
    });
    await store.stage({ id: "a" });
    expect(fake.calls.storeOpen).toHaveLength(1);
    expect(fake.calls.storeOpen[0].config).toMatchObject({ readOnly: false });
  });

  it("stage rejects if returned store is read-only", async () => {
    const fake = makeFakeAdapter({ forceReadOnly: true });
    const store = createRequestDetailsStore({
      adapter: fake.adapter,
      env: { OBSERVABILITY_TIMSLITE_DATA_STORE: "true" },
    });
    await expect(store.stage({ id: "a" })).rejects.toThrow(/read.?only/i);
    expect(fake.calls.write).toHaveLength(0);
  });

  it("stage rejects before ID/pointer creation when store is read-only", async () => {
    const fake = makeFakeAdapter({ forceReadOnly: true });
    const store = createRequestDetailsStore({
      adapter: fake.adapter,
      env: { OBSERVABILITY_TIMSLITE_DATA_STORE: "true" },
    });
    let pointer = "not-called";
    try {
      pointer = await store.stage({ id: "a" });
    } catch (err) {
      expect(err.message).toMatch(/read.?only/i);
    }
    expect(pointer).toBe("not-called");
    expect(fake.calls.write).toHaveLength(0);
  });

  it("read-only hydration passes readOnly: true", async () => {
    const fake = makeFakeAdapter();
    fake.records.set("123456", JSON.stringify({ id: "test" }));
    const store = createRequestDetailsStore({
      adapter: fake.adapter,
      env: {},
    });
    await store.getMany(["123456"]);
    expect(fake.calls.storeOpen).toHaveLength(1);
    expect(fake.calls.storeOpen[0].config).toEqual({ readOnly: true });
  });
});

describe("Latest timestamp recovery", () => {
  it("first write initializes from readLatest() timestamp", async () => {
    const fake = makeFakeAdapter();
    fake.setLatestTimestamp(172_648_000_050n);
    const store = createRequestDetailsStore({
      adapter: fake.adapter,
      env: { OBSERVABILITY_TIMSLITE_DATA_STORE: "true" },
      clock: () => 1_726_480_000_000,
      wait: async () => {},
    });
    const pointer = await store.stage({ id: "a" });
    expect(pointer.timslite_id).toBe("172648000051");
    expect(BigInt(pointer.timslite_id)).toBeGreaterThan(172_648_000_050n);
    expect(fake.calls.readLatest).toBe(1);
  });

  it("allocates strictly larger ID than readLatest()", async () => {
    const fake = makeFakeAdapter();
    fake.setLatestTimestamp(172_648_000_050n);
    const store = createRequestDetailsStore({
      adapter: fake.adapter,
      env: { OBSERVABILITY_TIMSLITE_DATA_STORE: "true" },
      clock: () => 1_726_480_000_000,
      wait: async () => {},
    });
    const p1 = await store.stage({ id: "a" });
    const p2 = await store.stage({ id: "b" });
    expect(BigInt(p2.timslite_id)).toBeGreaterThan(BigInt(p1.timslite_id));
    expect(BigInt(p1.timslite_id)).toBeGreaterThan(172_648_000_050n);
  });
});

describe("Reads work regardless of write flag", () => {
  it("getMany works when writes are disabled", async () => {
    const fake = makeFakeAdapter();
    fake.records.set("123456", JSON.stringify({ id: "test" }));
    const store = createRequestDetailsStore({
      adapter: fake.adapter,
      env: {},
    });
    expect(store.enabled).toBe(false);
    const result = await store.getMany(["123456"]);
    expect(result.get("123456")).toEqual({ id: "test" });
  });
});

describe("Error handling", () => {
  it("package/init failure returns unavailable reads", async () => {
    const fake = makeFakeAdapter();
    fake.adapter.openStore = async () => {
      throw new Error("package not available");
    };
    const store = createRequestDetailsStore({
      adapter: fake.adapter,
      env: { OBSERVABILITY_TIMSLITE_DATA_STORE: "true" },
    });
    const result = await store.getMany(["123"]);
    expect(result.get("123")).toBeNull();
  });

  it("read failure returns null for that record", async () => {
    const fake = makeFakeAdapter();
    const store = createRequestDetailsStore({
      adapter: fake.adapter,
      env: { OBSERVABILITY_TIMSLITE_DATA_STORE: "true" },
    });
    const result = await store.getMany(["999999"]);
    expect(result.get("999999")).toBeNull();
  });

  it("write initialization error propagates", async () => {
    const fake = makeFakeAdapter();
    fake.adapter.openStore = async () => {
      throw new Error("init failed");
    };
    const store = createRequestDetailsStore({
      adapter: fake.adapter,
      env: { OBSERVABILITY_TIMSLITE_DATA_STORE: "true" },
    });
    await expect(store.stage({ id: "a" })).rejects.toThrow("init failed");
  });

  it("flush error propagates", async () => {
    const fake = makeFakeAdapter();
    const originalOpenStore = fake.adapter.openStore.bind(fake.adapter);
    fake.adapter.openStore = async (dataDir, config) => {
      const s = await originalOpenStore(dataDir, config);
      const origOpen = s.openDataset.bind(s);
      s.openDataset = async (name, type) => {
        const ds = await origOpen(name, type);
        ds.flush = async () => { throw new Error("flush failed"); };
        return ds;
      };
      return s;
    };
    const store = createRequestDetailsStore({
      adapter: fake.adapter,
      env: { OBSERVABILITY_TIMSLITE_DATA_STORE: "true" },
    });
    await store.stage({ id: "a" });
    await expect(store.flush()).rejects.toThrow("flush failed");
  });
});

describe("Concurrent initialization", () => {
  it("shares one promise for concurrent flush calls", async () => {
    const fake = makeFakeAdapter();
    const store = createRequestDetailsStore({
      adapter: fake.adapter,
      env: { OBSERVABILITY_TIMSLITE_DATA_STORE: "true" },
    });
    await store.stage({ id: "a" });
    await Promise.all([store.flush(), store.flush(), store.flush()]);
    expect(fake.calls.storeOpen).toHaveLength(1);
  });
});

describe("Staged records removal", () => {
  it("staged records only removed after successful flush", async () => {
    const fake = makeFakeAdapter();
    let flushShouldFail = true;
    const originalOpenStore = fake.adapter.openStore.bind(fake.adapter);
    fake.adapter.openStore = async (dataDir, config) => {
      const s = await originalOpenStore(dataDir, config);
      const origOpen = s.openDataset.bind(s);
      s.openDataset = async (name, type) => {
        const ds = await origOpen(name, type);
        const origFlush = ds.flush.bind(ds);
        ds.flush = async () => {
          if (flushShouldFail) throw new Error("flush failed");
          return origFlush();
        };
        return ds;
      };
      return s;
    };
    const store = createRequestDetailsStore({
      adapter: fake.adapter,
      env: { OBSERVABILITY_TIMSLITE_DATA_STORE: "true" },
    });
    await store.stage({ id: "a" });
    await store.stage({ id: "b" });
    await expect(store.flush()).rejects.toThrow();
    flushShouldFail = false;
    await store.flush();
    expect(fake.calls.write.length).toBeGreaterThanOrEqual(2);
  });
});

describe("Truncation edge cases", () => {
  it("throws RangeError when minimum marker cannot fit", () => {
    const payload = { id: "test" };
    expect(() => truncateUtf8Json(payload, 5)).toThrow(RangeError);
  });

  it("produces valid JSON within budget for oversized non-truncatable metadata", () => {
    const payload = { id: "x".repeat(1000), status: "ok" };
    const result = truncateUtf8Json(payload, 200);
    expect(Buffer.byteLength(result, "utf8")).toBeLessThanOrEqual(200);
    expect(() => JSON.parse(result)).not.toThrow();
  });
});

describe("Timslite writable store flush interval", () => {
  it("opens the writable store with flushIntervalMs defaulting to 15000", async () => {
    const fake = makeFakeAdapter();
    const store = createRequestDetailsStore({
      adapter: fake.adapter,
      env: { OBSERVABILITY_TIMSLITE_DATA_STORE: "true" },
    });
    await store.stage({ id: "flush-default" });
    await store.flush();
    expect(fake.calls.storeOpen).toHaveLength(1);
    expect(fake.calls.storeOpen[0].config).toMatchObject({ readOnly: false, flushIntervalMs: 15000 });
  });

  it("uses a valid seconds override for flushIntervalMs", async () => {
    const fake = makeFakeAdapter();
    const store = createRequestDetailsStore({
      adapter: fake.adapter,
      env: { OBSERVABILITY_TIMSLITE_DATA_STORE: "true", OBSERVABILITY_TIMSLITE_FLUSH_INTERVAL_SECONDS: "30" },
    });
    await store.stage({ id: "flush-override" });
    await store.flush();
    expect(fake.calls.storeOpen[0].config).toMatchObject({ readOnly: false, flushIntervalMs: 30000 });
  });

  it.each([undefined, "", "0", "-1", "1.5", "abc", "30s", "NaN"])(
    "falls back to the 15000ms default for invalid flush interval %j",
    async (value) => {
      const fake = makeFakeAdapter();
      const env = { OBSERVABILITY_TIMSLITE_DATA_STORE: "true" };
      if (value !== undefined) env.OBSERVABILITY_TIMSLITE_FLUSH_INTERVAL_SECONDS = value;
      const store = createRequestDetailsStore({ adapter: fake.adapter, env });
      await store.stage({ id: "flush-invalid" });
      await store.flush();
      expect(fake.calls.storeOpen[0].config).toMatchObject({ readOnly: false, flushIntervalMs: 15000 });
    }
  );
});

describe("Message deduplication — refs and local reuse", () => {
  beforeEach(() => _resetGlobalValueCache());
  const sharedMessage = { role: "user", content: "hello" };

  it("replaces request.messages items with strict index refs backed by an ordered __values__ array", async () => {
    const fake = makeFakeAdapter();
    const store = createRequestDetailsStore({
      adapter: fake.adapter,
      env: { OBSERVABILITY_TIMSLITE_DATA_STORE: "true" },
    });
    await store.stage({ id: "a", request: { messages: [sharedMessage] } });
    await store.flush();

    const written = JSON.parse(fake.records.get(fake.calls.write[0].timestamp.toString()));
    expect(written.request.messages).toEqual(["#/0/0"]);
    expect(written.request.messages[0]).toMatch(TIMSLITE_VALUE_REF_PATTERN);
    expect(Array.isArray(written.__values__)).toBe(true);
    expect(written.__values__).toEqual([sharedMessage]);
  });

  it("reuses one __values__ index for duplicate messages within a record (local ref)", async () => {
    const fake = makeFakeAdapter();
    const store = createRequestDetailsStore({
      adapter: fake.adapter,
      env: { OBSERVABILITY_TIMSLITE_DATA_STORE: "true" },
    });
    await store.stage({ id: "a", request: { messages: [sharedMessage, structuredClone(sharedMessage)] } });
    await store.flush();

    const written = JSON.parse(fake.records.get(fake.calls.write[0].timestamp.toString()));
    expect(written.request.messages).toEqual(["#/0/0", "#/0/0"]);
    expect(written.__values__).toEqual([sharedMessage]);
  });

  it("establishes array index order from first new values encountered", async () => {
    const fake = makeFakeAdapter();
    const store = createRequestDetailsStore({
      adapter: fake.adapter,
      env: { OBSERVABILITY_TIMSLITE_DATA_STORE: "true" },
    });
    const first = { role: "user", content: "first" };
    const second = { role: "assistant", content: "second" };
    await store.stage({
      id: "a",
      request: { messages: [first, second, structuredClone(first)] },
    });
    await store.flush();

    const written = JSON.parse(fake.records.get(fake.calls.write[0].timestamp.toString()));
    expect(written.request.messages).toEqual(["#/0/0", "#/0/1", "#/0/0"]);
    expect(written.__values__).toEqual([first, second]);
  });

  it("deduplicates request and providerRequest messages independently", async () => {
    const fake = makeFakeAdapter();
    const store = createRequestDetailsStore({
      adapter: fake.adapter,
      env: { OBSERVABILITY_TIMSLITE_DATA_STORE: "true" },
    });
    const providerMessage = { role: "system", content: "sys" };
    await store.stage({
      id: "a",
      request: { messages: [sharedMessage] },
      providerRequest: { messages: [providerMessage, structuredClone(sharedMessage)] },
    });
    await store.flush();

    const written = JSON.parse(fake.records.get(fake.calls.write[0].timestamp.toString()));
    expect(written.request.messages).toEqual(["#/0/0"]);
    expect(written.providerRequest.messages[0]).toBe("#/0/1");
    expect(written.providerRequest.messages[1]).toBe("#/0/0");
    // sharedMessage established index 0 first (request), providerMessage index 1.
    expect(written.__values__).toEqual([sharedMessage, providerMessage]);
  });

  it("leaves non-message request fields untouched", async () => {
    const fake = makeFakeAdapter();
    const store = createRequestDetailsStore({
      adapter: fake.adapter,
      env: { OBSERVABILITY_TIMSLITE_DATA_STORE: "true" },
    });
    await store.stage({ id: "a", request: { messages: [sharedMessage], body: "raw" }, response: { messages: [sharedMessage] } });
    await store.flush();

    const written = JSON.parse(fake.records.get(fake.calls.write[0].timestamp.toString()));
    expect(written.request.body).toBe("raw");
    expect(written.response.messages).toEqual([sharedMessage]);
  });
});

describe("Message deduplication — cross-record reuse", () => {
  beforeEach(() => _resetGlobalValueCache());
  const sharedMessage = { role: "user", content: "shared" };

  it("reuses a value from an earlier record via cross-record ref in the same flush batch", async () => {
    const fake = makeFakeAdapter();
    const store = createRequestDetailsStore({
      adapter: fake.adapter,
      env: { OBSERVABILITY_TIMSLITE_DATA_STORE: "true" },
    });
    await store.stage({ id: "a", request: { messages: [sharedMessage] } });
    await store.stage({ id: "b", request: { messages: [structuredClone(sharedMessage)] } });
    await store.flush();

    const firstId = fake.calls.write[0].timestamp.toString();
    const first = JSON.parse(fake.records.get(firstId));
    const second = JSON.parse(fake.records.get(fake.calls.write[1].timestamp.toString()));
    expect(first.request.messages).toEqual(["#/0/0"]);
    expect(first.__values__).toEqual([sharedMessage]);
    expect(second.request.messages).toEqual([`#/${firstId}/0`]);
    expect(second.__values__).toBeUndefined();
  });

  it("reuses a value across separate flushes via cross-record cache", async () => {
    const fake = makeFakeAdapter();
    const store = createRequestDetailsStore({
      adapter: fake.adapter,
      env: { OBSERVABILITY_TIMSLITE_DATA_STORE: "true" },
    });
    await store.stage({ id: "a", request: { messages: [sharedMessage] } });
    await store.flush();
    const firstId = fake.calls.write[0].timestamp.toString();

    await store.stage({ id: "b", request: { messages: [structuredClone(sharedMessage)] } });
    await store.flush();

    expect(fake.calls.write).toHaveLength(2);
    const second = JSON.parse(fake.records.get(fake.calls.write[1].timestamp.toString()));
    expect(second.request.messages).toEqual([`#/${firstId}/0`]);
    expect(second.__values__).toBeUndefined();
  });

  it("emits a ref only after the source record write succeeds", async () => {
    const fake = makeFakeAdapter();
    const store = createRequestDetailsStore({
      adapter: fake.adapter,
      env: { OBSERVABILITY_TIMSLITE_DATA_STORE: "true" },
    });
    await store.stage({ id: "a", request: { messages: [sharedMessage] } });
    await store.flush();
    expect(fake.calls.write).toHaveLength(1);
  });

  it("resolves cross-record refs in a record with no local __values__", async () => {
    const fake = makeFakeAdapter();
    const store = createRequestDetailsStore({
      adapter: fake.adapter,
      env: { OBSERVABILITY_TIMSLITE_DATA_STORE: "true" },
    });
    const msg1 = { role: "user", content: "first" };
    const msg2 = { role: "user", content: "second" };
    const msg3 = { role: "assistant", content: "third" };

    // Record A: two distinct messages, both stored locally
    await store.stage({ id: "a", request: { messages: [msg1, msg2] } });
    await store.flush();
    const idA = fake.calls.write[0].timestamp.toString();

    // Record B: all three messages are cross-record refs (msg1, msg2 from A, msg3 novel)
    // msg3 will be stored locally in B since it is novel
    await store.stage({ id: "b", request: { messages: [structuredClone(msg1), structuredClone(msg2), msg3] } });
    await store.flush();
    const idB = fake.calls.write[1].timestamp.toString();

    // Record A stored msg1 at index 0 and msg2 at index 1, so cross-record
    // refs into A carry those indices; msg3 is novel and lands locally at 0.
    const writtenB = JSON.parse(fake.records.get(idB));
    expect(writtenB.request.messages[0]).toBe(`#/${idA}/0`);
    expect(writtenB.request.messages[1]).toBe(`#/${idA}/1`);
    expect(writtenB.request.messages[2]).toBe("#/0/0");
    expect(writtenB.__values__).toEqual([msg3]);

    // getMany must fully restore all three messages in record B
    const result = await store.getMany([idB]);
    expect(result.get(idB)).toEqual({
      id: "b",
      request: { messages: [msg1, msg2, msg3] },
    });
    expect(result.get(idB).__values__).toBeUndefined();
  });
});

describe("Message deduplication — transparent read resolution", () => {
  beforeEach(() => _resetGlobalValueCache());
  const sharedMessage = { role: "user", content: "roundtrip" };

  it("rehydrates refs in getMany and strips __values__", async () => {
    const fake = makeFakeAdapter();
    const store = createRequestDetailsStore({
      adapter: fake.adapter,
      env: { OBSERVABILITY_TIMSLITE_DATA_STORE: "true" },
    });
    const pointer = await store.stage({ id: "a", request: { messages: [sharedMessage] } });
    await store.flush();

    const result = await store.getMany([pointer.timslite_id]);
    expect(result.get(pointer.timslite_id)).toEqual({ id: "a", request: { messages: [sharedMessage] } });
    expect(result.get(pointer.timslite_id).__values__).toBeUndefined();
  });

  it("returns parsed compact records untouched when resolveValues is false", async () => {
    const fake = makeFakeAdapter();
    const store = createRequestDetailsStore({
      adapter: fake.adapter,
      env: { OBSERVABILITY_TIMSLITE_DATA_STORE: "true" },
    });
    const pointer = await store.stage({ id: "a", request: { messages: [sharedMessage] } });
    await store.flush();
    const id = pointer.timslite_id;

    const result = await store.getMany([id], { resolveValues: false });

    // Compact record returned verbatim: strict refs intact, protocol array kept.
    expect(result.get(id)).toEqual({
      id: "a",
      request: { messages: ["#/0/0"] },
      __values__: [sharedMessage],
    });
  });

  it("does not perform cross-record reads when resolveValues is false", async () => {
    const fake = makeFakeAdapter();
    const store = createRequestDetailsStore({
      adapter: fake.adapter,
      env: { OBSERVABILITY_TIMSLITE_DATA_STORE: "true" },
    });
    await store.stage({ id: "a", request: { messages: [sharedMessage] } });
    await store.flush();
    const idA = fake.calls.write[0].timestamp.toString();

    // Record B holds only a cross-record ref into A.
    await store.stage({ id: "b", request: { messages: [structuredClone(sharedMessage)] } });
    await store.flush();
    const idB = fake.calls.write[1].timestamp.toString();

    const readsBefore = fake.calls.read.length;
    const result = await store.getMany([idB], { resolveValues: false });

    // Exactly one point read for the requested record, no read of source record A.
    expect(fake.calls.read.length).toBe(readsBefore + 1);
    expect(fake.calls.read[fake.calls.read.length - 1]).toBe(BigInt(idB));
    expect(result.get(idB).request.messages).toEqual([`#/${idA}/0`]);
    expect(result.get(idB).__values__).toBeUndefined();
  });

  it("defaults to hydrating when the options object is omitted", async () => {
    const fake = makeFakeAdapter();
    const store = createRequestDetailsStore({
      adapter: fake.adapter,
      env: { OBSERVABILITY_TIMSLITE_DATA_STORE: "true" },
    });
    const pointer = await store.stage({ id: "a", request: { messages: [sharedMessage] } });
    await store.flush();

    const result = await store.getMany([pointer.timslite_id]);
    expect(result.get(pointer.timslite_id)).toEqual({ id: "a", request: { messages: [sharedMessage] } });
    expect(result.get(pointer.timslite_id).__values__).toBeUndefined();
  });

  it("rehydrates cross-record refs across a batch read", async () => {
    const fake = makeFakeAdapter();
    const store = createRequestDetailsStore({
      adapter: fake.adapter,
      env: { OBSERVABILITY_TIMSLITE_DATA_STORE: "true" },
    });
    const p1 = await store.stage({ id: "a", request: { messages: [sharedMessage] } });
    const p2 = await store.stage({ id: "b", request: { messages: [structuredClone(sharedMessage), { role: "assistant", content: "hi" }] } });
    await store.flush();

    const result = await store.getMany([p1.timslite_id, p2.timslite_id]);
    expect(result.get(p1.timslite_id)).toEqual({ id: "a", request: { messages: [sharedMessage] } });
    expect(result.get(p2.timslite_id)).toEqual({
      id: "b",
      request: { messages: [sharedMessage, { role: "assistant", content: "hi" }] },
    });
  });

  it("passes records without refs through unchanged", async () => {
    const fake = makeFakeAdapter();
    const store = createRequestDetailsStore({
      adapter: fake.adapter,
      env: { OBSERVABILITY_TIMSLITE_DATA_STORE: "true" },
    });
    const pointer = await store.stage({ id: "plain", request: { body: "no messages" } });
    await store.flush();

    const result = await store.getMany([pointer.timslite_id]);
    expect(result.get(pointer.timslite_id)).toEqual({ id: "plain", request: { body: "no messages" } });
  });

  it("leaves a ref with an out-of-range index unresolved and keeps the unconsumed protocol array", async () => {
    const fake = makeFakeAdapter();
    const record = { id: "corrupt", request: { messages: ["#/0/99"] }, __values__: [] };
    fake.records.set("123456", JSON.stringify(record));
    const store = createRequestDetailsStore({ adapter: fake.adapter, env: {} });

    const result = await store.getMany(["123456"]);
    expect(result.get("123456").request.messages).toEqual(["#/0/99"]);
    expect(result.get("123456").__values__).toEqual([]);
  });

  it("rejects non-strict ref forms", () => {
    expect(TIMSLITE_VALUE_REF_PATTERN.test("#/0/0")).toBe(true);
    expect(TIMSLITE_VALUE_REF_PATTERN.test("#/12/345")).toBe(true);
    expect(TIMSLITE_VALUE_REF_PATTERN.test("#/00/0")).toBe(false);
    expect(TIMSLITE_VALUE_REF_PATTERN.test("#/0/00")).toBe(false);
    expect(TIMSLITE_VALUE_REF_PATTERN.test("#/0/-1")).toBe(false);
    expect(TIMSLITE_VALUE_REF_PATTERN.test("#/0/1.5")).toBe(false);
    expect(TIMSLITE_VALUE_REF_PATTERN.test(`#/0/${"a".repeat(64)}`)).toBe(false);
    expect(TIMSLITE_VALUE_REF_PATTERN.test("ordinary string")).toBe(false);
    expect(TIMSLITE_VALUE_REF_PATTERN.test("x#/1/2")).toBe(false);
  });
});

describe("Cross-record cache — TTL and LRU bounds", () => {
  beforeEach(() => _resetGlobalValueCache());
  const HOUR_US = 60n * 60n * 1_000_000n;

  it("is capped at 48h and disabled when the budget is non-positive", () => {
    const sevenDays = 7n * 24n * HOUR_US;
    expect(computeCrossRecordTtlMicroseconds(sevenDays)).toBe(48n * HOUR_US);
    expect(computeCrossRecordTtlMicroseconds(24n * HOUR_US)).toBe(23n * HOUR_US);
    expect(computeCrossRecordTtlMicroseconds(HOUR_US)).toBe(0n);
    expect(computeCrossRecordTtlMicroseconds(0n)).toBe(0n);
  });

  it("expires entries once the retention-minus-safety window elapses", () => {
    let nowMs = 1_000_000;
    const cache = createValueCache({ ttlMicroseconds: 48n * HOUR_US, clock: () => nowMs });
    const sha = "a".repeat(64);
    cache.setRef(sha, "#/100000/0");
    expect(cache.getRef(sha)).toBe("#/100000/0");

    nowMs += Number(47n * HOUR_US / 1000n);
    expect(cache.getRef(sha)).toBe("#/100000/0");

    nowMs += Number(2n * HOUR_US / 1000n);
    expect(cache.getRef(sha)).toBeUndefined();
  });

  it("is disabled for a non-positive TTL", () => {
    const cache = createValueCache({ ttlMicroseconds: 0n });
    cache.setRef("a".repeat(64), "#/100000/0");
    expect(cache.getRef("a".repeat(64))).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it("evicts the least recently used entry past the 2048 bound", () => {
    const cache = createValueCache({ maxEntries: 2, ttlMicroseconds: 48n * HOUR_US });
    cache.setRef("a".repeat(64), "#/1/0");
    cache.setRef("b".repeat(64), "#/2/0");
    expect(cache.getRef("a".repeat(64))).toBe("#/1/0");
    cache.setRef("c".repeat(64), "#/3/0");

    expect(cache.size).toBe(2);
    expect(cache.getRef("b".repeat(64))).toBeUndefined();
    expect(cache.getRef("a".repeat(64))).toBe("#/1/0");
    expect(cache.getRef("c".repeat(64))).toBe("#/3/0");
  });

  it("defaults the cache bound to 2048 entries", () => {
    expect(TIMSLITE_VALUE_CACHE_MAX_ENTRIES).toBe(2048);
    const cache = createValueCache({ ttlMicroseconds: 48n * HOUR_US });
    for (let i = 0; i < 2048; i += 1) cache.setRef(i.toString(16).padStart(64, "0"), `#/${i}/0`);
    expect(cache.size).toBe(2048);
    cache.setRef("f".repeat(64), "#/99/0");
    expect(cache.size).toBe(2048);
  });
});

describe("Global value cache — cross-instance reuse", () => {
  const HOUR_US = 60n * 60n * 1_000_000n;

  it("values written by one store instance are visible to a later instance", () => {
    _resetGlobalValueCache();
    const sha = "a".repeat(64);
    const nowMs = 1_000_000;

    const cache1 = createValueCache({ ttlMicroseconds: 48n * HOUR_US, clock: () => nowMs });
    cache1.setRef(sha, "#/100/0", BigInt(nowMs) * 1000n);

    // Simulate a new store instance opening later
    const laterMs = nowMs + 1000;
    const cache2 = createValueCache({ ttlMicroseconds: 48n * HOUR_US, clock: () => laterMs });
    expect(cache2.getRef(sha)).toBe("#/100/0");

    _resetGlobalValueCache();
  });

  it("shorter TTL in later instance correctly expires an entry", () => {
    _resetGlobalValueCache();
    const sha = "b".repeat(64);
    const nowMs = 1_000_000;

    // First instance writes with 48h TTL
    const cache1 = createValueCache({ ttlMicroseconds: 48n * HOUR_US, clock: () => nowMs });
    cache1.setRef(sha, "#/200/0", BigInt(nowMs) * 1000n);

    // Second instance has only 1h TTL; entry written 2h ago is expired
    const twoHoursLaterMs = nowMs + Number(2n * HOUR_US / 1000n);
    const cache2 = createValueCache({ ttlMicroseconds: 1n * HOUR_US, clock: () => twoHoursLaterMs });
    expect(cache2.getRef(sha)).toBeUndefined();

    _resetGlobalValueCache();
  });

  it("second store emits cross-record ref for SHA written by first store", async () => {
    _resetGlobalValueCache();
    const fake = makeFakeAdapter();
    const sharedMessage = { role: "user", content: "cross-instance" };

    // First store writes record A with the message
    const store1 = createRequestDetailsStore({
      adapter: fake.adapter,
      env: { OBSERVABILITY_TIMSLITE_DATA_STORE: "true" },
    });
    await store1.stage({ id: "a", request: { messages: [sharedMessage] } });
    await store1.flush();
    const idA = fake.calls.write[0].timestamp.toString();

    // Second store (new instance, same process) stages the same message
    const store2 = createRequestDetailsStore({
      adapter: fake.adapter,
      env: { OBSERVABILITY_TIMSLITE_DATA_STORE: "true" },
    });
    await store2.stage({ id: "b", request: { messages: [structuredClone(sharedMessage)] } });
    await store2.flush();

    // Record B should have a cross-record ref to A, not a local entry
    const writtenB = JSON.parse(fake.records.get(fake.calls.write[1].timestamp.toString()));
    expect(writtenB.request.messages).toEqual([`#/${idA}/0`]);
    expect(writtenB.__values__).toBeUndefined();

    // getMany must still fully restore the message
    const result = await store2.getMany([fake.calls.write[1].timestamp.toString()]);
    expect(result.get(fake.calls.write[1].timestamp.toString())).toEqual({
      id: "b",
      request: { messages: [sharedMessage] },
    });

    _resetGlobalValueCache();
  });
});

describe("Message deduplication — oversized fallback and fail-open", () => {
  beforeEach(() => _resetGlobalValueCache());
  it("falls back to truncating the original (no refs) when the compressed JSON exceeds the safe size", async () => {
    const fake = makeFakeAdapter();
    const bigMessage = { role: "user", content: "x".repeat(TIMSLITE_RECORD_MAX_BYTES) };
    const store = createRequestDetailsStore({
      adapter: fake.adapter,
      env: { OBSERVABILITY_TIMSLITE_DATA_STORE: "true" },
    });
    await store.stage({ id: "big", request: { messages: [bigMessage] } });
    await store.flush();

    const stored = fake.calls.write[0].data;
    expect(stored.byteLength).toBeLessThanOrEqual(TIMSLITE_RECORD_SAFE_BYTES);
    const parsed = JSON.parse(stored.toString("utf8"));
    expect(parsed.__truncated).toBe(true);
    expect(parsed.__values__).toBeUndefined();
  });

  it("does not commit cache entries for an oversized fallback record", async () => {
    const fake = makeFakeAdapter();
    const bigMessage = { role: "user", content: "x".repeat(TIMSLITE_RECORD_MAX_BYTES) };
    const store = createRequestDetailsStore({
      adapter: fake.adapter,
      env: { OBSERVABILITY_TIMSLITE_DATA_STORE: "true" },
    });
    await store.stage({ id: "big", request: { messages: [bigMessage] } });
    await store.flush();
    await store.stage({ id: "after", request: { messages: [bigMessage] } });
    await store.flush();

    const second = JSON.parse(fake.records.get(fake.calls.write[1].timestamp.toString()));
    expect(second.__truncated).toBe(true);
    expect(second.request.messages).toBeUndefined();
  });

  it("is JSON parseable and rehydrates round-trip for a compressed record", async () => {
    const fake = makeFakeAdapter();
    const store = createRequestDetailsStore({
      adapter: fake.adapter,
      env: { OBSERVABILITY_TIMSLITE_DATA_STORE: "true" },
    });
    const messages = Array.from({ length: 50 }, (_, i) => ({ role: "user", content: `m${i}` }));
    const pointer = await store.stage({ id: "roundtrip", providerRequest: { messages } });
    await store.flush();

    const result = await store.getMany([pointer.timslite_id]);
    expect(result.get(pointer.timslite_id).providerRequest.messages).toEqual(messages);
  });
});

describe("Deduplication protocol — generalized to tools arrays", () => {
  beforeEach(() => _resetGlobalValueCache());

  const okEnv = { OBSERVABILITY_TIMSLITE_DATA_STORE: "true" };
  const userMessage = { role: "user", content: "hi" };
  const sharedTool = {
    type: "function",
    function: {
      name: "get_weather",
      description: "Get the weather for a city",
      parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
    },
  };

  it("deduplicates a tools item alongside a message in the same request record", async () => {
    const fake = makeFakeAdapter();
    const store = createRequestDetailsStore({ adapter: fake.adapter, env: okEnv });

    await store.stage({
      id: "a",
      request: { model: "gpt-4", messages: [userMessage], tools: [structuredClone(sharedTool)] },
      providerRequest: { model: "gpt-4", messages: [structuredClone(userMessage)], tools: [structuredClone(sharedTool)] },
    });
    await store.flush();

    const written = JSON.parse(fake.records.get(fake.calls.write[0].timestamp.toString()));

    expect(written.request.messages).toEqual(["#/0/0"]);
    expect(written.request.tools).toBe("#/0/1");
    expect(written.providerRequest.messages).toEqual(["#/0/0"]);
    expect(written.providerRequest.tools).toBe("#/0/1");
    expect(written.__values__).toEqual([userMessage, [sharedTool]]);
  });

  it("restores a locally deduplicated tools item and message on read with no refs leaked", async () => {
    const fake = makeFakeAdapter();
    const store = createRequestDetailsStore({ adapter: fake.adapter, env: okEnv });

    const pointer = await store.stage({
      id: "a",
      request: { messages: [userMessage], tools: [structuredClone(sharedTool)] },
    });
    await store.flush();

    const result = await store.getMany([pointer.timslite_id]);
    const detail = result.get(pointer.timslite_id);

    expect(detail).toEqual({ id: "a", request: { messages: [userMessage], tools: [sharedTool] } });
    expect(detail.request.messages).toEqual([userMessage]);
    expect(detail.request.tools).toEqual([sharedTool]);
    expect(JSON.stringify(detail)).not.toContain("#/0/");
    expect(detail.__values__).toBeUndefined();
    expect(detail.request.__values__).toBeUndefined();
  });

  it("restores a locally deduplicated tools item that appears only in providerRequest", async () => {
    const fake = makeFakeAdapter();
    const store = createRequestDetailsStore({ adapter: fake.adapter, env: okEnv });

    const pointer = await store.stage({
      id: "a",
      request: { body: "no tools here" },
      providerRequest: { messages: [structuredClone(userMessage)], tools: [structuredClone(sharedTool)] },
    });
    await store.flush();

    const result = await store.getMany([pointer.timslite_id]);
    expect(result.get(pointer.timslite_id)).toEqual({
      id: "a",
      request: { body: "no tools here" },
      providerRequest: { messages: [userMessage], tools: [sharedTool] },
    });
  });

  it("restores a cross-record tools item in the same read batch", async () => {
    const fake = makeFakeAdapter();
    const store = createRequestDetailsStore({ adapter: fake.adapter, env: okEnv });

    await store.stage({ id: "a", request: { messages: [userMessage], tools: [structuredClone(sharedTool)] } });
    await store.flush();
    const idA = fake.calls.write[0].timestamp.toString();

    const pointerB = await store.stage({ id: "b", request: { messages: [structuredClone(userMessage)], tools: [structuredClone(sharedTool)] } });
    await store.flush();

    // Record A stored userMessage at index 0 and the tools array at index 1.
    const writtenB = JSON.parse(fake.records.get(fake.calls.write[1].timestamp.toString()));
    expect(writtenB.request.tools).toBe(`#/${idA}/1`);

    const result = await store.getMany([pointerB.timslite_id]);
    const detail = result.get(pointerB.timslite_id);
    expect(detail).toEqual({ id: "b", request: { messages: [userMessage], tools: [sharedTool] } });
    expect(JSON.stringify(detail)).not.toContain(`#/${idA}/`);
  });

  it("does not touch a tools-like field outside request/providerRequest", async () => {
    const fake = makeFakeAdapter();
    const store = createRequestDetailsStore({ adapter: fake.adapter, env: okEnv });

    await store.stage({
      id: "a",
      request: { tools: [structuredClone(sharedTool)] },
      response: { tools: [structuredClone(sharedTool)] },
    });
    await store.flush();

    const written = JSON.parse(fake.records.get(fake.calls.write[0].timestamp.toString()));
    expect(written.response.tools).toEqual([sharedTool]);
  });

  it("keeps a non-array tools field untouched (fail open)", async () => {
    const fake = makeFakeAdapter();
    const store = createRequestDetailsStore({ adapter: fake.adapter, env: okEnv });

    await store.stage({ id: "a", request: { messages: [userMessage], tools: "not-an-array" } });
    await store.flush();

    const written = JSON.parse(fake.records.get(fake.calls.write[0].timestamp.toString()));
    expect(written.request.tools).toBe("not-an-array");
    expect(written.request.messages).toEqual(["#/0/0"]);
  });
});

describe("Deduplication protocol — __values__ collision hardening", () => {
  beforeEach(() => _resetGlobalValueCache());

  const okEnv = { OBSERVABILITY_TIMSLITE_DATA_STORE: "true" };

  it("does not leak local refs when the payload already contains a top-level __values__ field", async () => {
    const fake = makeFakeAdapter();
    const store = createRequestDetailsStore({ adapter: fake.adapter, env: okEnv });
    const message = { role: "user", content: "collision" };

    const pointer = await store.stage({
      id: "a",
      request: { messages: [message] },
      __values__: { user: "pre-existing" },
    });
    await store.flush();

    const result = await store.getMany([pointer.timslite_id]);
    const detail = result.get(pointer.timslite_id);

    expect(detail.request.messages).toEqual([message]);
    expect(JSON.stringify(detail)).not.toContain("#/0/");
    expect(detail.__values__).toEqual({ user: "pre-existing" });
  });

  it("resolves local refs against the protocol value array even when the payload shadows __values__", async () => {
    const fake = makeFakeAdapter();
    fake.records.set(
      "1789000000000000",
      JSON.stringify({ id: "a", request: { messages: ["#/0/0"] }, __values__: [] }),
    );
    const store = createRequestDetailsStore({ adapter: fake.adapter, env: {} });

    const result = await store.getMany(["1789000000000000"]);
    const detail = result.get("1789000000000000");
    // An empty protocol array has no index 0, so the ref stays unresolved.
    expect(detail.request.messages).toEqual(["#/0/0"]);
    expect(detail.__values__).toEqual([]);
  });

  it("restores local refs and drops only the protocol array, preserving other record fields", async () => {
    const fake = makeFakeAdapter();
    const store = createRequestDetailsStore({ adapter: fake.adapter, env: okEnv });
    const message = { role: "assistant", content: "kept" };

    const pointer = await store.stage({ id: "a", provider: "openai", request: { messages: [message] } });
    await store.flush();

    const result = await store.getMany([pointer.timslite_id]);
    const detail = result.get(pointer.timslite_id);
    expect(detail).toEqual({ id: "a", provider: "openai", request: { messages: [message] } });
    expect(detail.__values__).toBeUndefined();
  });
});

describe("Deduplication protocol — existing ref pass-through", () => {
  beforeEach(() => _resetGlobalValueCache());

  const okEnv = { OBSERVABILITY_TIMSLITE_DATA_STORE: "true" };

  it("preserves strict ref strings in messages without re-hashing", async () => {
    const fake = makeFakeAdapter();
    const store = createRequestDetailsStore({ adapter: fake.adapter, env: okEnv });

    const existingLocalRef = "#/0/7";
    const existingCrossRef = "#/1789877312712000/3";

    await store.stage({
      id: "nested-ref",
      request: { messages: [existingLocalRef, existingCrossRef] },
      providerRequest: { messages: [existingLocalRef, existingCrossRef] },
    });
    await store.flush();

    const written = JSON.parse(fake.records.get(fake.calls.write[0].timestamp.toString()));
    expect(written.request.messages).toEqual([existingLocalRef, existingCrossRef]);
    expect(written.providerRequest.messages).toEqual([existingLocalRef, existingCrossRef]);
    expect(written.__values__).toBeUndefined();
  });

  it("preserves strict ref strings in tools without re-hashing", async () => {
    const fake = makeFakeAdapter();
    const store = createRequestDetailsStore({ adapter: fake.adapter, env: okEnv });

    const existingRef = "#/0/9";

    await store.stage({
      id: "nested-tool-ref",
      request: { tools: existingRef },
      providerRequest: { tools: existingRef },
    });
    await store.flush();

    const written = JSON.parse(fake.records.get(fake.calls.write[0].timestamp.toString()));
    expect(written.request.tools).toBe(existingRef);
    expect(written.providerRequest.tools).toBe(existingRef);
    expect(written.__values__).toBeUndefined();
  });

  it("mixes existing refs with fresh items — only fresh items get hashed", async () => {
    const fake = makeFakeAdapter();
    const store = createRequestDetailsStore({ adapter: fake.adapter, env: okEnv });

    const freshMessage = { role: "user", content: "new" };
    const existingRef = "#/0/5";

    await store.stage({
      id: "mixed",
      request: { messages: [existingRef, freshMessage] },
    });
    await store.flush();

    const written = JSON.parse(fake.records.get(fake.calls.write[0].timestamp.toString()));
    expect(written.request.messages[0]).toBe(existingRef);
    expect(written.request.messages[1]).toBe("#/0/0");
    expect(written.__values__).toEqual([freshMessage]);
  });

  it("does not create __values__ entries for existing ref strings", async () => {
    const fake = makeFakeAdapter();
    const store = createRequestDetailsStore({ adapter: fake.adapter, env: okEnv });

    const existingRef = "#/1789877312712000/4";

    await store.stage({
      id: "no-values",
      request: { messages: [existingRef] },
      providerRequest: { messages: [existingRef] },
    });
    await store.flush();

    const written = JSON.parse(fake.records.get(fake.calls.write[0].timestamp.toString()));
    expect(written.__values__).toBeUndefined();
    expect(written.request.messages).toEqual([existingRef]);
    expect(written.providerRequest.messages).toEqual([existingRef]);
  });
});

describe("Deduplication protocol — tools whole-array compression", () => {
  beforeEach(() => _resetGlobalValueCache());

  const okEnv = { OBSERVABILITY_TIMSLITE_DATA_STORE: "true" };
  const userMessage = { role: "user", content: "hi" };
  const toolsArray = [
    {
      type: "function",
      function: {
        name: "get_weather",
        description: "Get the weather for a city",
        parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
      },
    },
    {
      type: "function",
      function: {
        name: "get_time",
        description: "Get the current time",
        parameters: { type: "object", properties: { timezone: { type: "string" } } },
      },
    },
  ];

  it("serializes tools as a single #/0/{index} string with the full array in __values__", async () => {
    const fake = makeFakeAdapter();
    const store = createRequestDetailsStore({ adapter: fake.adapter, env: okEnv });

    await store.stage({
      id: "a",
      request: { model: "gpt-4", messages: [userMessage], tools: structuredClone(toolsArray) },
    });
    await store.flush();

    const written = JSON.parse(fake.records.get(fake.calls.write[0].timestamp.toString()));

    // tools: single ref string, NOT an array of refs
    expect(typeof written.request.tools).toBe("string");
    expect(written.request.tools).toBe("#/0/1");
    // messages: still per-item
    expect(written.request.messages).toEqual(["#/0/0"]);
    // __values__ holds both values in first-seen order
    expect(written.__values__).toEqual([userMessage, toolsArray]);
  });

  it("restores the full tools array on getMany read with no refs leaked", async () => {
    const fake = makeFakeAdapter();
    const store = createRequestDetailsStore({ adapter: fake.adapter, env: okEnv });

    const pointer = await store.stage({
      id: "a",
      request: { messages: [userMessage], tools: structuredClone(toolsArray) },
    });
    await store.flush();

    const result = await store.getMany([pointer.timslite_id]);
    const detail = result.get(pointer.timslite_id);

    expect(detail.request.tools).toEqual(toolsArray);
    expect(detail.request.messages).toEqual([userMessage]);
    expect(JSON.stringify(detail)).not.toContain("#/0/");
    expect(detail.__values__).toBeUndefined();
  });

  it("uses cross-record ref for tools when same array was previously written", async () => {
    const fake = makeFakeAdapter();
    const store = createRequestDetailsStore({ adapter: fake.adapter, env: okEnv });

    await store.stage({ id: "a", request: { tools: structuredClone(toolsArray) } });
    await store.flush();
    const idA = fake.calls.write[0].timestamp.toString();

    const pointerB = await store.stage({ id: "b", request: { tools: structuredClone(toolsArray) } });
    await store.flush();

    // Record A holds only the tools array, so it is local index 0 and the
    // cross-record ref into A must carry that same index.
    const writtenB = JSON.parse(fake.records.get(fake.calls.write[1].timestamp.toString()));
    expect(writtenB.request.tools).toBe(`#/${idA}/0`);
    expect(writtenB.__values__).toBeUndefined();

    const result = await store.getMany([pointerB.timslite_id]);
    const detail = result.get(pointerB.timslite_id);
    expect(detail.request.tools).toEqual(toolsArray);
    expect(JSON.stringify(detail)).not.toContain(`#/${idA}/`);
  });

  it("deduplicates tools and messages independently — distinct array indices", async () => {
    const fake = makeFakeAdapter();
    const store = createRequestDetailsStore({ adapter: fake.adapter, env: okEnv });

    await store.stage({
      id: "a",
      request: {
        messages: [userMessage],
        tools: structuredClone(toolsArray),
      },
      providerRequest: {
        messages: [structuredClone(userMessage)],
        tools: structuredClone(toolsArray),
      },
    });
    await store.flush();

    const written = JSON.parse(fake.records.get(fake.calls.write[0].timestamp.toString()));
    expect(written.request.tools).toBe("#/0/1");
    expect(written.providerRequest.tools).toBe("#/0/1");
    expect(written.request.messages).toEqual(["#/0/0"]);
    expect(written.providerRequest.messages).toEqual(["#/0/0"]);
    expect(written.__values__).toEqual([userMessage, toolsArray]);
  });

  it("preserves a strict ref string in tools position without re-hashing", async () => {
    const fake = makeFakeAdapter();
    const store = createRequestDetailsStore({ adapter: fake.adapter, env: okEnv });
    const existingRef = "#/0/6";

    await store.stage({
      id: "ref-pass",
      request: { tools: existingRef },
      providerRequest: { tools: existingRef },
    });
    await store.flush();

    const written = JSON.parse(fake.records.get(fake.calls.write[0].timestamp.toString()));
    expect(written.request.tools).toBe(existingRef);
    expect(written.providerRequest.tools).toBe(existingRef);
    expect(written.__values__).toBeUndefined();
  });

  it("resolves a cross-record tools ref string in getMany", async () => {
    const fake = makeFakeAdapter();
    const store = createRequestDetailsStore({ adapter: fake.adapter, env: okEnv });

    // Record A has the tools locally
    const pointerA = await store.stage({ id: "a", request: { tools: structuredClone(toolsArray) } });
    await store.flush();

    // Record B references A's tools via cross-record ref
    const pointerB = await store.stage({ id: "b", request: { tools: structuredClone(toolsArray) } });
    await store.flush();

    const result = await store.getMany([pointerA.timslite_id, pointerB.timslite_id]);
    expect(result.get(pointerA.timslite_id).request.tools).toEqual(toolsArray);
    expect(result.get(pointerB.timslite_id).request.tools).toEqual(toolsArray);
  });

  it("leaves a non-string, non-array tools field untouched (fail open)", async () => {
    const fake = makeFakeAdapter();
    const store = createRequestDetailsStore({ adapter: fake.adapter, env: okEnv });

    await store.stage({
      id: "a",
      request: { tools: 42 },
    });
    await store.flush();

    const written = JSON.parse(fake.records.get(fake.calls.write[0].timestamp.toString()));
    expect(written.request.tools).toBe(42);
  });

  it("passes through an existing strict tools ref string unchanged with no __values__", async () => {
    const fake = makeFakeAdapter();
    const store = createRequestDetailsStore({ adapter: fake.adapter, env: okEnv });

    const strictRef = "#/42/2";
    await store.stage({
      id: "a",
      request: { tools: strictRef },
    });
    await store.flush();

    const written = JSON.parse(fake.records.get(fake.calls.write[0].timestamp.toString()));
    expect(written.request.tools).toBe(strictRef);
    expect(written.__values__).toBeUndefined();
  });
});

describe("Logical ID units — store integration", () => {
  beforeEach(() => _resetGlobalValueCache());
  const okEnv = { OBSERVABILITY_TIMSLITE_DATA_STORE: "true" };

  it("stage issues pointer ids equal to unixSeconds*100+sequence from the injected clock", async () => {
    const fake = makeFakeAdapter();
    const store = createRequestDetailsStore({
      adapter: fake.adapter,
      env: okEnv,
      clock: () => 1_726_480_000_000,
      wait: async () => {},
    });
    const p1 = await store.stage({ id: "a" });
    const p2 = await store.stage({ id: "b" });
    expect(p1.timslite_id).toBe("172648000000");
    expect(p2.timslite_id).toBe("172648000001");
    await store.flush();
    expect(fake.calls.write.map((w) => w.timestamp.toString())).toEqual(["172648000000", "172648000001"]);
  });

  it("the 101st stage in one second waits until the next second instead of throwing", async () => {
    let nowMs = 1_726_480_000_500;
    const waits = [];
    const fake = makeFakeAdapter();
    const store = createRequestDetailsStore({
      adapter: fake.adapter,
      env: okEnv,
      clock: () => nowMs,
      wait: async (ms) => {
        waits.push(ms);
        nowMs += ms;
      },
    });
    for (let i = 0; i < 100; i += 1) {
      const p = await store.stage({ seq: i });
      expect(p.timslite_id).toBe(String(172_648_000_000 + i));
    }
    const p101 = await store.stage({ seq: 100 });
    expect(waits).toEqual([500]);
    expect(p101.timslite_id).toBe("172648000100");
    await store.flush();
    expect(fake.calls.write).toHaveLength(101);
    expect(fake.calls.write[100].timestamp).toBe(172_648_000_100n);
  });

  it("cross-record refs embed the seconds-x-100 id of the source record", async () => {
    const fake = makeFakeAdapter();
    const store = createRequestDetailsStore({
      adapter: fake.adapter,
      env: okEnv,
      clock: () => 1_726_480_000_000,
      wait: async () => {},
    });
    const shared = { role: "user", content: "shared-unit" };
    await store.stage({ id: "a", request: { messages: [shared] } });
    await store.flush();
    await store.stage({ id: "b", request: { messages: [structuredClone(shared)] } });
    await store.flush();

    const idA = fake.calls.write[0].timestamp.toString();
    expect(idA).toBe("172648000000");
    const second = JSON.parse(fake.records.get(fake.calls.write[1].timestamp.toString()));
    expect(second.request.messages).toEqual([`#/${idA}/0`]);

    const idB = fake.calls.write[1].timestamp.toString();
    const result = await store.getMany([idB]);
    expect(result.get(idB)).toEqual({ id: "b", request: { messages: [shared] } });
  });
});

describe("Deduplication protocol — input items and instructions string", () => {
  beforeEach(() => _resetGlobalValueCache());
  const okEnv = { OBSERVABILITY_TIMSLITE_DATA_STORE: "true" };
  const userMessage = { role: "user", content: "hi" };
  const inputItemA = { type: "message", role: "user", content: [{ type: "input_text", text: "first" }] };
  const inputItemB = { type: "function_call", call_id: "c1", name: "get_weather", arguments: "{}" };
  const instructionsText = "You are a precise assistant.";
  const toolsArray = [{ type: "function", function: { name: "get_time" } }];

  function readWritten(fake, i = 0) {
    return JSON.parse(fake.records.get(fake.calls.write[i].timestamp.toString()));
  }

  it("deduplicates request.input items per element into the shared __values__ array", async () => {
    const fake = makeFakeAdapter();
    const store = createRequestDetailsStore({ adapter: fake.adapter, env: okEnv });
    await store.stage({ id: "a", request: { model: "gpt-5", input: [inputItemA, inputItemB] } });
    await store.flush();

    const written = readWritten(fake);
    expect(written.request.input).toEqual(["#/0/0", "#/0/1"]);
    expect(written.__values__).toEqual([inputItemA, inputItemB]);
  });

  it("collapses duplicate input items onto one __values__ index", async () => {
    const fake = makeFakeAdapter();
    const store = createRequestDetailsStore({ adapter: fake.adapter, env: okEnv });
    await store.stage({
      id: "a",
      request: { input: [inputItemA, structuredClone(inputItemA)] },
    });
    await store.flush();

    const written = readWritten(fake);
    expect(written.request.input).toEqual(["#/0/0", "#/0/0"]);
    expect(written.__values__).toEqual([inputItemA]);
  });

  it("deduplicates the instructions string as a single whole value", async () => {
    const fake = makeFakeAdapter();
    const store = createRequestDetailsStore({ adapter: fake.adapter, env: okEnv });
    await store.stage({ id: "a", request: { model: "gpt-5", instructions: instructionsText } });
    await store.flush();

    const written = readWritten(fake);
    expect(written.request.instructions).toBe("#/0/0");
    expect(written.__values__).toEqual([instructionsText]);
  });

  it("shares one __values__ entry for identical instructions across request and providerRequest", async () => {
    const fake = makeFakeAdapter();
    const store = createRequestDetailsStore({ adapter: fake.adapter, env: okEnv });
    await store.stage({
      id: "a",
      request: { instructions: instructionsText },
      providerRequest: { instructions: instructionsText },
    });
    await store.flush();

    const written = readWritten(fake);
    expect(written.request.instructions).toBe("#/0/0");
    expect(written.providerRequest.instructions).toBe("#/0/0");
    expect(written.__values__).toEqual([instructionsText]);
  });

  it("orders first-seen indices messages, then input, then tools, then instructions in one container", async () => {
    const fake = makeFakeAdapter();
    const store = createRequestDetailsStore({ adapter: fake.adapter, env: okEnv });
    await store.stage({
      id: "a",
      request: {
        messages: [userMessage],
        input: [inputItemA],
        tools: structuredClone(toolsArray),
        instructions: instructionsText,
      },
    });
    await store.flush();

    const written = readWritten(fake);
    expect(written.request.messages).toEqual(["#/0/0"]);
    expect(written.request.input).toEqual(["#/0/1"]);
    expect(written.request.tools).toBe("#/0/2");
    expect(written.request.instructions).toBe("#/0/3");
    expect(written.__values__).toEqual([userMessage, inputItemA, toolsArray, instructionsText]);
  });

  it("rehydrates input items and instructions on getMany and strips __values__", async () => {
    const fake = makeFakeAdapter();
    const store = createRequestDetailsStore({ adapter: fake.adapter, env: okEnv });
    const pointer = await store.stage({
      id: "a",
      request: { messages: [userMessage], input: [inputItemA, inputItemB], instructions: instructionsText },
    });
    await store.flush();

    const detail = (await store.getMany([pointer.timslite_id])).get(pointer.timslite_id);
    expect(detail).toEqual({
      id: "a",
      request: { messages: [userMessage], input: [inputItemA, inputItemB], instructions: instructionsText },
    });
    expect(detail.__values__).toBeUndefined();
    expect(JSON.stringify(detail)).not.toContain("#/0/");
  });

  it("reuses identical input items and instructions from an earlier record via cross-record refs", async () => {
    const fake = makeFakeAdapter();
    const store = createRequestDetailsStore({ adapter: fake.adapter, env: okEnv });
    await store.stage({ id: "a", request: { input: [inputItemA], instructions: instructionsText } });
    await store.flush();
    const idA = fake.calls.write[0].timestamp.toString();

    await store.stage({
      id: "b",
      request: { input: [structuredClone(inputItemA)], instructions: instructionsText },
    });
    await store.flush();

    const second = readWritten(fake, 1);
    expect(second.request.input).toEqual([`#/${idA}/0`]);
    expect(second.request.instructions).toBe(`#/${idA}/1`);
    expect(second.__values__).toBeUndefined();

    const idB = fake.calls.write[1].timestamp.toString();
    const detail = (await store.getMany([idB])).get(idB);
    expect(detail).toEqual({
      id: "b",
      request: { input: [inputItemA], instructions: instructionsText },
    });
  });

  it("preserves existing strict ref strings in input items and instructions without re-hashing", async () => {
    const fake = makeFakeAdapter();
    const store = createRequestDetailsStore({ adapter: fake.adapter, env: okEnv });
    const inputCrossRef = "#/17898773127120/2";
    const instructionsCrossRef = "#/17898773127120/5";

    await store.stage({
      id: "a",
      request: { input: [inputCrossRef, userMessage], instructions: instructionsCrossRef },
    });
    await store.flush();

    const written = readWritten(fake);
    expect(written.request.input[0]).toBe(inputCrossRef);
    expect(written.request.input[1]).toBe("#/0/0");
    expect(written.request.instructions).toBe(instructionsCrossRef);
    expect(written.__values__).toEqual([userMessage]);
  });

  it("leaves non-array input and non-string instructions untouched (fail open)", async () => {
    const fake = makeFakeAdapter();
    const store = createRequestDetailsStore({ adapter: fake.adapter, env: okEnv });
    await store.stage({
      id: "a",
      request: { input: { shape: "object" }, instructions: 42 },
      providerRequest: { input: null },
    });
    await store.flush();

    const written = readWritten(fake);
    expect(written.request.input).toEqual({ shape: "object" });
    expect(written.request.instructions).toBe(42);
    expect(written.providerRequest.input).toBeNull();
    expect(written.__values__).toBeUndefined();
  });

  it("returns compact input/instructions refs verbatim when resolveValues is false", async () => {
    const fake = makeFakeAdapter();
    const store = createRequestDetailsStore({ adapter: fake.adapter, env: okEnv });
    const pointer = await store.stage({
      id: "a",
      request: { input: [inputItemA], instructions: instructionsText },
    });
    await store.flush();

    const readsBefore = fake.calls.read.length;
    const result = await store.getMany([pointer.timslite_id], { resolveValues: false });
    expect(fake.calls.read.length).toBe(readsBefore + 1);
    expect(result.get(pointer.timslite_id)).toEqual({
      id: "a",
      request: { input: ["#/0/0"], instructions: "#/0/1" },
      __values__: [inputItemA, instructionsText],
    });
  });

  it("leaves input and instructions completely untouched when the payload shadows __values__", async () => {
    const fake = makeFakeAdapter();
    const store = createRequestDetailsStore({ adapter: fake.adapter, env: okEnv });
    await store.stage({
      id: "a",
      request: { input: [inputItemA], instructions: instructionsText },
      __values__: { user: "pre-existing" },
    });
    await store.flush();

    const written = readWritten(fake);
    expect(written.request.input).toEqual([inputItemA]);
    expect(written.request.instructions).toBe(instructionsText);
    expect(written.__values__).toEqual({ user: "pre-existing" });
  });
});
