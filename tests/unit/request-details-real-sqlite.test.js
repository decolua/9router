import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/repos/settingsRepo.js", () => ({
  getSettings: vi.fn().mockResolvedValue({
    enableObservability: true,
    observabilityBatchSize: 1,
    observabilityMaxRecords: 200,
  }),
}));

describe("requestDetailsRepo real SQLite binds", () => {
  const originalDataDir = process.env.DATA_DIR;
  let tempDir;
  let adapter;

  afterEach(async () => {
    try {
      const repo = await import("@/lib/db/repos/requestDetailsRepo.js");
      await repo.__test__.shutdownNow();
    } finally {
      adapter?.close();
      adapter = null;
      delete global._dbAdapter;
      delete process.env.OBSERVABILITY_TIMSLITE_DATA_STORE;
      if (originalDataDir === undefined) delete process.env.DATA_DIR;
      else process.env.DATA_DIR = originalDataDir;
      if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
      vi.resetModules();
    }
  });

  it("saves an exact Timslite pointer with omitted optional metadata on node:sqlite", async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-real-bind-"));
    process.env.DATA_DIR = tempDir;
    process.env.OBSERVABILITY_TIMSLITE_DATA_STORE = "true";
    const { createNodeSqliteAdapter } = await import("@/lib/db/adapters/nodeSqliteAdapter.js");
    adapter = await createNodeSqliteAdapter(path.join(tempDir, "bind-test.db"));
    adapter.exec(`CREATE TABLE requestDetails (
      id TEXT PRIMARY KEY, timestamp TEXT NOT NULL, provider TEXT, model TEXT,
      connectionId TEXT, status TEXT, data TEXT NOT NULL
    )`);
    global._dbAdapter = { instance: adapter, initPromise: Promise.resolve(adapter), logged: true };
    vi.resetModules();
    const repo = await import("@/lib/db/repos/requestDetailsRepo.js");
    repo.__test__.setStoreFactory(() => ({
      enabled: true,
      async stage() { return { timslite_id: "1726480000000000" }; },
      async flush() {},
      async discard() {},
      async close() {},
      async getMany() { return new Map(); },
    }));

    await repo.saveRequestDetail({ id: "real-bind", request: { body: "hello" } });
    await repo.__test__.flushNow();

    const row = adapter.get("SELECT provider, model, connectionId, status, data FROM requestDetails WHERE id = ?", ["real-bind"]);
    expect(row.provider).toBeNull();
    expect(row.model).toBeNull();
    expect(row.connectionId).toBeNull();
    expect(row.status).toBeNull();
    expect(row.data).toBe('{"timslite_id":"1726480000000000"}');
  });

  it("writes and hydrates through one real Timslite writer while it remains open", async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-real-timslite-"));
    process.env.DATA_DIR = tempDir;
    process.env.OBSERVABILITY_TIMSLITE_DATA_STORE = "true";
    const { createNodeSqliteAdapter } = await import("@/lib/db/adapters/nodeSqliteAdapter.js");
    adapter = await createNodeSqliteAdapter(path.join(tempDir, "timslite-test.db"));
    adapter.exec(`CREATE TABLE requestDetails (
      id TEXT PRIMARY KEY, timestamp TEXT NOT NULL, provider TEXT, model TEXT,
      connectionId TEXT, status TEXT, data TEXT NOT NULL
    )`);
    global._dbAdapter = { instance: adapter, initPromise: Promise.resolve(adapter), logged: true };
    vi.resetModules();
    const repo = await import("@/lib/db/repos/requestDetailsRepo.js");

    await repo.saveRequestDetail({
      id: "real-timslite",
      request: { headers: { authorization: "secret", "x-safe": "visible" }, body: "hello" },
    });
    await repo.__test__.flushNow();

    const row = adapter.get("SELECT data FROM requestDetails WHERE id = ?", ["real-timslite"]);
    expect(JSON.parse(row.data)).toEqual({ timslite_id: expect.stringMatching(/^\d+$/) });
    const hydrated = await repo.getRequestDetailById("real-timslite");
    expect(hydrated.request).toEqual({ headers: { "x-safe": "visible" }, body: "hello" });
    expect(hydrated.timslite_id).toBe(JSON.parse(row.data).timslite_id);
  });
});
