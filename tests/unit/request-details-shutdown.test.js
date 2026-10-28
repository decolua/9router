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
  getRequestDetailById,
  shutdownRequestDetails,
  __test__: repoTest,
} = await import("@/lib/db/repos/requestDetailsRepo.js");

function makeSpyStore(overrides = {}) {
  let counter = 0;
  return {
    enabled: true,
    stage: vi.fn(async () => ({ timslite_id: String(++counter) })),
    flush: vi.fn(async () => {}),
    discard: vi.fn(async () => {}),
    getMany: vi.fn(async () => new Map()),
    close: vi.fn(async () => {}),
    ...overrides,
  };
}

function pointerRow(id, timsliteId) {
  return {
    id,
    timestamp: new Date().toISOString(),
    provider: "openai",
    model: "gpt-4",
    connectionId: null,
    status: "success",
    data: JSON.stringify({ timslite_id: timsliteId }),
  };
}

function insertCalls() {
  return mockDbAdapter.run.mock.calls.filter((call) =>
    call[0].includes("INSERT INTO requestDetails")
  );
}

async function flushWriteBufferThroughFactory(factory) {
  repoTest.setStoreFactory(factory);
  await saveRequestDetail({ id: "seed-1", provider: "openai", request: { body: "seed" } });
  await repoTest.flushNow();
}

describe("requestDetailsRepo graceful shutdown", () => {
  let originalEnv;

  beforeEach(async () => {
    originalEnv = { ...process.env };

    vi.clearAllMocks();
    mockDbAdapter.run.mockReset();
    mockDbAdapter.get.mockReset().mockReturnValue(null);
    mockDbAdapter.all.mockReset().mockReturnValue([]);
    mockDbAdapter.transaction.mockImplementation((fn) => fn());

    repoTest.resetState();
    await new Promise((resolve) => setTimeout(resolve, 10));

    delete process.env.OBSERVABILITY_TIMSLITE_DATA_STORE;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("does not register an async work listener on process exit", () => {
    const exitListenerNames = process.listeners("exit").map((fn) => fn.name);
    expect(exitListenerNames).not.toContain("_shutdownHandler");
  });

  it("clears the pending flush timer and drains the write buffer", async () => {
    vi.useFakeTimers();
    try {
      await saveRequestDetail({ id: "drain-1", provider: "openai", request: { body: "x" } });
      expect(vi.getTimerCount()).toBeGreaterThan(0);

      await repoTest.shutdownNow();

      expect(vi.getTimerCount()).toBe(0);
      expect(insertCalls()).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("flushes staged records through normal dual-write and discards no successful batch", async () => {
    process.env.OBSERVABILITY_TIMSLITE_DATA_STORE = "true";
    const writeStore = makeSpyStore();
    repoTest.setStoreFactory(() => writeStore);

    await saveRequestDetail({ id: "dual-1", provider: "openai", request: { body: "hello" } });
    await repoTest.shutdownNow();

    expect(writeStore.stage).toHaveBeenCalledTimes(1);
    expect(writeStore.flush).toHaveBeenCalledTimes(1);
    expect(writeStore.discard).not.toHaveBeenCalled();

    const inserts = insertCalls();
    expect(inserts).toHaveLength(1);
    const data = JSON.parse(inserts[0][1][inserts[0][1].length - 1]);
    expect(data.timslite_id).toBe("1");
  });

  it("uses and closes one process-local store for writes and hydration", async () => {
    process.env.OBSERVABILITY_TIMSLITE_DATA_STORE = "true";
    const store = makeSpyStore();
    let factoryCalls = 0;

    await flushWriteBufferThroughFactory(() => {
      factoryCalls += 1;
      return store;
    });

    mockDbAdapter.get.mockReturnValue(pointerRow("ptr-distinct", "42"));
    await getRequestDetailById("ptr-distinct");

    await repoTest.shutdownNow();

    expect(factoryCalls).toBe(1);
    expect(store.getMany).toHaveBeenCalledWith(["42"]);
    expect(store.close).toHaveBeenCalledTimes(1);
  });

  it("does not double close when the read cache aliases the write store", async () => {
    process.env.OBSERVABILITY_TIMSLITE_DATA_STORE = "true";
    const sharedStore = makeSpyStore();

    await flushWriteBufferThroughFactory(() => sharedStore);

    mockDbAdapter.get.mockReturnValue(pointerRow("ptr-alias", "77"));
    await getRequestDetailById("ptr-alias");

    await repoTest.shutdownNow();

    expect(sharedStore.close).toHaveBeenCalledTimes(1);
  });

  it("is idempotent across repeated shutdown calls", async () => {
    process.env.OBSERVABILITY_TIMSLITE_DATA_STORE = "true";
    const store = makeSpyStore();
    repoTest.setStoreFactory(() => store);

    await saveRequestDetail({ id: "idem-1", provider: "openai" });

    await shutdownRequestDetails();
    await shutdownRequestDetails();

    expect(store.flush).toHaveBeenCalledTimes(1);
    expect(store.close).toHaveBeenCalledTimes(1);
  });

  it("logs a singleton close failure once without retrying the close", async () => {
    process.env.OBSERVABILITY_TIMSLITE_DATA_STORE = "true";
    const store = makeSpyStore({
      close: vi.fn(async () => {
        throw new Error("close boom");
      }),
    });
    let factoryCalls = 0;
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      await flushWriteBufferThroughFactory(() => {
        factoryCalls += 1;
        return store;
      });

      mockDbAdapter.get.mockReturnValue(pointerRow("ptr-fail", "9"));
      await getRequestDetailById("ptr-fail");

      await repoTest.shutdownNow();
      await repoTest.shutdownNow();

      expect(factoryCalls).toBe(1);
      expect(store.close).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(
        "[requestDetailsRepo] Timslite store close failed:",
        expect.objectContaining({ message: "close boom" })
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("keeps legacy inline JSON when the Timslite data store is disabled", async () => {
    delete process.env.OBSERVABILITY_TIMSLITE_DATA_STORE;

    await saveRequestDetail({
      id: "inline-1",
      provider: "anthropic",
      request: { body: "legacy" },
      response: { content: "ok" },
    });
    await repoTest.shutdownNow();

    const inserts = insertCalls();
    expect(inserts).toHaveLength(1);
    const data = JSON.parse(inserts[0][1][inserts[0][1].length - 1]);
    expect(data.timslite_id).toBeUndefined();
    expect(data.id).toBe("inline-1");
    expect(data.request).toEqual({ body: "legacy" });
  });

  it("delegates process signals to the coordinator instead of owning signal handlers", async () => {
    const { hasShutdownStep } = await import("@/lib/runtime/shutdownCoordinator.js");
    repoTest.ensureShutdownStep();

    const ownedListeners = ["beforeExit", "SIGINT", "SIGTERM", "exit"]
      .flatMap((event) => process.listeners(event).map((fn) => fn.name));
    expect(ownedListeners).not.toContain("_shutdownHandler");
    expect(hasShutdownStep("request-details")).toBe(true);
  });

  it("flushes request details before the coordinator closes the database", async () => {
    process.env.OBSERVABILITY_TIMSLITE_DATA_STORE = "true";
    const { ShutdownPhase, registerShutdownStep, runShutdown, __test__: coordTest } =
      await import("@/lib/runtime/shutdownCoordinator.js");

    coordTest.reset();
    repoTest.ensureShutdownStep();

    const events = [];
    const store = makeSpyStore({
      flush: vi.fn(async () => { events.push("repo-flush"); }),
    });
    repoTest.setStoreFactory(() => store);

    const unregisterClose = registerShutdownStep(
      "test-db-close",
      () => { events.push("db-close"); },
      { phase: ShutdownPhase.CLOSE }
    );

    try {
      await saveRequestDetail({ id: "coord-1", provider: "openai" });
      await runShutdown("test");

      expect(events).toContain("repo-flush");
      expect(events.indexOf("repo-flush")).toBeLessThan(events.indexOf("db-close"));
    } finally {
      unregisterClose();
    }
  });

  it("closes the store only after stage, Timslite flush, and the SQLite pointer transaction", async () => {
    process.env.OBSERVABILITY_TIMSLITE_DATA_STORE = "true";
    const events = [];
    const store = makeSpyStore({
      stage: vi.fn(async () => {
        events.push("stage");
        return { timslite_id: "1" };
      }),
      flush: vi.fn(async () => {
        events.push("timslite-flush");
      }),
      close: vi.fn(async () => {
        events.push("close");
      }),
    });
    repoTest.setStoreFactory(() => store);
    mockDbAdapter.transaction.mockImplementation((fn) => {
      events.push("sqlite-transaction");
      return fn();
    });

    await saveRequestDetail({ id: "order-1", provider: "openai" });
    await repoTest.shutdownNow();

    expect(events).toEqual(["stage", "timslite-flush", "sqlite-transaction", "close"]);
  });

  it("waits for an in-flight flush and drains records buffered during it before closing", async () => {
    process.env.OBSERVABILITY_TIMSLITE_DATA_STORE = "true";
    const events = [];
    let releaseFlush;
    const flushGate = new Promise((resolve) => {
      releaseFlush = resolve;
    });
    let stageCount = 0;
    let factoryCalls = 0;
    const store = makeSpyStore({
      stage: vi.fn(async () => {
        events.push("stage");
        stageCount += 1;
        return { timslite_id: String(stageCount) };
      }),
      flush: vi.fn(async () => {
        events.push("timslite-flush:start");
        await flushGate;
        events.push("timslite-flush:end");
      }),
      close: vi.fn(async () => {
        events.push("close");
      }),
    });
    repoTest.setStoreFactory(() => {
      factoryCalls += 1;
      return store;
    });
    mockDbAdapter.transaction.mockImplementation((fn) => {
      events.push("sqlite-transaction");
      return fn();
    });

    await saveRequestDetail({ id: "in-flight-1", provider: "openai" });
    const activeFlush = repoTest.flushNow();
    await vi.waitFor(() => expect(store.flush).toHaveBeenCalledTimes(1));

    await saveRequestDetail({ id: "during-flush", provider: "openai" });
    const shutdownPromise = repoTest.shutdownNow();

    releaseFlush();
    await activeFlush;
    await shutdownPromise;

    expect(store.flush).toHaveBeenCalledTimes(2);
    expect(store.close).toHaveBeenCalledTimes(1);
    expect(factoryCalls).toBe(1);

    const inserts = insertCalls();
    expect(inserts).toHaveLength(2);
    const pointerIds = inserts
      .map((call) => JSON.parse(call[1][call[1].length - 1]).timslite_id)
      .sort();
    expect(pointerIds).toEqual(["1", "2"]);

    const txIndexes = events
      .map((event, index) => (event === "sqlite-transaction" ? index : -1))
      .filter((index) => index !== -1);
    expect(txIndexes).toHaveLength(2);
    const closeIndex = events.indexOf("close");
    expect(closeIndex).toBeGreaterThan(txIndexes[txIndexes.length - 1]);
    expect(events[events.length - 1]).toBe("close");
  });
});
