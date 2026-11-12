// FED-005 — local federation status surface tests (spec §3.5).
//
// Covers (gitreins fed-005 criteria):
//  - local status payload: last_state present + correct per state,
//    revisionLag = centralMaxVersion - lastAppliedRevision (clamped ≥ 0;
//    FED-021 — measured against central's ADVERTISED watermark, not the
//    edge's local one), role reports 'edge' in edge mode
//  - auth: the local-status endpoint is reachable WITHOUT a token from an
//    edge dashboard (the route is deliberately unguarded); central/
//    standalone behavior correct
//  - no secret/token leakage: the payload never contains the token value,
//    lease/fencing material, or central data
//  - config-status: mode/central URL/edge ID/settings + token as a boolean
//    only (never the value)
//  - standalone no-op: role 'standalone', no last_state, zero drift
//  - degraded-mode dashboard headers: shouldTagDegraded/tagDegraded pure
//    decision + header mutation (X-Federation-State: degraded), queued-write
//    header never overwritten
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// next/server is not installed in tests/node_modules — mock the only member
// the route wrappers use (same pattern as roleguard.test.js). The mock is
// hoisted to the top of the file and applies to every import of next/server
// in this suite (the local-status/config-status route modules + roleGuard).
const mocks = vi.hoisted(() => ({
  json: vi.fn((body, init) => ({ status: init?.status || 200, body, headers: init?.headers || {} })),
}));

vi.mock("next/server", () => ({
  NextResponse: { json: mocks.json },
}));

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
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-fed-localstatus-"));
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
  const file = path.join(tempDir, `localstatus-${Math.random().toString(36).slice(2)}.sqlite`);
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

// ─── Local status payload ────────────────────────────────────────────────

describe("local status payload (acceptance 1)", () => {
  it("edge mode: role 'edge', last_state from federation_meta, revisionLag = centralMaxVersion - lastAppliedRevision (FED-021)", async () => {
    process.env.FEDERATION_MODE = "edge";
    process.env.FEDERATION_TOKEN = "fed-secret";
    process.env.FEDERATION_EDGE_ID = "edge-1";
    vi.resetModules();

    const db = await createMigratedDb();
    pointDriverAt(db);
    const { setEdgeState } = await import("@/lib/federation/state.js");
    const { handleLocalStatus } = await import("@/lib/federation/server.js");

    // Fresh edge (FED-016): the migration-seeded federation_meta row is
    // all-NULL — the runtime has recorded NO lifecycle activity → loops
    // never started. Previously this defaulted to LINKED (masking FED-013);
    // now it reports 'uninitialized' with lastAppliedRevision null (never
    // applied a replica).
    const fresh = await handleLocalStatus();
    expect(fresh.role).toBe("edge");
    expect(fresh.mode).toBe("edge");
    expect(fresh.last_state).toBe("uninitialized");
    expect(fresh.initialized).toBe(false);
    expect(fresh.edgeId).toBe("edge-1");
    expect(fresh.revisionLag).toBe(0);
    expect(fresh.maxVersion).toBe(0);
    expect(fresh.centralMaxVersion).toBe(null); // no batch ever applied → no baseline
    expect(fresh.lastAppliedRevision).toBe(null);

    // DEGRADED state is reflected (setEdgeState writes the row → the edge is
    // now initialized; the failover state wins over 'uninitialized').
    setEdgeState(db, "degraded");
    const degraded = await handleLocalStatus();
    expect(degraded.last_state).toBe("degraded");
    expect(degraded.initialized).toBe(true);

    // RECOVERING state is reflected.
    setEdgeState(db, "recovering");
    const recovering = await handleLocalStatus();
    expect(recovering.last_state).toBe("recovering");

    // Revision lag (FED-021): measured against the central-ADVERTISED
    // watermark (federation_meta.centralMaxVersion), NOT the edge's local
    // one. Record lastApplied=3 + centralMax=7, and stamp a local row at v7
    // so the LOCAL watermark is also 7 — lag = 7 - 3 = 4 comes from the
    // advertised value either way here; the dedicated FED-021 describe below
    // isolates the stale-edge case where the two watermarks diverge.
    db.run(
      `INSERT INTO federation_meta(id, lastAppliedRevision, centralMaxVersion) VALUES(1, 3, 7)
       ON CONFLICT(id) DO UPDATE SET lastAppliedRevision = excluded.lastAppliedRevision,
         centralMaxVersion = excluded.centralMaxVersion`
    );
    db.run(
      `INSERT INTO settings(id, data, federation_version, updated_at, deleted)
       VALUES(1, '{"cloudEnabled":true}', 7, ?, 0)`,
      [new Date().toISOString()]
    );
    const lagged = await handleLocalStatus();
    expect(lagged.maxVersion).toBe(7); // local watermark — reported as-is
    expect(lagged.centralMaxVersion).toBe(7); // central-advertised watermark
    expect(lagged.lastAppliedRevision).toBe(3);
    expect(lagged.revisionLag).toBe(4);
    expect(lagged.initialized).toBe(true);
  });

  it("edge with a federation_meta row but no last_state → getEdgeState default LINKED (loops started, state machine not yet run)", async () => {
    process.env.FEDERATION_MODE = "edge";
    vi.resetModules();

    const db = await createMigratedDb();
    pointDriverAt(db);
    // edgeClient.start()'s first tick writes role/edgeId before the first
    // pull completes — the row exists but last_state is still null.
    db.run(
      `INSERT INTO federation_meta(id, role, edgeId) VALUES(1, 'edge', 'edge-1')
       ON CONFLICT(id) DO UPDATE SET role = 'edge', edgeId = excluded.edgeId`
    );
    const { handleLocalStatus } = await import("@/lib/federation/server.js");
    const payload = await handleLocalStatus();
    expect(payload.role).toBe("edge");
    expect(payload.initialized).toBe(true);
    // Row exists → not 'uninitialized'; no last_state written yet → the
    // state machine's resting default (LINKED).
    expect(payload.last_state).toBe("linked");
    expect(payload.lastAppliedRevision).toBe(null);
  });

  it("revisionLag is clamped ≥ 0 (never negative when applied > watermark)", async () => {
    process.env.FEDERATION_MODE = "edge";
    vi.resetModules();

    const db = await createMigratedDb();
    pointDriverAt(db);
    const { handleLocalStatus } = await import("@/lib/federation/server.js");
    // Applied AHEAD of the central-advertised watermark (out-of-order
    // bookkeeping) → clamps to 0, never negative.
    db.run(
      `INSERT INTO federation_meta(id, lastAppliedRevision, centralMaxVersion) VALUES(1, 99, 50)
       ON CONFLICT(id) DO UPDATE SET lastAppliedRevision = excluded.lastAppliedRevision,
         centralMaxVersion = excluded.centralMaxVersion`
    );
    const payload = await handleLocalStatus();
    expect(payload.maxVersion).toBe(0);
    expect(payload.centralMaxVersion).toBe(50);
    expect(payload.lastAppliedRevision).toBe(99);
    expect(payload.revisionLag).toBe(0);
    expect(payload.initialized).toBe(true);
  });

  it("central mode: role 'central', no last_state, revisionLag 0 + edge-only note (FED-016)", async () => {
    process.env.FEDERATION_MODE = "central";
    process.env.FEDERATION_TOKEN = "fed-secret";
    vi.resetModules();

    const db = await createMigratedDb();
    pointDriverAt(db);
    const { handleLocalStatus } = await import("@/lib/federation/server.js");
    const payload = await handleLocalStatus();
    expect(payload.role).toBe("central");
    expect(payload.mode).toBe("central");
    expect(payload.last_state).toBeUndefined();
    // FED-016: central is the source of truth — no replica, no lag. The
    // previous payload reported revisionLag = maxVersion (a misleading
    // "self-lag" because lastAppliedRevision is never set on central).
    expect(payload.revisionLag).toBe(0);
    expect(payload.revisionLagNote).toContain("edge-only");
    expect(payload.lastAppliedRevision).toBe(null);
    expect(payload.initialized).toBeUndefined();
    // centralMaxVersion is an edge-only field (only an edge receives
    // advertised watermarks) — absent on central.
    expect(payload.centralMaxVersion).toBeUndefined();
  });

  it("standalone mode: role 'standalone', no last_state, zero drift, edge-only lag note", async () => {
    vi.resetModules(); // FEDERATION_MODE unset
    const db = await createMigratedDb();
    pointDriverAt(db);
    const { handleLocalStatus } = await import("@/lib/federation/server.js");
    const payload = await handleLocalStatus();
    expect(payload.role).toBe("standalone");
    expect(payload.mode).toBe("standalone");
    expect(payload.last_state).toBeUndefined();
    expect(payload.revisionLag).toBe(0);
    expect(payload.revisionLagNote).toContain("edge-only");
    expect(payload.lastAppliedRevision).toBe(null);
    expect(payload.initialized).toBeUndefined();
    expect(payload.centralMaxVersion).toBeUndefined();
  });

  it("handleStatus (guarded route) reports the same local payload — role 'edge' in edge mode, 'uninitialized' before the loops write a row", async () => {
    process.env.FEDERATION_MODE = "edge";
    process.env.FEDERATION_TOKEN = "fed-secret";
    vi.resetModules();

    const db = await createMigratedDb();
    pointDriverAt(db);
    const { handleStatus } = await import("@/lib/federation/server.js");
    const payload = await handleStatus();
    expect(payload.role).toBe("edge");
    expect(payload.last_state).toBe("uninitialized");
  });
});

// ─── FED-021: revisionLag vs central-advertised watermark ──────────────

describe("FED-021 — revisionLag measured against central's advertised watermark", () => {
  it("edge at rev N, central advertises N+2 → revisionLag 2 (NOT 0), even with the local watermark at N", async () => {
    process.env.FEDERATION_MODE = "edge";
    process.env.FEDERATION_TOKEN = "fed-secret";
    process.env.FEDERATION_EDGE_ID = "edge-1";
    vi.resetModules();

    const db = await createMigratedDb();
    pointDriverAt(db);
    const { handleLocalStatus } = await import("@/lib/federation/server.js");

    // Stale edge: applied up to rev 5, and its local replica rows sit at v5
    // (local watermark == lastAppliedRevision — the FED-020 invariant).
    // Central has since advertised maxVersion 7 (persisted in
    // federation_meta.centralMaxVersion by the apply path).
    db.run(
      `INSERT INTO settings(id, data, federation_version, updated_at, deleted)
       VALUES(1, '{"cloudEnabled":true}', 5, ?, 0)`,
      [new Date().toISOString()]
    );
    db.run(
      `INSERT INTO federation_meta(id, role, lastAppliedRevision, centralMaxVersion) VALUES(1, 'edge', 5, 7)
       ON CONFLICT(id) DO UPDATE SET lastAppliedRevision = excluded.lastAppliedRevision,
         centralMaxVersion = excluded.centralMaxVersion`
    );

    const payload = await handleLocalStatus();
    expect(payload.maxVersion).toBe(5); // local watermark — reported as-is
    expect(payload.lastAppliedRevision).toBe(5);
    expect(payload.centralMaxVersion).toBe(7); // central-advertised watermark
    // The pre-FED-021 blind spot: a LOCAL-watermark lag is max(0, 5-5) = 0 —
    // a stale edge looks healthy. The metric must report the divergence.
    expect(payload.revisionLag).toBe(2);
    expect(payload.initialized).toBe(true);
  });

  it("caught-up edge (centralMaxVersion == lastAppliedRevision) reports lag 0", async () => {
    process.env.FEDERATION_MODE = "edge";
    vi.resetModules();

    const db = await createMigratedDb();
    pointDriverAt(db);
    const { handleLocalStatus } = await import("@/lib/federation/server.js");
    db.run(
      `INSERT INTO federation_meta(id, role, lastAppliedRevision, centralMaxVersion) VALUES(1, 'edge', 7, 7)
       ON CONFLICT(id) DO UPDATE SET lastAppliedRevision = excluded.lastAppliedRevision,
         centralMaxVersion = excluded.centralMaxVersion`
    );
    const payload = await handleLocalStatus();
    expect(payload.centralMaxVersion).toBe(7);
    expect(payload.lastAppliedRevision).toBe(7);
    expect(payload.revisionLag).toBe(0);
  });

  it("never synced (no batch ever applied): centralMaxVersion null + lag 0 — uninitialized already signals 'never started'", async () => {
    process.env.FEDERATION_MODE = "edge";
    vi.resetModules();

    const db = await createMigratedDb();
    pointDriverAt(db);
    const { handleLocalStatus } = await import("@/lib/federation/server.js");
    const payload = await handleLocalStatus();
    expect(payload.centralMaxVersion).toBe(null);
    expect(payload.lastAppliedRevision).toBe(null);
    expect(payload.revisionLag).toBe(0);
    expect(payload.initialized).toBe(false);
    expect(payload.last_state).toBe("uninitialized");
  });
});

// ─── No secret/token leakage ─────────────────────────────────────────────

describe("local status — no secret/token leakage (acceptance 2)", () => {
  it("payload never contains the token value, lease, fencing material, or central data", async () => {
    process.env.FEDERATION_MODE = "edge";
    process.env.FEDERATION_TOKEN = "super-secret-token-value";
    process.env.FEDERATION_CENTRAL_URL = "https://central.example.com";
    vi.resetModules();

    const db = await createMigratedDb();
    pointDriverAt(db);
    const { handleLocalStatus } = await import("@/lib/federation/server.js");
    const payload = await handleLocalStatus();
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain("super-secret-token-value");
    expect(serialized).not.toContain("fencing");
    expect(serialized).not.toContain("lease");
    expect(serialized).not.toContain("central.example.com");
    // The edge's own configured central URL is NOT part of the status
    // payload (it belongs on the config page surface).
    expect(payload.centralUrl).toBeUndefined();
  });

  it("config-status reports token as a boolean only — never the value", async () => {
    process.env.FEDERATION_MODE = "edge";
    process.env.FEDERATION_TOKEN = "super-secret-token-value";
    process.env.FEDERATION_CENTRAL_URL = "https://central.example.com";
    process.env.FEDERATION_EDGE_ID = "edge-1";
    vi.resetModules();

    const db = await createMigratedDb();
    pointDriverAt(db);
    const { handleConfigStatus } = await import("@/lib/federation/server.js");
    const payload = await handleConfigStatus();
    expect(payload.mode).toBe("edge");
    expect(payload.centralUrl).toBe("https://central.example.com");
    expect(payload.edgeId).toBe("edge-1");
    expect(payload.tokenConfigured).toBe(true);
    expect(JSON.stringify(payload)).not.toContain("super-secret-token-value");
    expect(payload.token).toBeUndefined();
  });

  it("config-status: tokenConfigured false when FEDERATION_TOKEN unset; standalone shape", async () => {
    vi.resetModules(); // FEDERATION_MODE unset, no token
    const { handleConfigStatus } = await import("@/lib/federation/server.js");
    const payload = await handleConfigStatus();
    expect(payload.mode).toBe("standalone");
    expect(payload.tokenConfigured).toBe(false);
    expect(payload.centralUrl).toBeUndefined();
    expect(payload.edgeId).toBeTruthy();
  });
});

// ─── Auth: token-less reachability ───────────────────────────────────────

describe("local status — token-less dashboard access (acceptance 2)", () => {
  it("the local-status route is NOT wrapped in withFederationAuth (no token required in edge mode)", async () => {
    process.env.FEDERATION_MODE = "edge";
    process.env.FEDERATION_TOKEN = "fed-secret";
    vi.resetModules();

    // The route module must not import withFederationAuth at all — the
    // guard would 401 a browser fetch without the token (spec §3.5: token
    // never reaches browser JS).
    const route = await import("@/app/api/federation/local-status/route.js");
    expect(route.GET).toBeTypeOf("function");
    // No withFederationAuth wrapper: the exported GET is the raw handler.
    const resp = await route.GET();
    expect(resp.status).toBe(200);
    expect(resp.body.role).toBe("edge");
    // Fresh edge, no federation_meta row → 'uninitialized' (FED-016).
    expect(resp.body.last_state).toBe("uninitialized");
  });

  it("the guarded /api/federation/status route still 401s without a token in edge mode (unchanged)", async () => {
    process.env.FEDERATION_MODE = "edge";
    process.env.FEDERATION_TOKEN = "fed-secret";
    vi.resetModules();

    const { checkFederationAuth } = await import("@/lib/federation/roleGuard.js");
    const decision = checkFederationAuth({ headers: { get: () => null } });
    expect(decision.ok).toBe(false);
    expect(decision.status).toBe(401);
  });
});

// ─── Degraded-mode dashboard headers ────────────────────────────────────

describe("degraded-mode dashboard headers (acceptance 2)", () => {
  it("shouldTagDegraded: true only for state 'degraded'", async () => {
    const { shouldTagDegraded } = await import("@/lib/federation/headers.js");
    expect(shouldTagDegraded("degraded")).toBe(true);
    expect(shouldTagDegraded("linked")).toBe(false);
    expect(shouldTagDegraded("recovering")).toBe(false);
    expect(shouldTagDegraded("standalone")).toBe(false);
    expect(shouldTagDegraded(null)).toBe(false);
    expect(shouldTagDegraded(undefined)).toBe(false);
  });

  it("tagDegraded adds X-Federation-State: degraded and never overwrites an existing value", async () => {
    const { tagDegraded, FEDERATION_STATE_HEADER } = await import("@/lib/federation/headers.js");
    const headers = {};
    tagDegraded(headers);
    expect(headers[FEDERATION_STATE_HEADER]).toBe("degraded");

    // Queued-write path (queue.js) sets its own header first — must survive.
    const queued = { "X-Federation-State": "degraded", "X-Federation-Queued-Write-Id": "abc" };
    tagDegraded(queued);
    expect(queued["X-Federation-State"]).toBe("degraded");
    expect(queued["X-Federation-Queued-Write-Id"]).toBe("abc");
  });

  it("isDashboardApiPath: dashboard API paths only (no /v1, no static, no federation routes)", async () => {
    const { isDashboardApiPath } = await import("@/lib/federation/proxy.js");
    expect(isDashboardApiPath("/api/settings")).toBe(true);
    expect(isDashboardApiPath("/api/providers")).toBe(true);
    expect(isDashboardApiPath("/api/keys?x=1")).toBe(true);
    expect(isDashboardApiPath("/api/combos/abc")).toBe(true);
    expect(isDashboardApiPath("/v1/chat/completions")).toBe(false);
    expect(isDashboardApiPath("/api/federation/status")).toBe(false);
    expect(isDashboardApiPath("/dashboard")).toBe(false);
    expect(isDashboardApiPath("/_next/static/chunk.js")).toBe(false);
  });
});
