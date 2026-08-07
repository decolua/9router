// FED-004 — failover state machine tests (spec §3.4).
//
// Covers (gitreins fed-004 criteria):
//  - outage flip: heartbeat failures spanning the jittered threshold flip
//    the edge to DEGRADED, persisted in federation_meta.last_state
//  - jitter: the flip happens within [0.8×, 1.2×] threshold of failure
//    accumulation (deterministic jitter injection)
//  - immediate flip: proxy upstream 502 → state flips to DEGRADED
//  - recovery: heartbeat success → RECOVERING → drain (batched, idempotent,
//    409-stale rejected) → catch up deltas → LINKED
//  - fencing: central rejects stale fencing token → 409; fresh token
//    accepted; central dedupes repeat idempotency_key → no double-apply
//  - edge client auth: pullOnce sends Authorization: Bearer <token>
//  - standalone no-op: failover.start() returns null; setEdgeState never
//    called; zero drift
//  - no self-promotion: failover never writes federation_meta.role
//
// All timers are fake (vi.useFakeTimers) and the clock is injectable — no
// real sleeps.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const FED_ENV_KEYS = [
  "FEDERATION_MODE",
  "FEDERATION_CENTRAL_URL",
  "FEDERATION_EDGE_ID",
  "FEDERATION_SYNC_INTERVAL_MS",
  "FEDERATION_HEARTBEAT_INTERVAL_MS",
  "FEDERATION_OUTAGE_THRESHOLD_MS",
  "FEDERATION_QUEUE_MAX",
  "FEDERATION_REPLAY_BATCH_SIZE",
  "FEDERATION_TOKEN",
];

let tempDir;
let savedEnv = {};
let savedDataDir;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-fed-failover-"));
  for (const k of FED_ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  savedDataDir = process.env.DATA_DIR;
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  vi.useFakeTimers();
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
  vi.useRealTimers();
});

// Point the DB driver at a specific adapter (mutate in place — driver.js
// captures the object at module load).
function pointDriverAt(db) {
  if (!global._dbAdapter) global._dbAdapter = { instance: null, initPromise: null, logged: false };
  global._dbAdapter.instance = db;
  global._dbAdapter.initPromise = Promise.resolve(db);
  global._dbAdapter.logged = true;
}

async function createMigratedDb() {
  const { createBetterSqliteAdapter } = await import("@/lib/db/adapters/betterSqliteAdapter.js");
  const file = path.join(tempDir, `failover-${Math.random().toString(36).slice(2)}.sqlite`);
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

// A fetch stub that records calls and returns a scripted response. When the
// script is exhausted, subsequent calls throw (network down) — safe default.
function scriptedFetch(script) {
  const calls = [];
  const fn = async (url, opts = {}) => {
    calls.push({ url, opts });
    const entry = script.shift();
    if (entry === undefined) throw new Error("network down (script exhausted)");
    if (entry instanceof Error) throw entry;
    if (entry && entry.status !== undefined) {
      return {
        ok: entry.status >= 200 && entry.status < 300,
        status: entry.status,
        json: async () => entry.body || {},
      };
    }
    return { ok: true, status: 200, json: async () => entry || {} };
  };
  fn.calls = calls;
  return fn;
}

// ─── Outage flip + jitter ────────────────────────────────────────────────

describe("failover — outage flip (acceptance 1)", () => {
  it("flips to DEGRADED after failures span the jittered threshold; persists last_state", async () => {
    process.env.FEDERATION_MODE = "edge";
    process.env.FEDERATION_TOKEN = "fed-secret";
    process.env.FEDERATION_EDGE_ID = "edge-1";
    vi.resetModules();

    const db = await createMigratedDb();
    pointDriverAt(db);
    const { getEdgeState } = await import("@/lib/federation/state.js");
    const { start } = await import("@/lib/federation/failover.js");

    // Deterministic jitter: exactly 1.0 → threshold applies unmodified.
    const fetchImpl = scriptedFetch([new Error("down"), new Error("down"), new Error("down")]);
    let clock = 0;
    const timer = start({
      fetchImpl,
      centralUrl: "http://127.0.0.1:1",
      intervalMs: 1000,
      thresholdMs: 5000,
      jitter: () => 1.0,
      now: () => clock,
      db,
      backoffBaseMs: 1000,
      backoffCapMs: 1000,
    });
    expect(timer).not.toBeNull();

    // First heartbeat fires on the next macrotask (delay 0).
    await vi.advanceTimersByTimeAsync(0);
    expect(getEdgeState(db)).toBe("linked");

    // Failures at t=0, t=1000, t=2000, t=3000, t=4000, t=5000 → span 5000ms.
    for (let i = 1; i <= 5; i++) {
      clock = i * 1000;
      await vi.advanceTimersByTimeAsync(1000);
    }
    // At t=5000 the span (5000 - 0) >= 5000 → DEGRADED.
    expect(getEdgeState(db)).toBe("degraded");
    const row = db.get(`SELECT last_state FROM federation_meta WHERE id = 1`);
    expect(row.last_state).toBe("degraded");

    // No self-promotion: role untouched.
    expect(db.get(`SELECT role FROM federation_meta WHERE id = 1`).role).toBeNull();
  });

  it("jitter bounds: flip happens within [0.8×, 1.2×] threshold of failure accumulation", async () => {
    process.env.FEDERATION_MODE = "edge";
    process.env.FEDERATION_TOKEN = "fed-secret";
    vi.resetModules();

    const db = await createMigratedDb();
    pointDriverAt(db);
    const { getEdgeState } = await import("@/lib/federation/state.js");
    const { start } = await import("@/lib/federation/failover.js");

    // Jitter 0.8 → threshold 4000ms; failures at 0..4000 → flip at t=4000.
    const fetchImpl = scriptedFetch([new Error("down"), new Error("down"), new Error("down"), new Error("down"), new Error("down")]);
    let clock = 0;
    const timer = start({
      fetchImpl,
      centralUrl: "http://127.0.0.1:1",
      intervalMs: 1000,
      thresholdMs: 5000,
      jitter: () => 0.8,
      now: () => clock,
      db,
      backoffBaseMs: 1000,
      backoffCapMs: 1000,
    });
    expect(timer).not.toBeNull();

    await vi.advanceTimersByTimeAsync(0);
    for (let i = 1; i <= 3; i++) {
      clock = i * 1000;
      await vi.advanceTimersByTimeAsync(1000);
    }
    // t=3000: span 3000 < 4000 → still LINKED.
    expect(getEdgeState(db)).toBe("linked");
    clock = 4000;
    await vi.advanceTimersByTimeAsync(1000);
    // t=4000: span 4000 >= 4000 → DEGRADED (0.8× bound).
    expect(getEdgeState(db)).toBe("degraded");
  });

  it("stays LINKED while failures are below the jittered threshold", async () => {
    process.env.FEDERATION_MODE = "edge";
    process.env.FEDERATION_TOKEN = "fed-secret";
    vi.resetModules();

    const db = await createMigratedDb();
    pointDriverAt(db);
    const { getEdgeState } = await import("@/lib/federation/state.js");
    const { start } = await import("@/lib/federation/failover.js");

    // Jitter 1.2 → threshold 6000ms; only 3 failures (span 3000) → LINKED.
    const fetchImpl = scriptedFetch([new Error("down"), new Error("down"), new Error("down")]);
    let clock = 0;
    const timer = start({
      fetchImpl,
      centralUrl: "http://127.0.0.1:1",
      intervalMs: 1000,
      thresholdMs: 5000,
      jitter: () => 1.2,
      now: () => clock,
      db,
      backoffBaseMs: 1000,
      backoffCapMs: 1000,
    });
    expect(timer).not.toBeNull();

    await vi.advanceTimersByTimeAsync(0);
    for (let i = 1; i <= 3; i++) {
      clock = i * 1000;
      await vi.advanceTimersByTimeAsync(1000);
    }
    expect(getEdgeState(db)).toBe("linked");
  });

  it("resets the failure streak on a successful heartbeat while LINKED", async () => {
    process.env.FEDERATION_MODE = "edge";
    process.env.FEDERATION_TOKEN = "fed-secret";
    vi.resetModules();

    const db = await createMigratedDb();
    pointDriverAt(db);
    const { getEdgeState } = await import("@/lib/federation/state.js");
    const { start } = await import("@/lib/federation/failover.js");

    // Two failures, then success, then two more failures — never reaches
    // threshold because the streak resets.
    const fetchImpl = scriptedFetch([
      new Error("down"),
      new Error("down"),
      { ok: true, fencing_token: "tok-1" },
      new Error("down"),
      new Error("down"),
    ]);
    let clock = 0;
    const timer = start({
      fetchImpl,
      centralUrl: "http://127.0.0.1:1",
      intervalMs: 1000,
      thresholdMs: 5000,
      jitter: () => 1.0,
      now: () => clock,
      db,
      backoffBaseMs: 1000,
      backoffCapMs: 1000,
    });
    expect(timer).not.toBeNull();

    await vi.advanceTimersByTimeAsync(0);
    for (let i = 1; i <= 4; i++) {
      clock = i * 1000;
      await vi.advanceTimersByTimeAsync(1000);
    }
    // Failures at 0,1000 (streak 2), success at 2000 (reset), failures at
    // 3000,4000 (streak 2) — span since reset is 1000 < 5000 → LINKED.
    expect(getEdgeState(db)).toBe("linked");
  });
});

// ─── Immediate flip via proxy 502 ────────────────────────────────────────

describe("failover — immediate flip on proxy 502 (acceptance 1)", () => {
  it("proxy upstream failure invokes onUpstreamFailure → state flips to DEGRADED", async () => {
    process.env.FEDERATION_MODE = "edge";
    process.env.FEDERATION_TOKEN = "fed-secret";
    vi.resetModules();

    const db = await createMigratedDb();
    pointDriverAt(db);
    const { getEdgeState } = await import("@/lib/federation/state.js");
    const { flipToDegraded } = await import("@/lib/federation/failover.js");
    const { proxyRequest } = await import("@/lib/federation/proxy.js");

    // Real edge server pair: central at port 1 (connection refused) →
    // proxyRequest's transport throws → 502 + onUpstreamFailure fires.
    const server = http.createServer(async (req, res) => {
      const handled = await proxyRequest(req, res, {
        getState: () => "linked",
        centralUrl: "http://127.0.0.1:1",
        token: "fed-secret",
        onUpstreamFailure: () => flipToDegraded({ db }),
        localHandler: null,
      });
      if (!handled) res.end("LOCAL");
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const port = server.address().port;

    try {
      const resp = await new Promise((resolve, reject) => {
        const req = http.request({ host: "127.0.0.1", port, path: "/v1/chat/completions", method: "POST" }, (res) => {
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
        });
        req.on("error", reject);
        req.end("{}");
      });
      expect(resp.status).toBe(502);
      // The flip is fire-and-forget; give the microtask queue a beat.
      await vi.advanceTimersByTimeAsync(20);
      expect(getEdgeState(db)).toBe("degraded");
    } finally {
      await new Promise((r) => server.close(r));
    }
  });

  it("flipToDegraded does not yank RECOVERING back to DEGRADED", async () => {
    process.env.FEDERATION_MODE = "edge";
    vi.resetModules();
    const db = await createMigratedDb();
    pointDriverAt(db);
    const { setEdgeState } = await import("@/lib/federation/state.js");
    const { flipToDegraded } = await import("@/lib/federation/failover.js");

    setEdgeState(db, "recovering");
    const result = await flipToDegraded({ db });
    expect(result).toBe("recovering");
    expect(db.get(`SELECT last_state FROM federation_meta WHERE id = 1`).last_state).toBe("recovering");
  });
});

// ─── Recovery: drain → catch up → LINKED ────────────────────────────────

describe("failover — recovery (acceptance 3)", () => {
  it("heartbeat success while DEGRADED → RECOVERING → drain → catch up → LINKED", async () => {
    process.env.FEDERATION_MODE = "edge";
    process.env.FEDERATION_TOKEN = "fed-secret";
    process.env.FEDERATION_EDGE_ID = "edge-1";
    vi.resetModules();

    const db = await createMigratedDb();
    pointDriverAt(db);
    const { setEdgeState } = await import("@/lib/federation/state.js");
    const { start } = await import("@/lib/federation/failover.js");
    const { enqueue } = await import("@/lib/federation/queue.js");
    // Pre-import edgeClient so recover()'s dynamic import resolves from the
    // module cache as a microtask (deterministic under fake timers).
    await import("@/lib/federation/edgeClient.js");

    // Seed the queue with one write.
    const queued = enqueue(db, { method: "PATCH", path: "/api/settings", body: { cloudEnabled: true } });
    expect(queued.ok).toBe(true);
    setEdgeState(db, "degraded");

    // Scripted fetch: heartbeat OK (with fencing token), replay 200,
    // delta catch-up OK (empty delta payload).
    const replayBodies = [];
    const fetchImpl = async (url, opts = {}) => {
      if (url.endsWith("/api/federation/verify")) {
        return { ok: true, status: 200, json: async () => ({ ok: true, fencing_token: "tok-1", schemaVersion: 4, revision: 0 }) };
      }
      if (url.endsWith("/api/federation/replay")) {
        replayBodies.push(JSON.parse(opts.body));
        return { ok: true, status: 200, json: async () => ({ applied: true }) };
      }
      if (url.includes("/api/federation/delta") || url.includes("/api/federation/snapshot")) {
        return { ok: true, status: 200, json: async () => ({ rows: [], tombstones: [], maxVersion: 0, schemaVersion: 4 }) };
      }
      throw new Error(`unexpected fetch ${url}`);
    };

    let clock = 0;
    const timer = start({
      fetchImpl,
      centralUrl: "http://127.0.0.1:9",
      intervalMs: 1000,
      thresholdMs: 5000,
      jitter: () => 1.0,
      now: () => clock,
      db,
      backoffBaseMs: 1000,
      backoffCapMs: 1000,
    });
    expect(timer).not.toBeNull();

    await vi.advanceTimersByTimeAsync(0);
    // The recovery chain includes a dynamic import (macrotask hop) — flush
    // until the state settles (bounded; no real sleeps).
    for (let i = 0; i < 10; i++) {
      if (db.get(`SELECT last_state FROM federation_meta WHERE id = 1`).last_state === "linked") break;
      await vi.advanceTimersByTimeAsync(0);
    }
    // Heartbeat OK while DEGRADED → RECOVERING → drain → LINKED.
    expect(db.get(`SELECT last_state FROM federation_meta WHERE id = 1`).last_state).toBe("linked");

    // The write was replayed with the fencing token + idempotency key.
    expect(replayBodies).toHaveLength(1);
    expect(replayBodies[0].fencing_token).toBe("tok-1");
    expect(replayBodies[0].idempotency_key).toBe(queued.idempotencyKey);
    expect(replayBodies[0].method).toBe("PATCH");
    expect(replayBodies[0].path).toBe("/api/settings");
    expect(replayBodies[0].body).toEqual({ cloudEnabled: true });

    // Queue drained.
    const { countPending } = await import("@/lib/federation/queue.js");
    expect(countPending(db)).toBe(0);
  });

  it("409 without re-verify → marked failed (never silently dropped); network error → stays pending", async () => {
    process.env.FEDERATION_MODE = "edge";
    process.env.FEDERATION_TOKEN = "fed-secret";
    vi.resetModules();

    const db = await createMigratedDb();
    pointDriverAt(db);
    const { setEdgeState } = await import("@/lib/federation/state.js");
    const { enqueue, countPending, listPending } = await import("@/lib/federation/queue.js");
    const { recover } = await import("@/lib/federation/failover.js");

    const k1 = enqueue(db, { method: "PATCH", path: "/api/settings", body: { a: 1 }, idempotencyKey: "aaa-first" }).idempotencyKey;
    const k2 = enqueue(db, { method: "PATCH", path: "/api/settings", body: { b: 2 }, idempotencyKey: "zzz-second" }).idempotencyKey;
    setEdgeState(db, "degraded");

    // First replay → 409 (stale fence, no re-verify possible — heartbeat
    // also fails); second → network error.
    const fetchImpl = async (url, opts = {}) => {
      if (url.endsWith("/api/federation/replay")) {
        const body = JSON.parse(opts.body);
        if (body.idempotency_key === k1) {
          return { ok: false, status: 409, json: async () => ({ error: "Stale fencing token" }) };
        }
        throw new Error("network down");
      }
      if (url.endsWith("/api/federation/verify")) {
        throw new Error("central down");
      }
      throw new Error(`unexpected fetch ${url}`);
    };

    const result = await recover({ fetchImpl, centralUrl: "http://127.0.0.1:9", db, fencingToken: "tok-1" });
    // 409 (re-verify failed) → marked failed, not dropped; network error →
    // stopped, k2 stays pending.
    expect(result.failed).toBe(1);
    expect(result.stopped).toBe(true);
    expect(countPending(db)).toBe(1);
    const remaining = listPending(db);
    expect(remaining[0].idempotency_key).toBe(k2);
    const failedRow = db.get(`SELECT state, last_error FROM pendingWrites WHERE idempotency_key = ?`, [k1]);
    expect(failedRow.state).toBe("failed");
    expect(failedRow.last_error).toContain("409");
    // State stays DEGRADED (recover() only sets LINKED on full success).
    expect(db.get(`SELECT last_state FROM federation_meta WHERE id = 1`).last_state).toBe("degraded");
  });

  it("409 → re-verify once for a fresh token → retry succeeds → done", async () => {
    process.env.FEDERATION_MODE = "edge";
    process.env.FEDERATION_TOKEN = "fed-secret";
    vi.resetModules();

    const db = await createMigratedDb();
    pointDriverAt(db);
    const { setEdgeState } = await import("@/lib/federation/state.js");
    const { enqueue, countPending } = await import("@/lib/federation/queue.js");
    const { recover } = await import("@/lib/federation/failover.js");

    enqueue(db, { method: "PATCH", path: "/api/settings", body: { a: 1 }, idempotencyKey: "aaa-first" });
    setEdgeState(db, "degraded");

    let replayCalls = 0;
    const fetchImpl = async (url, opts = {}) => {
      if (url.endsWith("/api/federation/verify")) {
        return { ok: true, status: 200, json: async () => ({ ok: true, fencing_token: "fresh-token", schemaVersion: 4, revision: 0 }) };
      }
      if (url.endsWith("/api/federation/replay")) {
        replayCalls += 1;
        const body = JSON.parse(opts.body);
        if (replayCalls === 1) {
          expect(body.fencing_token).toBe("tok-1"); // stale token first
          return { ok: false, status: 409, json: async () => ({ error: "Stale fencing token" }) };
        }
        expect(body.fencing_token).toBe("fresh-token"); // re-verified token
        return { ok: true, status: 200, json: async () => ({ applied: true }) };
      }
      if (url.includes("/api/federation/snapshot") || url.includes("/api/federation/delta")) {
        return { ok: true, status: 200, json: async () => ({ tables: {}, maxVersion: 0, schemaVersion: 4 }) };
      }
      throw new Error(`unexpected fetch ${url}`);
    };

    const result = await recover({ fetchImpl, centralUrl: "http://127.0.0.1:9", db, fencingToken: "tok-1" });
    expect(result.done).toBe(1);
    expect(result.failed).toBe(0);
    expect(replayCalls).toBe(2); // exactly one retry, no loop
    expect(countPending(db)).toBe(0);
    expect(db.get(`SELECT last_state FROM federation_meta WHERE id = 1`).last_state).toBe("linked");
  });

  it("recovery catches up deltas before LINKED (pullOnce invoked)", async () => {
    process.env.FEDERATION_MODE = "edge";
    process.env.FEDERATION_TOKEN = "fed-secret";
    vi.resetModules();

    const db = await createMigratedDb();
    pointDriverAt(db);
    const { setEdgeState } = await import("@/lib/federation/state.js");
    const { recover } = await import("@/lib/federation/failover.js");

    setEdgeState(db, "degraded");
    const urls = [];
    const fetchImpl = async (url, opts = {}) => {
      urls.push(url);
      if (url.endsWith("/api/federation/replay")) {
        return { ok: true, status: 200, json: async () => ({ applied: true }) };
      }
      if (url.includes("/api/federation/snapshot")) {
        // Empty snapshot (fresh central) — apply is a no-op but advances.
        return { ok: true, status: 200, json: async () => ({ tables: {}, maxVersion: 0, schemaVersion: 4 }) };
      }
      throw new Error(`unexpected fetch ${url}`);
    };

    const result = await recover({ fetchImpl, centralUrl: "http://127.0.0.1:9", db, fencingToken: "tok-1" });
    expect(result.caughtUp).toBe(true);
    expect(result.linked).toBe(true);
    expect(urls.some((u) => u.includes("/api/federation/snapshot") || u.includes("/api/federation/delta"))).toBe(true);
    expect(db.get(`SELECT last_state FROM federation_meta WHERE id = 1`).last_state).toBe("linked");
  });
});

// ─── Fencing (central side) ─────────────────────────────────────────────

describe("failover — fencing (acceptance 3)", () => {
  it("central rejects a stale fencing token with 409; fresh token accepted", async () => {
    process.env.FEDERATION_MODE = "central";
    process.env.FEDERATION_TOKEN = "fed-secret";
    vi.resetModules();

    const db = await createMigratedDb();
    pointDriverAt(db);
    const { handleVerify, handleReplay, HttpError } = await import("@/lib/federation/server.js");

    // First verify issues token A.
    const v1 = await handleVerify({ headers: { get: () => "edge-1" } });
    expect(v1.fencing_token).toBeTruthy();
    expect(v1.leaseOwner).toBe("edge-1");
    expect(v1.leaseExpiry).toBeTruthy();

    // Replay with a stale token → 409.
    const staleReq = {
      json: async () => ({ idempotency_key: "k-stale", method: "PATCH", path: "/api/settings", body: { a: 1 }, fencing_token: "old-token" }),
    };
    await expect(handleReplay(staleReq)).rejects.toMatchObject({ status: 409 });

    // Replay with the current token → applied.
    const okReq = {
      json: async () => ({ idempotency_key: "k-1", method: "PATCH", path: "/api/settings", body: { cloudEnabled: true }, fencing_token: v1.fencing_token }),
    };
    const applied = await handleReplay(okReq);
    expect(applied.applied).toBe(true);
    expect(db.get(`SELECT data FROM settings WHERE id = 1`).data).toContain("cloudEnabled");

    // Repeat the same idempotency key → 200 no-op, NOT double-applied.
    const dupReq = {
      json: async () => ({ idempotency_key: "k-1", method: "PATCH", path: "/api/settings", body: { cloudEnabled: false }, fencing_token: v1.fencing_token }),
    };
    const dup = await handleReplay(dupReq);
    expect(dup.applied).toBe(false);
    expect(dup.duplicate).toBe(true);
    // The original value is untouched (no double-apply).
    expect(db.get(`SELECT data FROM settings WHERE id = 1`).data).toContain("cloudEnabled");
  });

  it("replay is central-only (edge mode → 403)", async () => {
    process.env.FEDERATION_MODE = "edge";
    process.env.FEDERATION_TOKEN = "fed-secret";
    vi.resetModules();

    const db = await createMigratedDb();
    pointDriverAt(db);
    const { handleReplay, HttpError } = await import("@/lib/federation/server.js");
    await expect(handleReplay({ json: async () => ({}) })).rejects.toMatchObject({ status: 403 });
  });
});

// ─── Edge client auth ────────────────────────────────────────────────────

describe("edgeClient auth (FED-004 gap fix)", () => {
  it("pullOnce sends Authorization: Bearer <token> + x-federation-edge-id", async () => {
    process.env.FEDERATION_MODE = "edge";
    process.env.FEDERATION_TOKEN = "fed-secret";
    process.env.FEDERATION_EDGE_ID = "edge-42";
    vi.resetModules();

    const db = await createMigratedDb();
    pointDriverAt(db);
    const { pullOnce } = await import("@/lib/federation/edgeClient.js");

    const seen = [];
    const fetchImpl = async (url, opts = {}) => {
      seen.push({ url, headers: opts.headers });
      return { ok: true, status: 200, json: async () => ({ tables: {}, maxVersion: 0, schemaVersion: 4 }) };
    };

    const result = await pullOnce({ fetchImpl, centralUrl: "http://127.0.0.1:9" });
    expect(result.ok).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0].headers.authorization).toBe("Bearer fed-secret");
    expect(seen[0].headers["x-federation-edge-id"]).toBe("edge-42");
  });
});

// ─── Standalone no-op ───────────────────────────────────────────────────

describe("failover — standalone no-op (zero drift)", () => {
  it("start() returns null in standalone mode; no state writes", async () => {
    vi.resetModules(); // FEDERATION_MODE unset
    const db = await createMigratedDb();
    pointDriverAt(db);
    const { start } = await import("@/lib/federation/failover.js");
    const fetchImpl = vi.fn();
    const timer = start({ fetchImpl, centralUrl: "http://127.0.0.1:9", db });
    expect(timer).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(db.get(`SELECT last_state FROM federation_meta WHERE id = 1`).last_state).toBeNull();
  });

  it("start() returns null in central mode", async () => {
    process.env.FEDERATION_MODE = "central";
    vi.resetModules();
    const db = await createMigratedDb();
    pointDriverAt(db);
    const { start } = await import("@/lib/federation/failover.js");
    const timer = start({ fetchImpl: vi.fn(), centralUrl: "http://127.0.0.1:9", db });
    expect(timer).toBeNull();
  });
});
