// FED-013 — federation loop starter tests.
//
// Covers (FED-013 acceptance):
//  - Test A (unit): startFederationLoops starts BOTH loops in edge mode
//    (injected modules), starts NOTHING in standalone/central (zero drift),
//    is fail-open when a start() throws, and is double-start safe.
//  - Test B (integration-lite): real mock central HTTP server + migrated
//    temp edge DB + REAL timers — the edge replica converges
//    (lastAppliedRevision advances, apiKeys/providerConnections > 0,
//    watermark caught up) within a few poll cycles; after a simulated
//    central outage + restart the loop flips DEGRADED → recovers → LINKED
//    and drains a queued pendingWrite.
//
// Env/module-reset pattern mirrors tests/federation/failover.test.js.
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
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-fed-loops-"));
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
  const file = path.join(tempDir, `loops-${Math.random().toString(36).slice(2)}.sqlite`);
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

// ─── Test A: unit (injected modules) ─────────────────────────────────────

describe("startFederationLoops — unit", () => {
  it("edge mode starts BOTH loops and returns their handles", async () => {
    process.env.FEDERATION_MODE = "edge";
    vi.resetModules();
    const { startFederationLoops } = await import("@/lib/federation/startLoops.js");

    const edgeClient = { start: vi.fn(() => "EC_TIMER") };
    const failover = { start: vi.fn(() => "FO_TIMER") };
    const handles = await startFederationLoops({ edgeClient, failover, intervalMs: 50, thresholdMs: 123 });

    expect(handles.started).toBe(true);
    expect(handles.edgeClient).toBe("EC_TIMER");
    expect(handles.failover).toBe("FO_TIMER");
    expect(edgeClient.start).toHaveBeenCalledTimes(1);
    expect(failover.start).toHaveBeenCalledTimes(1);
    // Interval/threshold overrides are forwarded.
    expect(edgeClient.start.mock.calls[0][0].intervalMs).toBe(50);
    expect(failover.start.mock.calls[0][0].intervalMs).toBe(50);
    expect(failover.start.mock.calls[0][0].thresholdMs).toBe(123);
  });

  it("standalone mode starts NOTHING (zero drift)", async () => {
    // FEDERATION_MODE unset → standalone default.
    vi.resetModules();
    const { startFederationLoops } = await import("@/lib/federation/startLoops.js");

    const edgeClient = { start: vi.fn(() => "EC_TIMER") };
    const failover = { start: vi.fn(() => "FO_TIMER") };
    const handles = await startFederationLoops({ edgeClient, failover });

    expect(handles).toEqual({ started: false, edgeClient: null, failover: null });
    expect(edgeClient.start).not.toHaveBeenCalled();
    expect(failover.start).not.toHaveBeenCalled();
  });

  it("central mode starts NOTHING (zero drift)", async () => {
    process.env.FEDERATION_MODE = "central";
    vi.resetModules();
    const { startFederationLoops } = await import("@/lib/federation/startLoops.js");

    const edgeClient = { start: vi.fn(() => "EC_TIMER") };
    const failover = { start: vi.fn(() => "FO_TIMER") };
    const handles = await startFederationLoops({ edgeClient, failover });

    expect(handles).toEqual({ started: false, edgeClient: null, failover: null });
    expect(edgeClient.start).not.toHaveBeenCalled();
    expect(failover.start).not.toHaveBeenCalled();
  });

  it("fail-open: a throwing start() never propagates; the other loop still starts", async () => {
    process.env.FEDERATION_MODE = "edge";
    vi.resetModules();
    const { startFederationLoops } = await import("@/lib/federation/startLoops.js");

    const edgeClient = { start: vi.fn(() => { throw new Error("boom"); }) };
    const failover = { start: vi.fn(() => "FO_TIMER") };
    const handles = await startFederationLoops({ edgeClient, failover });

    expect(edgeClient.start).toHaveBeenCalledTimes(1);
    expect(failover.start).toHaveBeenCalledTimes(1);
    expect(handles.edgeClient).toBeNull();
    expect(handles.failover).toBe("FO_TIMER");
    expect(handles.started).toBe(true);
  });

  it("double-start safe: a second call returns the same handles without re-starting", async () => {
    process.env.FEDERATION_MODE = "edge";
    vi.resetModules();
    const { startFederationLoops } = await import("@/lib/federation/startLoops.js");

    const edgeClient = { start: vi.fn(() => "EC_TIMER") };
    const failover = { start: vi.fn(() => "FO_TIMER") };
    const first = await startFederationLoops({ edgeClient, failover });
    const second = await startFederationLoops({ edgeClient, failover });

    expect(second).toBe(first);
    expect(edgeClient.start).toHaveBeenCalledTimes(1);
    expect(failover.start).toHaveBeenCalledTimes(1);
  });
});

// ─── Test B: integration-lite (real mock central + real timers) ──────────

async function waitFor(predicate, { timeoutMs = 10000, stepMs = 25, label = "condition" } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      if (predicate()) return;
    } catch (e) {
      lastError = e;
    }
    await new Promise((r) => setTimeout(r, stepMs));
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms: ${label}${lastError ? ` (last error: ${lastError.message})` : ""}`);
}

describe("startFederationLoops — integration-lite (acceptance 1 + 2)", () => {
  it("replica converges from a live central; after a central outage+restart the edge recovers to LINKED and drains pendingWrites", async () => {
    process.env.FEDERATION_MODE = "edge";
    process.env.FEDERATION_TOKEN = "fed-secret";
    process.env.FEDERATION_EDGE_ID = "edge-1";
    vi.resetModules();

    const db = await createMigratedDb();
    pointDriverAt(db);
    const { latestVersion } = await import("@/lib/db/migrations/index.js");
    const { getEdgeState } = await import("@/lib/federation/state.js");
    const { readLastAppliedRevision, computeWatermark } = await import("@/lib/federation/replication.js");
    const { enqueue, countPending } = await import("@/lib/federation/queue.js");
    const { startFederationLoops } = await import("@/lib/federation/startLoops.js");

    const schemaVersion = latestVersion();
    const iso = new Date().toISOString();
    const snapshot = {
      tables: {
        settings: [],
        providerConnections: [
          {
            row: { id: "conn-1", provider: "openai", authType: "apikey", name: "Conn 1", email: null, priority: 1, isActive: true, createdAt: iso, updatedAt: iso },
            federation_version: 2,
            updated_at: iso,
            deleted: 0,
          },
        ],
        providerNodes: [],
        proxyPools: [],
        apiKeys: [
          {
            row: { id: "key-1", key: "sk-test-key-1", name: "Key 1", machineId: null, isActive: true, createdAt: iso },
            federation_version: 1,
            updated_at: iso,
            deleted: 0,
          },
        ],
        modelAliases: [],
        combos: [],
        pricing: [],
      },
      schemaVersion,
      maxVersion: 2,
    };

    // Mock central. mode="ok" serves the federation API; mode="down" 500s
    // everything (heartbeat/pull failures without socket hangs).
    let mode = "ok";
    const replayBodies = [];
    const central = http.createServer((req, res) => {
      const send = (status, body) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
      };
      if (mode === "down") return send(500, { error: "central down" });
      const url = new URL(req.url, "http://127.0.0.1");
      if (url.pathname === "/api/federation/verify") {
        return send(200, { ok: true, role: "central", schemaVersion, revision: 2, fencing_token: "tok-1" });
      }
      if (url.pathname === "/api/federation/snapshot") {
        return send(200, snapshot);
      }
      if (url.pathname === "/api/federation/delta") {
        return send(200, { since: Number(url.searchParams.get("since") || 0), rows: [], tombstones: [], maxVersion: 2, schemaVersion });
      }
      if (url.pathname === "/api/federation/replay" && req.method === "POST") {
        const chunks = [];
        req.on("data", (c) => chunks.push(c));
        req.on("end", () => {
          replayBodies.push(JSON.parse(Buffer.concat(chunks).toString()));
          send(200, { applied: true });
        });
        return;
      }
      return send(404, { error: `no mock for ${req.method} ${url.pathname}` });
    });
    await new Promise((r) => central.listen(0, "127.0.0.1", r));
    const centralUrl = `http://127.0.0.1:${central.address().port}`;

    const handles = await startFederationLoops({
      centralUrl,
      intervalMs: 50,
      thresholdMs: 100,
      // Deterministic jitter + fast backoff keep the outage/recovery phases
      // quick under real timers.
      failoverOptions: { jitter: () => 1.0, backoffBaseMs: 50, backoffCapMs: 200 },
    });

    try {
      expect(handles.started).toBe(true);
      expect(handles.edgeClient).not.toBeNull();
      expect(handles.failover).not.toBeNull();

      // ── Acceptance 1: the edge replica converges against a live central.
      await waitFor(
        () =>
          readLastAppliedRevision(db) === 2 &&
          db.get(`SELECT COUNT(*) AS c FROM apiKeys WHERE deleted = 0`).c > 0 &&
          db.get(`SELECT COUNT(*) AS c FROM providerConnections WHERE deleted = 0`).c > 0,
        { label: "replica convergence (lastAppliedRevision=2, apiKeys/providerConnections > 0)" }
      );
      // revisionLag → 0: the replica watermark matches lastAppliedRevision.
      expect(computeWatermark(db)).toBe(2);
      expect(getEdgeState(db)).toBe("linked");

      // ── Central outage: heartbeat failures spanning the threshold flip
      // the edge to DEGRADED.
      mode = "down";
      await waitFor(() => getEdgeState(db) === "degraded", { label: "flip to DEGRADED after outage" });

      // A write queued while DEGRADED (the DEGRADED write-queue intercept
      // path uses queue.enqueue the same way).
      const queued = enqueue(db, { method: "PATCH", path: "/api/settings", body: { cloudEnabled: true } });
      expect(queued.ok).toBe(true);
      expect(countPending(db)).toBe(1);

      // ── Acceptance 2: central restarts → RECOVERING → LINKED, the queued
      // write drains to central.
      mode = "ok";
      await waitFor(
        () => getEdgeState(db) === "linked" && countPending(db) === 0,
        { label: "recovery to LINKED + pendingWrites drained" }
      );
      expect(replayBodies).toHaveLength(1);
      expect(replayBodies[0].idempotency_key).toBe(queued.idempotencyKey);
      expect(replayBodies[0].method).toBe("PATCH");
      expect(replayBodies[0].path).toBe("/api/settings");
      expect(replayBodies[0].fencing_token).toBe("tok-1");
      // Still caught up after recovery (delta catch-up is a no-op at the
      // watermark, lastAppliedRevision preserved).
      expect(readLastAppliedRevision(db)).toBe(2);
    } finally {
      // Stop/neutralize the loops: edgeClient's setInterval handle is
      // clearable; failover's self-scheduling setTimeout handle goes stale
      // after the first reschedule, so point the driver at an inert sink
      // adapter — stray unref'd ticks then read state 'degraded', fail the
      // (closed) heartbeat silently, and never touch a real DB.
      clearInterval(handles.edgeClient);
      clearTimeout(handles.failover);
      pointDriverAt({
        get: () => ({ last_state: "degraded" }),
        run: () => ({}),
        all: () => [],
        transaction: (fn) => fn(),
      });
      await new Promise((r) => central.close(r));
    }
  }, 30000);
});
