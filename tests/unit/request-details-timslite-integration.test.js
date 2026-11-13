import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mockDbAdapter = {
  driver: "mock",
  run: vi.fn(),
  get: vi.fn(),
  all: vi.fn(),
  exec: vi.fn(),
  transaction: vi.fn((fn) => fn()),
  close: vi.fn(),
};

global._dbAdapter = {
  instance: mockDbAdapter,
  initPromise: Promise.resolve(mockDbAdapter),
  logged: true,
};

vi.mock("@/lib/db/repos/settingsRepo.js", () => ({
  getSettings: vi.fn().mockResolvedValue({
    enableObservability: true,
    observabilityMaxRecords: 200,
    observabilityBatchSize: 20,
    observabilityFlushIntervalMs: 5000,
    observabilityMaxJsonSize: 5,
  }),
}));

const {
  saveRequestDetail,
  getRequestDetails,
  __test__: repoTest,
} = await import("@/lib/db/repos/requestDetailsRepo.js");

const { createRequestDetailsStore } = await import(
  "@/lib/timslite/requestDetailsStore.js"
);

function makeFakeTimsliteAdapter(options = {}) {
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
    delete: 0,
  };
  let latestTimestamp = 0n;
  const forceError = options.forceError || null;
  const forceErrorOnFlush = options.forceErrorOnFlush || false;

  return {
    calls,
    records,
    adapter: {
      async openStore(dataDir, config) {
        calls.storeOpen.push({ dataDir, config });
        if (forceError === "openStore") {
          throw new Error("Simulated openStore failure");
        }
        return {
          readOnly: false,
          async createDataset(name, type, options) {
            calls.createDataset.push({ name, type, options });
            if (forceError === "createDataset") {
              throw new Error("Simulated createDataset failure");
            }
          },
          async openDataset(name, type) {
            calls.openDataset.push({ name, type });
            if (forceError === "openDataset") {
              throw new Error("Simulated openDataset failure");
            }
            return {
              async write(timestamp, data) {
                calls.write.push({ timestamp: BigInt(timestamp), data });
                if (forceError === "write") {
                  throw new Error("Simulated write failure");
                }
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
              async flush() {
                calls.flush += 1;
                if (forceErrorOnFlush) {
                  throw new Error("Simulated flush failure");
                }
              },
              async close() {
                calls.close += 1;
              },
              async delete() {
                calls.delete += 1;
              },
            };
          },
          async close() {
            calls.close += 1;
          },
        };
      },
    },
  };
}

describe("requestDetailsRepo Timslite integration", () => {
  let originalEnv;
  let fakeTimslite;
  let store;

  beforeEach(async () => {
    originalEnv = { ...process.env };

    vi.clearAllMocks();
    mockDbAdapter.run.mockReset();
    mockDbAdapter.get.mockReset();
    mockDbAdapter.all.mockReset();
    mockDbAdapter.transaction.mockImplementation((fn) => fn());

    if (repoTest.resetState) {
      repoTest.resetState();
    }

    await new Promise((resolve) => setTimeout(resolve, 10));

    delete process.env.OBSERVABILITY_TIMSLITE_DATA_STORE;
  });

  afterEach(() => {
    process.env = originalEnv;

    if (store && store.close) {
      store.close().catch(() => {});
      store = null;
    }
  });

  describe("disabled inline compatibility", () => {
    it("writes full inline JSON to SQLite when Timslite is disabled", async () => {
      delete process.env.OBSERVABILITY_TIMSLITE_DATA_STORE;

      const detail = {
        id: "test-detail-1",
        provider: "openai",
        model: "gpt-4",
        timestamp: "2024-01-01T00:00:00.000Z",
        status: "success",
        request: { body: "test request" },
        response: { body: "test response" },
      };

      await saveRequestDetail(detail);
      await repoTest.flushNow();

      const insertCall = mockDbAdapter.run.mock.calls.find((call) =>
        call[0].includes("INSERT INTO requestDetails")
      );
      expect(insertCall).toBeDefined();

      const dataParam = insertCall[1][insertCall[1].length - 1];
      const parsed = JSON.parse(dataParam);
      expect(parsed.id).toBe("test-detail-1");
      expect(parsed.provider).toBe("openai");
      expect(parsed.request.body).toBe("test request");
      expect(parsed.timslite_id).toBeUndefined();
    });

    it("does not initialize Timslite store when disabled", async () => {
      fakeTimslite = makeFakeTimsliteAdapter();

      if (repoTest.setStoreFactory) {
        repoTest.setStoreFactory(() => {
          store = createRequestDetailsStore({
            adapter: fakeTimslite.adapter,
            env: { OBSERVABILITY_TIMSLITE_DATA_STORE: "false" },
          });
          return store;
        });
      }

      await saveRequestDetail({ id: "test-1" });
      await repoTest.flushNow();

      expect(fakeTimslite.calls.storeOpen).toHaveLength(0);
    });

    it("disabled mode applies per-field truncation based on maxJsonSize", async () => {
      delete process.env.OBSERVABILITY_TIMSLITE_DATA_STORE;
      process.env.OBSERVABILITY_MAX_JSON_SIZE = "1";

      const largeField = "x".repeat(10000);
      const detail = {
        id: "truncation-test",
        provider: "openai",
        request: { body: largeField },
        response: { data: largeField },
      };

      await saveRequestDetail(detail);
      await repoTest.flushNow();

      const insertCall = mockDbAdapter.run.mock.calls.find((call) =>
        call[0].includes("INSERT INTO requestDetails")
      );
      expect(insertCall).toBeDefined();

      const dataParam = insertCall[1][insertCall[1].length - 1];
      const parsed = JSON.parse(dataParam);
      
      expect(parsed.request._truncated).toBe(true);
      expect(parsed.response._truncated).toBe(true);
      expect(parsed.request._preview).toBeDefined();
      expect(parsed.request._preview.length).toBeLessThan(10000);
    });
  });

  describe("literal OBSERVABILITY_TIMSLITE_DATA_STORE gate", () => {
    it.each(["TRUE", "True", "tRuE", " true", "true ", " true ", "1", "0", "yes", "false", ""])(
      "keeps writes inline when the value is %j",
      async (value) => {
        process.env.OBSERVABILITY_TIMSLITE_DATA_STORE = value;
        fakeTimslite = makeFakeTimsliteAdapter();
        repoTest.setStoreFactory(() => {
          store = createRequestDetailsStore({
            adapter: fakeTimslite.adapter,
            env: { OBSERVABILITY_TIMSLITE_DATA_STORE: value },
          });
          return store;
        });

        await saveRequestDetail({
          id: `literal-inline-${value.trim() || "empty"}`,
          provider: "openai",
          request: { body: "x" },
        });
        await repoTest.flushNow();

        const insertCall = mockDbAdapter.run.mock.calls.find((call) =>
          call[0].includes("INSERT INTO requestDetails")
        );
        expect(insertCall).toBeDefined();
        const parsed = JSON.parse(insertCall[1][insertCall[1].length - 1]);
        expect(parsed.timslite_id).toBeUndefined();
        expect(fakeTimslite.calls.storeOpen).toHaveLength(0);
      }
    );

    it("writes the {timslite_id} pointer only for the exact literal string true", async () => {
      process.env.OBSERVABILITY_TIMSLITE_DATA_STORE = "true";
      fakeTimslite = makeFakeTimsliteAdapter();
      repoTest.setStoreFactory(() => {
        store = createRequestDetailsStore({
          adapter: fakeTimslite.adapter,
          env: { OBSERVABILITY_TIMSLITE_DATA_STORE: "true" },
        });
        return store;
      });

      await saveRequestDetail({ id: "literal-true", provider: "openai", request: { body: "x" } });
      await repoTest.flushNow();

      const insertCall = mockDbAdapter.run.mock.calls.find((call) =>
        call[0].includes("INSERT INTO requestDetails")
      );
      expect(insertCall).toBeDefined();
      const parsed = JSON.parse(insertCall[1][insertCall[1].length - 1]);
      expect(Object.keys(parsed)).toEqual(["timslite_id"]);
      expect(fakeTimslite.calls.storeOpen).toHaveLength(1);
    });
  });

  describe("enabled exact SQLite data {timslite_id}", () => {
    it("writes {timslite_id} pointer to SQLite when Timslite is enabled", async () => {
      process.env.OBSERVABILITY_TIMSLITE_DATA_STORE = "true";
      fakeTimslite = makeFakeTimsliteAdapter();

      if (repoTest.setStoreFactory) {
        repoTest.setStoreFactory(() => {
          store = createRequestDetailsStore({
            adapter: fakeTimslite.adapter,
            env: { OBSERVABILITY_TIMSLITE_DATA_STORE: "true" },
          });
          return store;
        });
      }

      const detail = {
        id: "test-detail-2",
        provider: "anthropic",
        model: "claude-3",
        timestamp: "2024-01-01T00:00:00.000Z",
        status: "success",
        request: { body: "test request" },
        response: { body: "test response" },
      };

      await saveRequestDetail(detail);
      await repoTest.flushNow();

      expect(fakeTimslite.calls.write.length).toBeGreaterThan(0);

      const insertCall = mockDbAdapter.run.mock.calls.find((call) =>
        call[0].includes("INSERT INTO requestDetails")
      );
      expect(insertCall).toBeDefined();

      const dataParam = insertCall[1][insertCall[1].length - 1];
      const parsed = JSON.parse(dataParam);
      
      expect(Object.keys(parsed)).toEqual(["timslite_id"]);
      expect(parsed.timslite_id).toMatch(/^\d+$/);
    });

    it("normalizes every omitted indexed metadata bind to null", async () => {
      process.env.OBSERVABILITY_TIMSLITE_DATA_STORE = "true";
      fakeTimslite = makeFakeTimsliteAdapter();
      repoTest.setStoreFactory(() => createRequestDetailsStore({
        adapter: fakeTimslite.adapter,
        env: { OBSERVABILITY_TIMSLITE_DATA_STORE: "true" },
      }));

      await saveRequestDetail({ id: "optional-metadata", request: { body: "test" } });
      await repoTest.flushNow();

      const insertCall = mockDbAdapter.run.mock.calls.find((call) =>
        call[0].includes("INSERT INTO requestDetails")
      );
      expect(insertCall[1].slice(2, 6)).toEqual([null, null, null, null]);
      expect(insertCall[1]).not.toContain(undefined);
      expect(JSON.parse(insertCall[1][6])).toEqual({
        timslite_id: expect.stringMatching(/^\d+$/),
      });
    });

    it("uses the writable store instance to hydrate while the writer remains open", async () => {
      process.env.OBSERVABILITY_TIMSLITE_DATA_STORE = "true";
      fakeTimslite = makeFakeTimsliteAdapter();
      let factoryCalls = 0;
      repoTest.setStoreFactory(() => {
        factoryCalls += 1;
        store = createRequestDetailsStore({
          adapter: fakeTimslite.adapter,
          env: { OBSERVABILITY_TIMSLITE_DATA_STORE: "true" },
        });
        return store;
      });

      await saveRequestDetail({ id: "write-read", request: { body: "kept" } });
      await repoTest.flushNow();
      const insert = mockDbAdapter.run.mock.calls.find((call) => call[0].includes("INSERT INTO requestDetails"));
      const pointer = JSON.parse(insert[1][6]);
      mockDbAdapter.get.mockReturnValue({ c: 1 });
      mockDbAdapter.all.mockReturnValue([{
        id: "write-read",
        timestamp: insert[1][1],
        provider: null,
        model: null,
        connectionId: null,
        status: null,
        data: insert[1][6],
      }]);

      const result = await getRequestDetails({ pageSize: 1 });
      expect(factoryCalls).toBe(1);
      expect(result.details[0].request).toEqual({ body: "kept" });
      expect(result.details[0].timslite_id).toBe(pointer.timslite_id);
      expect(fakeTimslite.calls.storeOpen).toHaveLength(1);
    });

    it("passes resolveValues: false when hydrating the list read", async () => {
      process.env.OBSERVABILITY_TIMSLITE_DATA_STORE = "true";
      fakeTimslite = makeFakeTimsliteAdapter();
      const getManyArgs = [];
      repoTest.setStoreFactory(() => {
        store = createRequestDetailsStore({
          adapter: fakeTimslite.adapter,
          env: { OBSERVABILITY_TIMSLITE_DATA_STORE: "true" },
        });
        const inner = store.getMany.bind(store);
        store.getMany = (ids, options) => {
          getManyArgs.push({ ids, options });
          return inner(ids, options);
        };
        return store;
      });

      await saveRequestDetail({ id: "write-read", request: { body: "kept" } });
      await repoTest.flushNow();
      const insert = mockDbAdapter.run.mock.calls.find((call) => call[0].includes("INSERT INTO requestDetails"));
      mockDbAdapter.get.mockReturnValue({ c: 1 });
      mockDbAdapter.all.mockReturnValue([{
        id: "write-read",
        timestamp: insert[1][1],
        provider: null,
        model: null,
        connectionId: null,
        status: null,
        data: insert[1][6],
      }]);

      await getRequestDetails({ pageSize: 1 });
      expect(getManyArgs).toHaveLength(1);
      expect(getManyArgs[0].options).toEqual({ resolveValues: false });
    });

    it("does not mutate the caller object or nested headers during flush", async () => {
      process.env.OBSERVABILITY_TIMSLITE_DATA_STORE = "true";
      fakeTimslite = makeFakeTimsliteAdapter();
      repoTest.setStoreFactory(() => createRequestDetailsStore({
        adapter: fakeTimslite.adapter,
        env: { OBSERVABILITY_TIMSLITE_DATA_STORE: "true" },
      }));
      const detail = {
        request: { headers: { authorization: "secret", "x-safe": "visible" } },
        response: { nested: { value: true } },
      };
      const snapshot = structuredClone(detail);

      await saveRequestDetail(detail);
      await repoTest.flushNow();

      expect(detail).toEqual(snapshot);
    });

    it("large request/providerResponse fields reach Timslite intact without per-field truncation", async () => {
      process.env.OBSERVABILITY_TIMSLITE_DATA_STORE = "true";
      process.env.OBSERVABILITY_MAX_JSON_SIZE = "1";
      fakeTimslite = makeFakeTimsliteAdapter();

      if (repoTest.setStoreFactory) {
        repoTest.setStoreFactory(() => {
          store = createRequestDetailsStore({
            adapter: fakeTimslite.adapter,
            env: { OBSERVABILITY_TIMSLITE_DATA_STORE: "true" },
          });
          return store;
        });
      }

      const largeField = "x".repeat(10000);
      const detail = {
        id: "large-field-test",
        provider: "openai",
        request: { body: largeField },
        providerResponse: { data: largeField },
      };

      await saveRequestDetail(detail);
      await repoTest.flushNow();

      expect(fakeTimslite.calls.write.length).toBe(1);
      const writtenData = fakeTimslite.calls.write[0].data.toString("utf8");
      const parsed = JSON.parse(writtenData);
      
      expect(parsed.request.body).toBe(largeField);
      expect(parsed.providerResponse.data).toBe(largeField);
      expect(parsed.request.body.length).toBe(10000);
    });
  });

  describe("stage-all-then-one-flush-before-SQLite-transaction", () => {
    it("stages all records, flushes once, then writes SQLite in transaction", async () => {
      process.env.OBSERVABILITY_TIMSLITE_DATA_STORE = "true";
      fakeTimslite = makeFakeTimsliteAdapter();

      if (repoTest.setStoreFactory) {
        repoTest.setStoreFactory(() => {
          store = createRequestDetailsStore({
            adapter: fakeTimslite.adapter,
            env: { OBSERVABILITY_TIMSLITE_DATA_STORE: "true" },
          });
          return store;
        });
      }

      await saveRequestDetail({ id: "detail-1", provider: "openai" });
      await saveRequestDetail({ id: "detail-2", provider: "anthropic" });
      await saveRequestDetail({ id: "detail-3", provider: "google" });

      await repoTest.flushNow();

      expect(fakeTimslite.calls.write.length).toBe(3);

      expect(fakeTimslite.calls.flush).toBe(1);

      expect(mockDbAdapter.transaction).toHaveBeenCalledTimes(1);

      const insertCalls = mockDbAdapter.run.mock.calls.filter((call) =>
        call[0].includes("INSERT INTO requestDetails")
      );
      expect(insertCalls.length).toBe(3);
    });
  });

  describe("Timslite failure fallback to inline sanitized/truncated record", () => {
    it("falls back to inline record when Timslite stage fails", async () => {
      process.env.OBSERVABILITY_TIMSLITE_DATA_STORE = "true";
      fakeTimslite = makeFakeTimsliteAdapter({ forceError: "write" });

      if (repoTest.setStoreFactory) {
        repoTest.setStoreFactory(() => {
          store = createRequestDetailsStore({
            adapter: fakeTimslite.adapter,
            env: { OBSERVABILITY_TIMSLITE_DATA_STORE: "true" },
          });
          return store;
        });
      }

      const detail = {
        id: "test-fallback-1",
        provider: "openai",
        request: { body: "test", headers: { authorization: "secret" } },
        response: { body: "response" },
      };

      await saveRequestDetail(detail);
      await repoTest.flushNow();

      // Should have fallen back to inline write
      const insertCall = mockDbAdapter.run.mock.calls.find((call) =>
        call[0].includes("INSERT INTO requestDetails")
      );
      expect(insertCall).toBeDefined();

      const dataParam = insertCall[1][insertCall[1].length - 1];
      const parsed = JSON.parse(dataParam);

      expect(parsed.id).toBe("test-fallback-1");
      expect(parsed.provider).toBe("openai");
      expect(parsed.request.headers.authorization).toBeUndefined();
      expect(parsed.timslite_id).toBeUndefined();
    });

    it("falls back to inline record when Timslite flush fails", async () => {
      process.env.OBSERVABILITY_TIMSLITE_DATA_STORE = "true";
      fakeTimslite = makeFakeTimsliteAdapter({ forceErrorOnFlush: true });

      if (repoTest.setStoreFactory) {
        repoTest.setStoreFactory(() => {
          store = createRequestDetailsStore({
            adapter: fakeTimslite.adapter,
            env: { OBSERVABILITY_TIMSLITE_DATA_STORE: "true" },
          });
          return store;
        });
      }

      const detail = {
        id: "test-fallback-2",
        provider: "anthropic",
        request: { body: "test" },
      };

      await saveRequestDetail(detail);
      await repoTest.flushNow();

      const insertCall = mockDbAdapter.run.mock.calls.find((call) =>
        call[0].includes("INSERT INTO requestDetails")
      );
      expect(insertCall).toBeDefined();

      const dataParam = insertCall[1][insertCall[1].length - 1];
      const parsed = JSON.parse(dataParam);
      expect(parsed.id).toBe("test-fallback-2");
      expect(parsed.timslite_id).toBeUndefined();
    });

    it("does not throw when Timslite fails, observability fails open", async () => {
      process.env.OBSERVABILITY_TIMSLITE_DATA_STORE = "true";
      fakeTimslite = makeFakeTimsliteAdapter({ forceError: "openStore" });

      if (repoTest.setStoreFactory) {
        repoTest.setStoreFactory(() => {
          store = createRequestDetailsStore({
            adapter: fakeTimslite.adapter,
            env: { OBSERVABILITY_TIMSLITE_DATA_STORE: "true" },
          });
          return store;
        });
      }

      const detail = { id: "test-no-throw", provider: "openai" };

      await expect(
        (async () => {
          await saveRequestDetail(detail);
          await repoTest.flushNow();
        })()
      ).resolves.not.toThrow();

      const insertCall = mockDbAdapter.run.mock.calls.find((call) =>
        call[0].includes("INSERT INTO requestDetails")
      );
      expect(insertCall).toBeDefined();
    });

    it("fallback after Timslite failure uses per-field truncation", async () => {
      process.env.OBSERVABILITY_TIMSLITE_DATA_STORE = "true";
      process.env.OBSERVABILITY_MAX_JSON_SIZE = "1";
      fakeTimslite = makeFakeTimsliteAdapter({ forceError: "write" });

      if (repoTest.setStoreFactory) {
        repoTest.setStoreFactory(() => {
          store = createRequestDetailsStore({
            adapter: fakeTimslite.adapter,
            env: { OBSERVABILITY_TIMSLITE_DATA_STORE: "true" },
          });
          return store;
        });
      }

      const largeField = "x".repeat(10000);
      const detail = {
        id: "fallback-truncation-test",
        provider: "openai",
        request: { body: largeField },
        response: { data: largeField },
      };

      await saveRequestDetail(detail);
      await repoTest.flushNow();

      const insertCall = mockDbAdapter.run.mock.calls.find((call) =>
        call[0].includes("INSERT INTO requestDetails")
      );
      expect(insertCall).toBeDefined();

      const dataParam = insertCall[1][insertCall[1].length - 1];
      const parsed = JSON.parse(dataParam);
      
      expect(parsed.request._truncated).toBe(true);
      expect(parsed.response._truncated).toBe(true);
      expect(parsed.request._preview).toBeDefined();
      expect(parsed.request._preview.length).toBeLessThan(10000);
    });
  });

  describe("repeated same business ID gets new Timslite ID", () => {
    it("generates new Timslite ID for same business ID, SQLite points to latest", async () => {
      process.env.OBSERVABILITY_TIMSLITE_DATA_STORE = "true";
      fakeTimslite = makeFakeTimsliteAdapter();

      if (repoTest.setStoreFactory) {
        repoTest.setStoreFactory(() => {
          store = createRequestDetailsStore({
            adapter: fakeTimslite.adapter,
            env: { OBSERVABILITY_TIMSLITE_DATA_STORE: "true" },
          });
          return store;
        });
      }

      const businessId = "same-business-id";
      await saveRequestDetail({ id: businessId, provider: "openai", request: { body: "first" } });
      await repoTest.flushNow();

      await saveRequestDetail({ id: businessId, provider: "openai", request: { body: "second" } });
      await repoTest.flushNow();

      expect(fakeTimslite.calls.write.length).toBe(2);
      const timsliteIds = fakeTimslite.calls.write.map((w) => w.timestamp.toString());
      expect(timsliteIds[0]).not.toBe(timsliteIds[1]);

      const insertCalls = mockDbAdapter.run.mock.calls.filter((call) =>
        call[0].includes("INSERT INTO requestDetails")
      );
      expect(insertCalls.length).toBe(2);

      const id1 = insertCalls[0][1][0];
      const id2 = insertCalls[1][1][0];
      expect(id1).toBe(businessId);
      expect(id2).toBe(businessId);

      const data1 = JSON.parse(insertCalls[0][1][insertCalls[0][1].length - 1]);
      const data2 = JSON.parse(insertCalls[1][1][insertCalls[1][1].length - 1]);
      expect(Object.keys(data1)).toEqual(["timslite_id"]);
      expect(Object.keys(data2)).toEqual(["timslite_id"]);
      expect(data1.timslite_id).not.toBe(data2.timslite_id);
    });
  });

  describe("retention pointer replacement never calls Timslite delete", () => {
    it("does not call dataset.delete when retention SQL runs", async () => {
      process.env.OBSERVABILITY_TIMSLITE_DATA_STORE = "true";
      fakeTimslite = makeFakeTimsliteAdapter();

      mockDbAdapter.get.mockImplementation((sql) => {
        if (sql.includes("SELECT COUNT(*)")) {
          return { c: 250 };
        }
        return null;
      });

      if (repoTest.setStoreFactory) {
        repoTest.setStoreFactory(() => {
          store = createRequestDetailsStore({
            adapter: fakeTimslite.adapter,
            env: { OBSERVABILITY_TIMSLITE_DATA_STORE: "true" },
          });
          return store;
        });
      }

      for (let i = 0; i < 250; i++) {
        await saveRequestDetail({ id: `retention-test-${i}`, provider: "openai" });
      }
      await repoTest.flushNow();

      const deleteCall = mockDbAdapter.run.mock.calls.find((call) =>
        call[0].includes("DELETE FROM requestDetails")
      );
      expect(deleteCall).toBeDefined();

      expect(fakeTimslite.calls.delete).toBe(0);
    });
  });

  describe("failed batch isolation", () => {
    it("does not replay failed batch entries into next batch", async () => {
      mockDbAdapter.run.mockClear();
      
      process.env.OBSERVABILITY_TIMSLITE_DATA_STORE = "true";
      
      let flushCallCount = 0;
      let storeInstanceCount = 0;
      
      if (repoTest.setStoreFactory) {
        repoTest.setStoreFactory(() => {
          storeInstanceCount++;
          const fakeTimslite = makeFakeTimsliteAdapter();
          const newStore = createRequestDetailsStore({
            adapter: fakeTimslite.adapter,
            env: { OBSERVABILITY_TIMSLITE_DATA_STORE: "true" },
          });
          
          const originalFlush = newStore.flush;
          newStore.flush = async () => {
            flushCallCount++;
            if (flushCallCount === 1) {
              throw new Error("Simulated flush failure");
            }
            return originalFlush.call(newStore);
          };
          
          store = newStore;
          return newStore;
        });
      }

      const batch1Detail = {
        id: "batch-1-detail",
        provider: "openai",
        request: { body: "batch 1" },
      };

      await saveRequestDetail(batch1Detail);
      await repoTest.flushNow();

      const batch1Inserts = mockDbAdapter.run.mock.calls.filter((call) =>
        call[0].includes("INSERT INTO requestDetails")
      );
      expect(batch1Inserts.length).toBe(1);
      const batch1Data = JSON.parse(batch1Inserts[0][1][batch1Inserts[0][1].length - 1]);
      expect(batch1Data.timslite_id).toBeUndefined();
      expect(batch1Data.id).toBe("batch-1-detail");

      mockDbAdapter.run.mockClear();

      const batch2Detail = {
        id: "batch-2-detail",
        provider: "anthropic",
        request: { body: "batch 2" },
      };

      await saveRequestDetail(batch2Detail);
      await repoTest.flushNow();

      expect(storeInstanceCount).toBe(2);

      const batch2Inserts = mockDbAdapter.run.mock.calls.filter((call) =>
        call[0].includes("INSERT INTO requestDetails")
      );
      expect(batch2Inserts.length).toBe(1);
      const batch2Pointer = JSON.parse(batch2Inserts[0][1][batch2Inserts[0][1].length - 1]);
      expect(Object.keys(batch2Pointer)).toEqual(["timslite_id"]);
    });
  });

  describe("no SQLite schema/migration changes", () => {
    it("uses existing requestDetails table without schema changes", async () => {
      process.env.OBSERVABILITY_TIMSLITE_DATA_STORE = "true";
      fakeTimslite = makeFakeTimsliteAdapter();

      if (repoTest.setStoreFactory) {
        repoTest.setStoreFactory(() => {
          store = createRequestDetailsStore({
            adapter: fakeTimslite.adapter,
            env: { OBSERVABILITY_TIMSLITE_DATA_STORE: "true" },
          });
          return store;
        });
      }

      await saveRequestDetail({ id: "schema-test", provider: "openai" });
      await repoTest.flushNow();

      const insertCall = mockDbAdapter.run.mock.calls.find((call) =>
        call[0].includes("INSERT INTO requestDetails")
      );
      expect(insertCall).toBeDefined();

      expect(insertCall[0]).toMatch(
        /INSERT INTO requestDetails\(id, timestamp, provider, model, connectionId, status, data\)/
      );
    });
  });

  describe("OBSERVABILITY_DATA_PROVIDER_DROP for provider payloads", () => {
    it("drops providerRequest/providerResponse from the Timslite record when the literal true is set", async () => {
      process.env.OBSERVABILITY_TIMSLITE_DATA_STORE = "true";
      process.env.OBSERVABILITY_DATA_PROVIDER_DROP = "true";
      fakeTimslite = makeFakeTimsliteAdapter();

      if (repoTest.setStoreFactory) {
        repoTest.setStoreFactory(() => {
          store = createRequestDetailsStore({
            adapter: fakeTimslite.adapter,
            env: { OBSERVABILITY_TIMSLITE_DATA_STORE: "true" },
          });
          return store;
        });
      }

      await saveRequestDetail({
        id: "drop-timslite",
        provider: "openai",
        request: { body: "keep" },
        providerRequest: { body: "drop-me" },
        providerResponse: { body: "drop-me-too" },
        response: { body: "keep-response" },
      });
      await repoTest.flushNow();

      expect(fakeTimslite.calls.write.length).toBe(1);
      const written = JSON.parse(fakeTimslite.calls.write[0].data.toString("utf8"));
      expect(written.request).toEqual({ body: "keep" });
      expect(written.response).toEqual({ body: "keep-response" });
      expect(written.providerRequest).toBeUndefined();
      expect(written.providerResponse).toBeUndefined();
    });

    it("drops providerRequest/providerResponse from the inline SQLite fallback when Timslite is disabled", async () => {
      delete process.env.OBSERVABILITY_TIMSLITE_DATA_STORE;
      process.env.OBSERVABILITY_DATA_PROVIDER_DROP = "true";

      const detail = {
        id: "drop-sqlite",
        provider: "openai",
        request: { body: "keep" },
        providerRequest: { body: "drop-me" },
        providerResponse: { body: "drop-me-too" },
        response: { body: "keep-response" },
      };

      await saveRequestDetail(detail);
      await repoTest.flushNow();

      const insertCall = mockDbAdapter.run.mock.calls.find((call) =>
        call[0].includes("INSERT INTO requestDetails")
      );
      expect(insertCall).toBeDefined();
      const parsed = JSON.parse(insertCall[1][insertCall[1].length - 1]);
      expect(parsed.request).toEqual({ body: "keep" });
      expect(parsed.response).toEqual({ body: "keep-response" });
      expect(parsed.providerRequest).toBeUndefined();
      expect(parsed.providerResponse).toBeUndefined();
    });

    it("drops provider payloads in the inline fallback after a Timslite stage failure", async () => {
      process.env.OBSERVABILITY_TIMSLITE_DATA_STORE = "true";
      process.env.OBSERVABILITY_DATA_PROVIDER_DROP = "true";
      fakeTimslite = makeFakeTimsliteAdapter({ forceError: "write" });

      if (repoTest.setStoreFactory) {
        repoTest.setStoreFactory(() => {
          store = createRequestDetailsStore({
            adapter: fakeTimslite.adapter,
            env: { OBSERVABILITY_TIMSLITE_DATA_STORE: "true" },
          });
          return store;
        });
      }

      await saveRequestDetail({
        id: "drop-fallback",
        provider: "openai",
        request: { body: "keep" },
        providerRequest: { body: "drop-me" },
        providerResponse: { body: "drop-me-too" },
      });
      await repoTest.flushNow();

      const insertCall = mockDbAdapter.run.mock.calls.find((call) =>
        call[0].includes("INSERT INTO requestDetails")
      );
      expect(insertCall).toBeDefined();
      const parsed = JSON.parse(insertCall[1][insertCall[1].length - 1]);
      expect(parsed.timslite_id).toBeUndefined();
      expect(parsed.providerRequest).toBeUndefined();
      expect(parsed.providerResponse).toBeUndefined();
    });

    it.each(["TRUE", "True", "tRuE", " true", "true ", " true ", "1", "0", "yes", "false", ""])(
      "keeps provider payloads in the SQLite fallback when the drop value is %j",
      async (value) => {
        delete process.env.OBSERVABILITY_TIMSLITE_DATA_STORE;
        process.env.OBSERVABILITY_DATA_PROVIDER_DROP = value;

        await saveRequestDetail({
          id: `keep-${value.trim() || "empty"}`,
          provider: "openai",
          providerRequest: { body: "keep-me" },
          providerResponse: { body: "keep-me-too" },
        });
        await repoTest.flushNow();

        const insertCall = mockDbAdapter.run.mock.calls.find((call) =>
          call[0].includes("INSERT INTO requestDetails")
        );
        expect(insertCall).toBeDefined();
        const parsed = JSON.parse(insertCall[1][insertCall[1].length - 1]);
        expect(parsed.providerRequest).toEqual({ body: "keep-me" });
        expect(parsed.providerResponse).toEqual({ body: "keep-me-too" });
      }
    );

    it("does not mutate the caller's detail object when provider payloads are dropped", async () => {
      delete process.env.OBSERVABILITY_TIMSLITE_DATA_STORE;
      process.env.OBSERVABILITY_DATA_PROVIDER_DROP = "true";

      const detail = {
        id: "drop-no-mutate",
        provider: "openai",
        request: { body: "keep" },
        providerRequest: { body: "drop-me" },
        providerResponse: { body: "drop-me-too" },
      };
      const snapshot = JSON.parse(JSON.stringify(detail));

      await saveRequestDetail(detail);
      await repoTest.flushNow();

      expect(detail).toEqual(snapshot);
    });
  });
});
