import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let dbApi;
let adapter;
let processListeners;

const identity = (fingerprint) => ({
  fingerprint,
  clientLabel: fingerprint,
  clientFamily: "test",
  maskedNetwork: "203.0.113.*",
  ipSource: "socket",
});

beforeEach(async () => {
  processListeners = Object.fromEntries(
    ["beforeExit", "SIGINT", "SIGTERM"].map((event) => [event, new Set(process.listeners(event))]),
  );
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-api-client-buffer-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  vi.resetModules();
  dbApi = await import("@/lib/db/index.js");
  await dbApi.initDb();
  adapter = await import("@/lib/db/driver.js").then((module) => module.getAdapter());
});

afterEach(() => {
  dbApi?.clearAllPendingApiKeyClientActivity?.();
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  for (const [event, original] of Object.entries(processListeners)) {
    for (const listener of process.listeners(event)) {
      if (!original.has(listener)) process.removeListener(event, listener);
    }
  }
  vi.restoreAllMocks();
});

describe("API key client activity buffer", () => {
  it("rejects a 65th per-key fingerprint but keeps counting an admitted fingerprint", async () => {
    const key = await dbApi.createApiKey("bounded", "machine-bounded");

    for (let i = 0; i < 64; i += 1) {
      expect(await dbApi.recordApiKeyClientRequest(key.id, identity(`client-${i}`))).not.toBeNull();
    }
    expect(await dbApi.recordApiKeyClientRequest(key.id, identity("client-64"))).toBeNull();
    expect(await dbApi.recordApiKeyClientRequest(key.id, identity("client-0"))).not.toBeNull();

    await dbApi.flushApiKeyClientActivity();
    expect(adapter.get(`SELECT COUNT(*) AS count FROM apiKeyClients WHERE apiKeyId = ?`, [key.id]).count).toBe(64);
    expect(adapter.get(
      `SELECT requestCount FROM apiKeyClients WHERE apiKeyId = ? AND fingerprint = ?`,
      [key.id, "client-0"],
    ).requestCount).toBe(2);
  });

  it("rejects a 6,401st global fingerprint but keeps counting an admitted fingerprint", { timeout: 30000 }, async () => {
    adapter.transaction(() => {
      for (let i = 0; i <= 100; i += 1) {
        adapter.run(
          `INSERT INTO apiKeys(id, key, name, machineId, isActive, createdAt) VALUES(?, ?, ?, ?, 1, ?)`,
          [`key-${i}`, `secret-${i}`, `Key ${i}`, `machine-${i}`, new Date().toISOString()],
        );
      }
    });
    for (let i = 0; i < 6400; i += 1) {
      const apiKeyId = `key-${Math.floor(i / 64)}`;
      expect(await dbApi.recordApiKeyClientRequest(apiKeyId, identity(`client-${i}`))).not.toBeNull();
    }

    expect(await dbApi.recordApiKeyClientRequest("key-overflow", identity("overflow"))).toBeNull();
    expect(await dbApi.recordApiKeyClientRequest("key-0", identity("client-0"))).not.toBeNull();

    await dbApi.flushApiKeyClientActivity();
    expect(adapter.get(
      `SELECT requestCount FROM apiKeyClients WHERE apiKeyId = ? AND fingerprint = ?`,
      ["key-0", "client-0"],
    ).requestCount).toBe(2);
  });

  it("coalesces repeated requests into one transactional flush", async () => {
    const key = await dbApi.createApiKey("coalesced", "machine-coalesced");
    const transaction = vi.spyOn(adapter, "transaction");

    await dbApi.recordApiKeyClientRequest(key.id, identity("same-client"), "/v1/responses");
    await dbApi.recordApiKeyClientRequest(key.id, identity("same-client"), "/v1/responses");
    await dbApi.recordApiKeyClientRequest(key.id, identity("same-client"), "/v1/responses");

    expect(adapter.get(`SELECT COUNT(*) AS count FROM apiKeyClients`).count).toBe(0);
    await dbApi.flushApiKeyClientActivity();

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(adapter.get(`SELECT requestCount FROM apiKeyClients`).requestCount).toBe(3);
  });

  it("does not flush more than once within five seconds", async () => {
    const key = await dbApi.createApiKey("paced", "machine-paced");
    const transaction = vi.spyOn(adapter, "transaction");
    vi.spyOn(Date, "now").mockReturnValue(10_000);

    await dbApi.recordApiKeyClientRequest(key.id, identity("paced-client"));
    await dbApi.flushApiKeyClientActivity();
    await dbApi.recordApiKeyClientRequest(key.id, identity("paced-client"));
    await dbApi.flushApiKeyClientActivity();

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(adapter.get(`SELECT requestCount FROM apiKeyClients`).requestCount).toBe(1);
  });

  it("unrefs the one-shot flush timer", async () => {
    const key = await dbApi.createApiKey("timer", "machine-timer");
    const timer = { unref: vi.fn() };
    const setTimeout = vi.spyOn(globalThis, "setTimeout").mockReturnValue(timer);

    await dbApi.recordApiKeyClientRequest(key.id, identity("timer-client"));

    expect(setTimeout).toHaveBeenCalledWith(expect.any(Function), 5000);
    expect(timer.unref).toHaveBeenCalledOnce();
  });

  it("removes pending entries when their API key is deleted", async () => {
    const key = await dbApi.createApiKey("deleted", "machine-deleted");
    await dbApi.recordApiKeyClientRequest(key.id, identity("pending-client"));

    await dbApi.deleteApiKey(key.id);
    await dbApi.flushApiKeyClientActivity();

    expect(adapter.get(`SELECT COUNT(*) AS count FROM apiKeyClients`).count).toBe(0);
  });

  it("rejects activity arriving after its API key was deleted", async () => {
    const key = await dbApi.createApiKey("deleted-race", "machine-deleted-race");
    await dbApi.deleteApiKey(key.id);

    expect(await dbApi.recordApiKeyClientRequest(key.id, identity("late-client"))).toBeNull();
    await dbApi.flushApiKeyClientActivity();

    expect(adapter.get(`SELECT COUNT(*) AS count FROM apiKeyClients`).count).toBe(0);
  });

  it("prunes stale rows and keeps only the newest 64 durable clients per key", async () => {
    const key = await dbApi.createApiKey("durable", "machine-durable");
    const now = Date.now();
    const rows = Array.from({ length: 66 }, (_, i) => ({
      fingerprint: `fresh-${i}`,
      seen: new Date(now - i * 1000).toISOString(),
    }));
    rows.push({ fingerprint: "stale", seen: new Date(now - 61 * 24 * 60 * 60 * 1000).toISOString() });
    adapter.transaction(() => {
      for (const row of rows) {
        adapter.run(
          `INSERT INTO apiKeyClients(apiKeyId, fingerprint, firstSeen, lastSeen, requestCount) VALUES(?, ?, ?, ?, 1)`,
          [key.id, row.fingerprint, row.seen, row.seen],
        );
      }
    });

    await dbApi.getApiKeyClientActivity("all", new Date(now));

    expect(adapter.get(`SELECT COUNT(*) AS count FROM apiKeyClients WHERE apiKeyId = ?`, [key.id]).count).toBe(64);
    expect(adapter.get(
      `SELECT COUNT(*) AS count FROM apiKeyClients WHERE fingerprint = 'stale'`,
    ).count).toBe(0);
    expect(adapter.get(
      `SELECT COUNT(*) AS count FROM apiKeyClients WHERE fingerprint = 'fresh-65'`,
    ).count).toBe(0);
  });

  it("returns only the newest 2,000 rows and marks truncated output", { timeout: 30000 }, async () => {
    const now = Date.now();
    adapter.transaction(() => {
      for (let keyIndex = 0; keyIndex < 32; keyIndex += 1) {
        adapter.run(
          `INSERT INTO apiKeys(id, key, name, machineId, isActive, createdAt) VALUES(?, ?, ?, ?, 1, ?)`,
          [`bulk-${keyIndex}`, `secret-${keyIndex}`, `Bulk ${keyIndex}`, `machine-${keyIndex}`, new Date(now).toISOString()],
        );
      }
      for (let i = 0; i < 2001; i += 1) {
        const seen = new Date(now - (2000 - i) * 1000).toISOString();
        adapter.run(
          `INSERT INTO apiKeyClients(apiKeyId, fingerprint, firstSeen, lastSeen, requestCount) VALUES(?, ?, ?, ?, 1)`,
          [`bulk-${Math.floor(i / 64)}`, `bulk-client-${i}`, seen, seen],
        );
      }
    });

    const activity = await dbApi.getApiKeyClientActivity("all", new Date(now));

    expect(activity.clients).toHaveLength(2000);
    expect(activity.truncated).toBe(true);
    expect(activity.clients[0].clientLabel).toBe("Unknown client");
    expect(activity.clients[0].lastSeen).toBe(new Date(now).toISOString());
  });
});
