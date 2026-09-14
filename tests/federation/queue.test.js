// FED-004 — pendingWrites queue tests (spec §3.4).
//
// Covers (gitreins fed-004 criteria):
//  - enqueue: INSERT with generated idempotency key; dedupe by key (same key
//    → existing id, no duplicate); cap FEDERATION_QUEUE_MAX → 503
//  - payload shape: JSON { method, path, body }
//  - listPending FIFO ordering; markDone/markFailed state transitions
//  - replayBatch: 2xx → done; 409 → done (never retried); network error →
//    stays pending, batch stops; batch size respected
//  - DEGRADED write intercept: 202 + X-Federation-State: degraded +
//    X-Federation-Queued-Write-Id; queue full → 503 + X-Federation-State
//  - migration 004 idempotency: double-apply safe
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const FED_ENV_KEYS = [
  "FEDERATION_MODE",
  "FEDERATION_CENTRAL_URL",
  "FEDERATION_EDGE_ID",
  "FEDERATION_QUEUE_MAX",
  "FEDERATION_REPLAY_BATCH_SIZE",
  "FEDERATION_TOKEN",
];

let tempDir;
let savedEnv = {};
let savedDataDir;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-fed-queue-"));
  for (const k of FED_ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  savedDataDir = process.env.DATA_DIR;
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  vi.resetModules();
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  tempDir = null;
  for (const k of FED_ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  if (savedDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = savedDataDir;
});

function pointDriverAt(db) {
  if (!global._dbAdapter) global._dbAdapter = { instance: null, initPromise: null, logged: false };
  global._dbAdapter.instance = db;
  global._dbAdapter.initPromise = Promise.resolve(db);
  global._dbAdapter.logged = true;
}

async function createMigratedDb() {
  const { createBetterSqliteAdapter } = await import("@/lib/db/adapters/betterSqliteAdapter.js");
  const file = path.join(tempDir, `queue-${Math.random().toString(36).slice(2)}.sqlite`);
  const db = await createBetterSqliteAdapter(file);
  const { default: m001 } = await import("@/lib/db/migrations/001-initial.js");
  const { default: m002 } = await import("@/lib/db/migrations/002-federation.js");
  const { default: m003 } = await import("@/lib/db/migrations/003-federation-state.js");
  const { default: m004 } = await import("@/lib/db/migrations/004-federation-fencing.js");
  m001.up(db);
  m002.up(db);
  m003.up(db);
  m004.up(db);
  return db;
}

// ─── Enqueue + dedupe + cap ─────────────────────────────────────────────

describe("pendingWrites — enqueue (acceptance 2)", () => {
  it("enqueues with a generated idempotency key; payload carries method/path/body", async () => {
    const db = await createMigratedDb();
    const { enqueue, listPending } = await import("@/lib/federation/queue.js");

    const r = enqueue(db, { method: "PATCH", path: "/api/settings", body: { cloudEnabled: true } });
    expect(r.ok).toBe(true);
    expect(r.idempotencyKey).toBeTruthy();
    expect(r.queued).toBe(true);

    const rows = listPending(db);
    expect(rows).toHaveLength(1);
    expect(rows[0].payload).toEqual({ method: "PATCH", path: "/api/settings", body: { cloudEnabled: true } });
    expect(rows[0].state).toBe("pending");
    expect(rows[0].attempts).toBe(0);
  });

  it("dedupes by idempotency_key: same key → existing id, no duplicate row", async () => {
    const db = await createMigratedDb();
    const { enqueue, countPending } = await import("@/lib/federation/queue.js");

    const r1 = enqueue(db, { method: "PATCH", path: "/api/settings", body: { a: 1 }, idempotencyKey: "key-1" });
    const r2 = enqueue(db, { method: "PATCH", path: "/api/settings", body: { a: 2 }, idempotencyKey: "key-1" });
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    expect(r2.idempotencyKey).toBe("key-1");
    expect(r2.queued).toBe(false); // dedupe hit
    expect(countPending(db)).toBe(1);
    // Original payload preserved.
    const { listPending } = await import("@/lib/federation/queue.js");
    expect(listPending(db)[0].payload.body).toEqual({ a: 1 });
  });

  it("rejects with 503 when the queue is at FEDERATION_QUEUE_MAX", async () => {
    process.env.FEDERATION_QUEUE_MAX = "2";
    vi.resetModules();
    const db = await createMigratedDb();
    const { enqueue } = await import("@/lib/federation/queue.js");

    expect(enqueue(db, { method: "PATCH", path: "/api/settings", body: { a: 1 } }).ok).toBe(true);
    expect(enqueue(db, { method: "PATCH", path: "/api/settings", body: { a: 2 } }).ok).toBe(true);
    const full = enqueue(db, { method: "PATCH", path: "/api/settings", body: { a: 3 } });
    expect(full.ok).toBe(false);
    expect(full.status).toBe(503);
    expect(full.reason).toBe("queue full");
  });

  it("listPending is FIFO by created_at", async () => {
    const db = await createMigratedDb();
    const { enqueue, listPending } = await import("@/lib/federation/queue.js");
    // Distinct keys so the created_at ordering (not the key tie-break) decides.
    enqueue(db, { method: "PATCH", path: "/api/settings", body: { n: 1 }, idempotencyKey: "aaa-first" });
    enqueue(db, { method: "POST", path: "/api/keys", body: { name: "k" }, idempotencyKey: "zzz-second" });
    const rows = listPending(db);
    expect(rows).toHaveLength(2);
    expect(rows[0].payload.path).toBe("/api/settings");
    expect(rows[1].payload.path).toBe("/api/keys");
  });

  it("markDone / markFailed transition state and record last_error", async () => {
    const db = await createMigratedDb();
    const { enqueue, markDone, markFailed, listPending } = await import("@/lib/federation/queue.js");
    const k1 = enqueue(db, { method: "PATCH", path: "/api/settings", body: { a: 1 } }).idempotencyKey;
    const k2 = enqueue(db, { method: "PATCH", path: "/api/settings", body: { a: 2 } }).idempotencyKey;

    markDone(db, k1);
    markFailed(db, k2, "boom");
    const rows = listPending(db);
    expect(rows).toHaveLength(0); // both out of pending
    const all = db.all(`SELECT idempotency_key, state, attempts, last_error FROM pendingWrites ORDER BY idempotency_key`);
    const byKey = Object.fromEntries(all.map((r) => [r.idempotency_key, r]));
    expect(byKey[k1].state).toBe("done");
    expect(byKey[k2].state).toBe("failed");
    expect(byKey[k2].attempts).toBe(1);
    expect(byKey[k2].last_error).toBe("boom");
  });
});

// ─── Replay / drain ─────────────────────────────────────────────────────

describe("pendingWrites — replayBatch (acceptance 3)", () => {
  it("replays up to batchSize rows with idempotency keys + fencing token; 2xx → done", async () => {
    process.env.FEDERATION_MODE = "edge";
    process.env.FEDERATION_TOKEN = "fed-secret";
    process.env.FEDERATION_EDGE_ID = "edge-1";
    vi.resetModules();

    const db = await createMigratedDb();
    const { enqueue, replayBatch, countPending } = await import("@/lib/federation/queue.js");
    // Explicit keys: "aaa" sorts first (same-ms created_at → key tie-break).
    const k1 = enqueue(db, { method: "PATCH", path: "/api/settings", body: { a: 1 }, idempotencyKey: "aaa-first" }).idempotencyKey;
    const k2 = enqueue(db, { method: "POST", path: "/api/keys", body: { name: "k" }, idempotencyKey: "zzz-second" }).idempotencyKey;

    const seen = [];
    const fetchImpl = async (url, opts = {}) => {
      seen.push({ url, headers: opts.headers, body: JSON.parse(opts.body) });
      return { ok: true, status: 200, json: async () => ({ applied: true }) };
    };

    const result = await replayBatch(db, { fetchImpl, centralUrl: "http://127.0.0.1:9", batchSize: 1, fencingToken: "tok-9" });
    expect(result.replayed).toBe(1);
    expect(result.done).toBe(1);
    expect(result.stopped).toBe(false);
    expect(countPending(db)).toBe(1); // second row still pending (batch size 1)

    // Headers: Bearer token + edge id; body carries key + fence.
    expect(seen[0].headers.authorization).toBe("Bearer fed-secret");
    expect(seen[0].headers["x-federation-edge-id"]).toBe("edge-1");
    expect(seen[0].body.idempotency_key).toBe(k1);
    expect(seen[0].body.fencing_token).toBe("tok-9");

    // Second batch drains the rest.
    const result2 = await replayBatch(db, { fetchImpl, centralUrl: "http://127.0.0.1:9", batchSize: 1, fencingToken: "tok-9" });
    expect(result2.replayed).toBe(1);
    expect(seen[1].body.idempotency_key).toBe(k2);
    expect(countPending(db)).toBe(0);
  });

  it("409 without onStaleFence → marked failed (never silently dropped)", async () => {
    process.env.FEDERATION_MODE = "edge";
    process.env.FEDERATION_TOKEN = "fed-secret";
    vi.resetModules();

    const db = await createMigratedDb();
    const { enqueue, replayBatch, countPending } = await import("@/lib/federation/queue.js");
    enqueue(db, { method: "PATCH", path: "/api/settings", body: { a: 1 } });

    const fetchImpl = async () => ({ ok: false, status: 409, json: async () => ({ error: "Stale fencing token" }) });
    const result = await replayBatch(db, { fetchImpl, centralUrl: "http://127.0.0.1:9", fencingToken: "old" });
    expect(result.failed).toBe(1);
    expect(result.done).toBe(0);
    expect(countPending(db)).toBe(0);
    const row = db.get(`SELECT state, last_error FROM pendingWrites`);
    expect(row.state).toBe("failed");
    expect(row.last_error).toContain("409");
  });

  it("409 with onStaleFence → re-verify once, retry once; second 409 → failed, no loop", async () => {
    process.env.FEDERATION_MODE = "edge";
    process.env.FEDERATION_TOKEN = "fed-secret";
    vi.resetModules();

    const db = await createMigratedDb();
    const { enqueue, replayBatch, countPending } = await import("@/lib/federation/queue.js");
    enqueue(db, { method: "PATCH", path: "/api/settings", body: { a: 1 } });

    let replayCalls = 0;
    let verifyCalls = 0;
    const fetchImpl = async (url, opts = {}) => {
      if (url.endsWith("/api/federation/verify")) {
        verifyCalls += 1;
        return { ok: true, status: 200, json: async () => ({ ok: true, fencing_token: "fresh" }) };
      }
      replayCalls += 1;
      return { ok: false, status: 409, json: async () => ({ error: "Stale fencing token" }) };
    };

    const result = await replayBatch(db, {
      fetchImpl,
      centralUrl: "http://127.0.0.1:9",
      fencingToken: "old",
      onStaleFence: async () => {
        const hb = await fetchImpl("http://127.0.0.1:9/api/federation/verify");
        const body = await hb.json();
        return hb.ok ? body.fencing_token : null;
      },
    });
    expect(replayCalls).toBe(2); // original + exactly one retry
    expect(verifyCalls).toBe(1);
    expect(result.failed).toBe(1);
    expect(countPending(db)).toBe(0);
    const row = db.get(`SELECT state FROM pendingWrites`);
    expect(row.state).toBe("failed");
  });

  it("network error → row stays pending, batch stops", async () => {
    process.env.FEDERATION_MODE = "edge";
    process.env.FEDERATION_TOKEN = "fed-secret";
    vi.resetModules();

    const db = await createMigratedDb();
    const { enqueue, replayBatch, countPending } = await import("@/lib/federation/queue.js");
    enqueue(db, { method: "PATCH", path: "/api/settings", body: { a: 1 } });
    enqueue(db, { method: "PATCH", path: "/api/settings", body: { a: 2 } });

    const fetchImpl = async () => {
      throw new Error("ECONNREFUSED");
    };
    const result = await replayBatch(db, { fetchImpl, centralUrl: "http://127.0.0.1:9", fencingToken: "tok" });
    expect(result.replayed).toBe(0);
    expect(result.stopped).toBe(true);
    expect(countPending(db)).toBe(2);
  });

  it("non-409 4xx/5xx → marked failed with last_error, batch continues", async () => {
    process.env.FEDERATION_MODE = "edge";
    process.env.FEDERATION_TOKEN = "fed-secret";
    vi.resetModules();

    const db = await createMigratedDb();
    const { enqueue, replayBatch, countPending } = await import("@/lib/federation/queue.js");
    // Explicit keys so the batch order is deterministic (same-ms created_at).
    const k1 = enqueue(db, { method: "PATCH", path: "/api/settings", body: { a: 1 }, idempotencyKey: "aaa-first" }).idempotencyKey;
    const k2 = enqueue(db, { method: "PATCH", path: "/api/settings", body: { a: 2 }, idempotencyKey: "zzz-second" }).idempotencyKey;

    const fetchImpl = async (url, opts = {}) => {
      const body = JSON.parse(opts.body);
      if (body.idempotency_key === k1) {
        return { ok: false, status: 400, json: async () => ({ error: "name is required" }) };
      }
      return { ok: true, status: 200, json: async () => ({ applied: true }) };
    };

    const result = await replayBatch(db, { fetchImpl, centralUrl: "http://127.0.0.1:9", fencingToken: "tok" });
    expect(result.failed).toBe(1);
    expect(result.done).toBe(1);
    expect(countPending(db)).toBe(0);
    const row = db.get(`SELECT last_error FROM pendingWrites WHERE idempotency_key = ?`, [k1]);
    expect(row.last_error).toBe("name is required");
  });
});

// ─── DEGRADED write intercept ────────────────────────────────────────────

describe("pendingWrites — DEGRADED write intercept (acceptance 2)", () => {
  function startEdgeServer({ db, queueMax }) {
    const server = http.createServer(async (req, res) => {
      const { handleDegradedWrite } = await import("@/lib/federation/queue.js");
      handleDegradedWrite(req, res, db);
    });
    return new Promise((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        resolve({
          port: server.address().port,
          close: () => new Promise((r) => server.close(r)),
        });
      });
    });
  }

  function httpPost(port, path, body) {
    return new Promise((resolve, reject) => {
      const req = http.request(
        { host: "127.0.0.1", port, path, method: "POST", headers: { "Content-Type": "application/json" } },
        (res) => {
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () =>
            resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") })
          );
        }
      );
      req.on("error", reject);
      req.end(JSON.stringify(body));
    });
  }

  it("queues the write and responds 202 with X-Federation-State + X-Federation-Queued-Write-Id", async () => {
    const db = await createMigratedDb();
    const { countPending } = await import("@/lib/federation/queue.js");
    const server = await startEdgeServer({ db });

    try {
      const resp = await httpPost(server.port, "/api/settings", { cloudEnabled: true });
      expect(resp.status).toBe(202);
      expect(resp.headers["x-federation-state"]).toBe("degraded");
      expect(resp.headers["x-federation-queued-write-id"]).toBeTruthy();
      expect(countPending(db)).toBe(1);
      const parsed = JSON.parse(resp.body);
      expect(parsed.queued).toBe(true);
      expect(parsed.idempotencyKey).toBe(resp.headers["x-federation-queued-write-id"]);
    } finally {
      await server.close();
    }
  });

  it("queue full → 503 with X-Federation-State: degraded", async () => {
    process.env.FEDERATION_QUEUE_MAX = "1";
    vi.resetModules();
    const db = await createMigratedDb();
    const server = await startEdgeServer({ db });

    try {
      const first = await httpPost(server.port, "/api/settings", { a: 1 });
      expect(first.status).toBe(202);
      const second = await httpPost(server.port, "/api/settings", { a: 2 });
      expect(second.status).toBe(503);
      expect(second.headers["x-federation-state"]).toBe("degraded");
      expect(JSON.parse(second.body).error.code).toBe("FED_QUEUE_FULL");
    } finally {
      await server.close();
    }
  });
});

// ─── Migration 004 idempotency ───────────────────────────────────────────

describe("migration 004 idempotency", () => {
  it("double-apply is safe; adds fencing_token + last_error + replayLog", async () => {
    const db = await createMigratedDb();
    const { default: m004 } = await import("@/lib/db/migrations/004-federation-fencing.js");

    const metaCols = db.all(`PRAGMA table_info(federation_meta)`).map((c) => c.name);
    expect(metaCols).toContain("fencing_token");
    const pwCols = db.all(`PRAGMA table_info(pendingWrites)`).map((c) => c.name);
    expect(pwCols).toContain("last_error");
    const tables = db.all(`SELECT name FROM sqlite_master WHERE type='table'`).map((t) => t.name);
    expect(tables).toContain("replayLog");

    // Second apply must be a no-op success.
    expect(() => m004.up(db)).not.toThrow();
    expect(() => m004.up(db)).not.toThrow();
  });
});
