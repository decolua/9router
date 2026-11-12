// DF-9ROUTER-31 — pre-DEGRADED outage window (fail-open from a fresh replica).
//
// The dogfood run (docs/dogfood/2026-09-19-integration.md, finding 3) killed
// central and observed that for ~1.5×OUTAGE_THRESHOLD_MS — the span between
// central's death and the edge's formal DEGRADED flip — `/v1` answered a hard
// `502 {"error":{"code":"FED_UPSTREAM_ERROR"}}` even though the local replica
// was fully caught up (`last_state: 'linked'`, `revisionLag: 0`). Serving from
// the replica is safe in that window; the user saw a hard error during the
// exact window federation exists for.
//
// This suite proves the fixed contract:
//   1. state.js replica-freshness predicate: fresh ⇔ initialized AND a central
//      watermark was advertised AND lag 0 (a never-synced replica is NOT fresh
//      — lag is unknown there, not zero).
//   2. dead central + fresh replica + still LINKED → /v1 is served from the
//      LOCAL replica (200), not FED_UPSTREAM_ERROR, and the response says
//      X-Federation-State: degraded so the serving source is never hidden.
//   3. the client body survives the failed forward — the local pipeline gets
//      the exact bytes the client sent (the pre-connect body-preservation
//      rule; a consumed body would make the fallback a bogus 400).
//   4. fail-hard stays where fail-open would be unsafe: a stale replica, a
//      never-synced replica, and a failure AFTER connect (body already
//      consumed) all still answer 502 FED_UPSTREAM_ERROR.
//   5. no parallel state was added: the existing machine still owns the
//      transition — the stale-replica 502 still flips last_state to DEGRADED,
//      and a healthy central is still proxied byte-identically (no regression
//      for the LINKED path).
//   6. standalone (FEDERATION_MODE unset) remains a pure no-op.
//
// Env/module-reset/DB patterns mirror tests/federation/failover.test.js.
// Real (not fake) timers: the integration cases drive real node:http servers.
// Waits are polled with generous timeouts, never exact sleeps.
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
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-fed-window-"));
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
  const file = path.join(tempDir, `window-${Math.random().toString(36).slice(2)}.sqlite`);
  const db = await createBetterSqliteAdapter(file);
  const { default: m001 } = await import("@/lib/db/migrations/001-initial.js");
  const { default: m002 } = await import("@/lib/db/migrations/002-federation.js");
  const { default: m003 } = await import("@/lib/db/migrations/003-federation-state.js");
  const { default: m004 } = await import("@/lib/db/migrations/004-federation-fencing.js");
  const { default: m005 } = await import("@/lib/db/migrations/005-federation-central-watermark.js");
  m001.up(db);
  m002.up(db);
  m003.up(db);
  m004.up(db);
  m005.up(db);
  return db;
}

// Seed the edge's lifecycle row the way the runtime would: edgeClient writes
// role/edgeId, failover writes last_state, an applied batch writes
// lastAppliedRevision + centralMaxVersion.
function seedEdge(db, { last_state = "linked", lastAppliedRevision = 5, centralMaxVersion = 5 } = {}) {
  db.run(
    `INSERT INTO federation_meta(id, role, edgeId, last_state, lastAppliedRevision, centralMaxVersion)
     VALUES(1, 'edge', 'edge-1', ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       role = 'edge',
       edgeId = 'edge-1',
       last_state = excluded.last_state,
       lastAppliedRevision = excluded.lastAppliedRevision,
       centralMaxVersion = excluded.centralMaxVersion`,
    [last_state, lastAppliedRevision, centralMaxVersion]
  );
}

// ─── Servers ─────────────────────────────────────────────────────────────

// A real "central" (or any upstream) on an ephemeral port. close() releases it.
function startUpstream(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, port: server.address().port, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

// A real "edge" whose handler mimics custom-server.js's edge branch exactly:
// run the REAL proxyRequest (with the failover hook wired the same way) and
// fall through to the local handler when it does not handle the request.
function startEdge({ centralUrl, token, localHandler, onUpstreamFailure = null }) {
  const server = http.createServer(async (req, res) => {
    const { proxyRequest } = await import("@/lib/federation/proxy.js");
    const handled = await proxyRequest(req, res, { centralUrl, token, onUpstreamFailure });
    if (!handled) return localHandler(req, res);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, port: server.address().port, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

function request(port, urlPath, { method = "GET", headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: urlPath, method, headers }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () =>
        resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") })
      );
    });
    req.on("error", reject);
    if (body !== null) req.write(body);
    req.end();
  });
}

// Generous polling helper — these suites run under host load, so never assert
// on an exact sleep.
async function waitFor(predicate, { timeout = 10000, interval = 50, label = "condition" } = {}) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    last = await predicate();
    if (last) return last;
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(`waitFor timed out after ${timeout}ms: ${label}`);
}

// A local handler that drains the client body and answers as the replica
// would, recording what it received.
function recordingLocalHandler(seen) {
  return (req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      seen.push({ method: req.method, url: req.url, body: Buffer.concat(chunks).toString("utf8") });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ source: "local-replica", state: "degraded" }));
    });
  };
}

// ─── 1. Replica-freshness predicate ──────────────────────────────────────

describe("replica freshness predicate (DF-9ROUTER-31)", () => {
  it("fresh ⇔ initialized + advertised central watermark + lag 0", async () => {
    process.env.FEDERATION_MODE = "edge";
    vi.resetModules();
    const { computeReplicaFreshness } = await import("@/lib/federation/state.js");

    const fresh = computeReplicaFreshness({ role: "edge", last_state: "linked", lastAppliedRevision: 7, centralMaxVersion: 7 });
    expect(fresh.initialized).toBe(true);
    expect(fresh.revisionLag).toBe(0);
    expect(fresh.fresh).toBe(true);

    // Behind central → NOT safe to serve as if caught up.
    const lagging = computeReplicaFreshness({ role: "edge", last_state: "linked", lastAppliedRevision: 5, centralMaxVersion: 9 });
    expect(lagging.revisionLag).toBe(4);
    expect(lagging.fresh).toBe(false);

    // Never synced: centralMaxVersion NULL means "no baseline" — the lag is
    // UNKNOWN, not zero, so a never-started edge must not read as fresh.
    const neverSynced = computeReplicaFreshness({ role: "edge", edgeId: "edge-1", last_state: null, lastAppliedRevision: null, centralMaxVersion: null });
    expect(neverSynced.initialized).toBe(true); // role is set → the runtime ran
    expect(neverSynced.centralMaxVersion).toBe(null);
    expect(neverSynced.fresh).toBe(false);

    // All-NULL seeded row (migration 002): the loops never started.
    const seededRow = computeReplicaFreshness({ role: null, last_state: null, lastAppliedRevision: null, centralMaxVersion: null });
    expect(seededRow.initialized).toBe(false);
    expect(seededRow.fresh).toBe(false);

    // Defensive: no row at all.
    expect(computeReplicaFreshness(null).fresh).toBe(false);
    expect(computeReplicaFreshness(undefined).fresh).toBe(false);
  });

  it("readReplicaFreshness/canServeFromReplica degrade to 'not fresh' on a dead or missing DB", async () => {
    process.env.FEDERATION_MODE = "edge";
    vi.resetModules();
    const { canServeFromReplica, readReplicaFreshness } = await import("@/lib/federation/state.js");

    expect(canServeFromReplica(null)).toBe(false);
    // Throwing adapter (pre-003 schema / unavailable DB) must not throw out.
    expect(canServeFromReplica({ get: () => { throw new Error("no such table: federation_meta"); } })).toBe(false);

    const db = await createMigratedDb();
    seedEdge(db, { lastAppliedRevision: 5, centralMaxVersion: 5 });
    expect(canServeFromReplica(db)).toBe(true);
    expect(readReplicaFreshness(db)).toMatchObject({ fresh: true, revisionLag: 0, lastAppliedRevision: 5, centralMaxVersion: 5 });

    seedEdge(db, { lastAppliedRevision: 5, centralMaxVersion: 6 });
    expect(canServeFromReplica(db)).toBe(false);
  });
});

// ─── 2. The window itself ────────────────────────────────────────────────

describe("pre-DEGRADED outage window (DF-9ROUTER-31)", () => {
  it("dead central + fresh replica while still LINKED → /v1 served from the replica (not FED_UPSTREAM_ERROR)", async () => {
    process.env.FEDERATION_MODE = "edge";
    process.env.FEDERATION_TOKEN = "fed-secret";
    process.env.FEDERATION_EDGE_ID = "edge-1";
    vi.resetModules();

    const db = await createMigratedDb();
    pointDriverAt(db);
    seedEdge(db, { last_state: "linked", lastAppliedRevision: 5, centralMaxVersion: 5 });

    const { getEdgeState } = await import("@/lib/federation/state.js");
    const { flipToDegraded } = await import("@/lib/federation/failover.js");
    expect(getEdgeState(db)).toBe("linked"); // the window: still LINKED

    const seen = [];
    // Port 1 on loopback: connection refused — exactly a dead central.
    const edge = await startEdge({
      centralUrl: "http://127.0.0.1:1",
      token: "fed-secret",
      localHandler: recordingLocalHandler(seen),
      onUpstreamFailure: () => flipToDegraded({ db }),
    });

    try {
      const payload = JSON.stringify({ model: "m", messages: [{ role: "user", content: "window-probe" }], stream: false });
      const resp = await request(edge.port, "/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
      });

      // The finding: this used to be 502 FED_UPSTREAM_ERROR.
      expect(resp.status).toBe(200);
      expect(JSON.parse(resp.body)).toEqual({ source: "local-replica", state: "degraded" });
      // The serving source is never hidden.
      expect(resp.headers["x-federation-state"]).toBe("degraded");
      // The exact client bytes reached the local pipeline.
      await waitFor(() => seen.length === 1, { label: "local handler served the request" });
      expect(seen[0].method).toBe("POST");
      expect(seen[0].url).toBe("/v1/chat/completions");
      expect(seen[0].body).toBe(payload);

      // No parallel state was introduced: the flip is still the machine's job
      // and the hook still fires on the upstream failure.
      await waitFor(() => getEdgeState(db) === "degraded", { label: "failover hook flips the existing state machine" });
      expect(db.get(`SELECT last_state FROM federation_meta WHERE id = 1`).last_state).toBe("degraded");
    } finally {
      await edge.close();
    }
  });

  it("serves every /v1 request in the window (GET with no body too), not just the first", async () => {
    process.env.FEDERATION_MODE = "edge";
    process.env.FEDERATION_TOKEN = "fed-secret";
    vi.resetModules();

    const db = await createMigratedDb();
    pointDriverAt(db);
    seedEdge(db, { last_state: "linked", lastAppliedRevision: 3, centralMaxVersion: 3 });

    const seen = [];
    const edge = await startEdge({
      centralUrl: "http://127.0.0.1:1",
      token: "fed-secret",
      localHandler: recordingLocalHandler(seen),
    });

    try {
      for (const _ of [1, 2, 3]) {
        const resp = await request(edge.port, "/v1/models", { method: "GET" });
        expect(resp.status).toBe(200);
        expect(resp.headers["x-federation-state"]).toBe("degraded");
        expect(JSON.parse(resp.body).source).toBe("local-replica");
      }
      await waitFor(() => seen.length === 3, { label: "all three /v1 requests served locally" });
      expect(seen.every((s) => s.url === "/v1/models" && s.body === "")).toBe(true);
    } finally {
      await edge.close();
    }
  });

  it("a healthy central is still proxied exactly as before (no regression on the LINKED path)", async () => {
    process.env.FEDERATION_MODE = "edge";
    process.env.FEDERATION_TOKEN = "fed-secret";
    vi.resetModules();

    const db = await createMigratedDb();
    pointDriverAt(db);
    seedEdge(db, { last_state: "linked", lastAppliedRevision: 5, centralMaxVersion: 5 });

    const centralSeen = [];
    const central = await startUpstream((req, res) => {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        centralSeen.push({ method: req.method, url: req.url, auth: req.headers.authorization, body: Buffer.concat(chunks).toString("utf8") });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ source: "central" }));
      });
    });

    const localSeen = [];
    const edge = await startEdge({
      centralUrl: `http://127.0.0.1:${central.port}`,
      token: "fed-secret",
      localHandler: recordingLocalHandler(localSeen),
    });

    try {
      // Start the edge's keep-alive-free http agent path with a real body and
      // assert byte-identical forwarding (the deferred body pipe must not
      // change the happy path).
      const payload = JSON.stringify({ model: "m", messages: [{ role: "user", content: "x".repeat(20000) }] });
      const resp = await request(edge.port, "/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
      });
      expect(resp.status).toBe(200);
      expect(JSON.parse(resp.body).source).toBe("central");
      // Central's own headers are relayed — the local-serving header is not
      // stamped on a proxied response.
      expect(resp.headers["x-federation-state"]).toBeUndefined();
      await waitFor(() => centralSeen.length === 1, { label: "central received the proxied request" });
      expect(centralSeen[0].body).toBe(payload);
      expect(centralSeen[0].auth).toBe("Bearer fed-secret");
      expect(localSeen).toHaveLength(0);
    } finally {
      await edge.close();
      await central.close();
    }
  });
});

// ─── 3. Fail-hard where fail-open is unsafe ──────────────────────────────

describe("pre-DEGRADED window — fail-hard remains where serving would be unsafe", () => {
  it("stale replica (lag > 0) + dead central → still 502 FED_UPSTREAM_ERROR", async () => {
    process.env.FEDERATION_MODE = "edge";
    process.env.FEDERATION_TOKEN = "fed-secret";
    vi.resetModules();

    const db = await createMigratedDb();
    pointDriverAt(db);
    seedEdge(db, { last_state: "linked", lastAppliedRevision: 5, centralMaxVersion: 9 }); // behind central

    const localSeen = [];
    const edge = await startEdge({
      centralUrl: "http://127.0.0.1:1",
      token: "fed-secret",
      localHandler: recordingLocalHandler(localSeen),
    });

    try {
      const resp = await request(edge.port, "/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "m" }),
      });
      expect(resp.status).toBe(502);
      expect(JSON.parse(resp.body).error.code).toBe("FED_UPSTREAM_ERROR");
      expect(localSeen).toHaveLength(0);
    } finally {
      await edge.close();
    }
  });

  it("never-synced replica (no central watermark) + dead central → still 502", async () => {
    process.env.FEDERATION_MODE = "edge";
    process.env.FEDERATION_TOKEN = "fed-secret";
    vi.resetModules();

    const db = await createMigratedDb();
    pointDriverAt(db);
    // The runtime ran (role written by edgeClient's first tick) but no batch
    // was ever applied — there is no replica to serve from.
    db.run(
      `INSERT INTO federation_meta(id, role, edgeId, last_state) VALUES(1, 'edge', 'edge-1', 'linked')
       ON CONFLICT(id) DO UPDATE SET role='edge', edgeId='edge-1', last_state='linked'`
    );

    const localSeen = [];
    const edge = await startEdge({
      centralUrl: "http://127.0.0.1:1",
      token: "fed-secret",
      localHandler: recordingLocalHandler(localSeen),
    });

    try {
      const resp = await request(edge.port, "/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "m" }),
      });
      expect(resp.status).toBe(502);
      expect(JSON.parse(resp.body).error.code).toBe("FED_UPSTREAM_ERROR");
      expect(localSeen).toHaveLength(0);
    } finally {
      await edge.close();
    }
  });

  it("failure AFTER connect (client body already consumed) → still 502, never replayed locally", async () => {
    process.env.FEDERATION_MODE = "edge";
    process.env.FEDERATION_TOKEN = "fed-secret";
    vi.resetModules();

    const db = await createMigratedDb();
    pointDriverAt(db);
    seedEdge(db, { last_state: "linked", lastAppliedRevision: 5, centralMaxVersion: 5 }); // fresh replica

    // Central accepts the connection, swallows the body, then kills the
    // socket — the failure lands after the body was consumed.
    const central = await startUpstream((req, res) => {
      req.on("data", () => {});
      req.on("end", () => req.socket.destroy());
    });

    const localSeen = [];
    const edge = await startEdge({
      centralUrl: `http://127.0.0.1:${central.port}`,
      token: "fed-secret",
      localHandler: recordingLocalHandler(localSeen),
    });

    try {
      const resp = await request(edge.port, "/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "m" }),
      });
      expect(resp.status).toBe(502);
      expect(JSON.parse(resp.body).error.code).toBe("FED_UPSTREAM_ERROR");
      expect(localSeen).toHaveLength(0);
    } finally {
      await edge.close();
      await central.close();
    }
  });

  it("a transport that does not declare the body untouched is never replayed locally", async () => {
    process.env.FEDERATION_MODE = "edge";
    vi.resetModules();

    const { proxyRequest, isBodyUntouched, BODY_UNTOUCHED_FLAG } = await import("@/lib/federation/proxy.js");

    // A failing custom transport (no flag) → fail-hard even with a fresh
    // replica, because proxyRequest cannot know the body is still readable.
    expect(isBodyUntouched(new Error("boom"))).toBe(false);
    expect(isBodyUntouched({ [BODY_UNTOUCHED_FLAG]: true })).toBe(true);

    let localServed = false;
    const server = http.createServer(async (req, res) => {
      const handled = await proxyRequest(req, res, {
        centralUrl: "http://127.0.0.1:1",
        token: "tok",
        isFreshReplica: () => true, // replica is fresh, yet…
        transport: async () => {
          throw new Error("transport exploded");
        },
      });
      if (!handled) {
        localServed = true;
        res.writeHead(200);
        res.end("LOCAL");
      }
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const port = server.address().port;

    try {
      const resp = await request(port, "/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      expect(resp.status).toBe(502); // …fail-hard: the body may already be gone
      expect(JSON.parse(resp.body).error.code).toBe("FED_UPSTREAM_ERROR");
      expect(localServed).toBe(false);
    } finally {
      await new Promise((r) => server.close(r));
    }
  });

  it("a mutating dashboard write stays fail-hard in the window (never applied outside the queue)", async () => {
    process.env.FEDERATION_MODE = "edge";
    process.env.FEDERATION_TOKEN = "fed-secret";
    vi.resetModules();

    const db = await createMigratedDb();
    pointDriverAt(db);
    seedEdge(db, { last_state: "linked", lastAppliedRevision: 5, centralMaxVersion: 5 }); // fresh replica

    const localSeen = [];
    const edge = await startEdge({
      centralUrl: "http://127.0.0.1:1",
      token: "fed-secret",
      localHandler: recordingLocalHandler(localSeen),
    });

    try {
      // PATCH /api/settings is in the mutating forward-set: while DEGRADED it
      // goes to pendingWrites (queue.js), never to the local handler — so in
      // the pre-DEGRADED window it must not be applied locally either. It
      // fails hard, the client retries after the flip, and the queued write
      // is replayed exactly once.
      const resp = await request(edge.port, "/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cloudEnabled: true }),
      });
      expect(resp.status).toBe(502);
      expect(JSON.parse(resp.body).error.code).toBe("FED_UPSTREAM_ERROR");
      expect(localSeen).toHaveLength(0);

      // Control: the SAME state + SAME replica still serves /v1 locally, so
      // the bound is the path, not the freshness/body conditions.
      const v1 = await request(edge.port, "/v1/models", { method: "GET" });
      expect(v1.status).toBe(200);
      expect(v1.headers["x-federation-state"]).toBe("degraded");
    } finally {
      await edge.close();
    }
  });

  it("an injected isFreshReplica=false keeps the fail-hard 502 (state stubs get no DB surprise)", async () => {
    process.env.FEDERATION_MODE = "edge";
    vi.resetModules();

    const { proxyRequest } = await import("@/lib/federation/proxy.js");
    let localServed = false;
    const server = http.createServer(async (req, res) => {
      const handled = await proxyRequest(req, res, {
        centralUrl: "http://127.0.0.1:1",
        token: "tok",
        getState: () => "linked",
        isFreshReplica: () => false,
      });
      if (!handled) {
        localServed = true;
        res.end("LOCAL");
      }
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const port = server.address().port;

    try {
      const resp = await request(port, "/v1/models", { method: "GET" });
      expect(resp.status).toBe(502);
      expect(localServed).toBe(false);
    } finally {
      await new Promise((r) => server.close(r));
    }
  });
});

// ─── 4. Standalone is still a pure no-op ─────────────────────────────────

describe("standalone stays untouched (DF-9ROUTER-31)", () => {
  it("FEDERATION_MODE unset → no proxy, local handler serves, no federation header", async () => {
    vi.resetModules(); // FEDERATION_MODE deleted in beforeEach

    const seen = [];
    const edge = await startEdge({
      centralUrl: "http://127.0.0.1:1", // would fail if ever used
      token: "fed-secret",
      localHandler: recordingLocalHandler(seen),
    });

    try {
      const payload = JSON.stringify({ model: "m" });
      const resp = await request(edge.port, "/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
      });
      expect(resp.status).toBe(200);
      expect(resp.headers["x-federation-state"]).toBeUndefined();
      await waitFor(() => seen.length === 1, { label: "standalone served locally without proxying" });
      expect(seen[0].body).toBe(payload);
    } finally {
      await edge.close();
    }
  });
});
