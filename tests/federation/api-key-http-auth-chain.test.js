// FED-GAP-07 — the documented API-key flow (docs/api-reference.md, Authentication:
// login → POST /api/keys → use the key on /v1) asserted END TO END against the REAL
// guard, with NO mocked validator.
//
// Why this file exists: at HEAD the chain was only proven in halves that could not
// meet. tests/unit/db-sqlite-vs-lowdb.test.js drives src/lib/db/repos/apiKeysRepo.js
// directly (no HTTP), tests/unit/dashboard-guard.test.js drives src/dashboardGuard.js
// with `validateApiKey` stubbed by a hand-written module stand-in (the guard is never
// proven against a key that exists in a database), and tests/federation/e2e-child.mjs
// emulates POST /api/keys by diffing getApiKeys() around applyReplayMutation() — the
// real route module src/app/api/keys/route.js is never invoked. So "create a key, then
// call /v1 with it" was asserted nowhere.
//
// REALNESS IS THE POINT — this file must never gain a module stand-in:
//   * it drives src/app/api/keys/route.js (POST) and src/dashboardGuard.js (proxy)
//     as the app ships them, plus src/lib/db/repos/apiKeysRepo.js for the row-level
//     cross-check, all against one temp-DATA_DIR SQLite database;
//   * validateApiKey is the repository's real SQL read — the whole premise collapses
//     if anything here is replaced by a stand-in, so the last test in this file reads
//     its own source and fails if a mock call ever appears.
//
// The integrity of the chain rests on the negative controls: a keyless remote request
// and a bogus key must BOTH 401 with the guard's exact error text, and deactivating the
// created row must flip the previously-accepted request back to 401 (that last one is
// the assertion that fails if the guard is not really consulting the database).
//
// FED-GAP-13 extends the same chain to REVOCATION: DELETE /api/keys/[id] tombstones the
// row (deleteApiKey → stampDelete, deleted = 1, isActive untouched) instead of removing
// it, so the auth read must filter that tombstone or the "deleted" credential keeps
// passing the guard for remote /v1 traffic. Control D and the FED-GAP-13 describe below
// are the assertions that fail when validateApiKey forgets the NOT_DELETED predicate.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";

const THIS_FILE = fileURLToPath(new URL(import.meta.url));

// The guard's own 401 body for a remote request without a usable key
// (src/dashboardGuard.js, canAccessPublicLlmApi → proxy's isPublicLlmApi branch).
// DF-9ROUTER-56: OpenAI envelope (type/code readable by OpenAI SDK clients),
// not the flat pre-56 string shape.
const KEY_REQUIRED_ERROR = {
  message: "API key required for remote API access",
  type: "authentication_error",
  code: "invalid_api_key",
};

// A peer that provably did NOT come from loopback: isLoopbackPeer() only trusts
// x-9r-real-ip when the per-process peer secret proves custom-server.js stamped it,
// and 203.0.113.7 is not a loopback host — so isLocalRequest() is false no matter
// what NODE_ENV the runner has. (Same fixture shape as tests/unit/dashboard-guard.test.js,
// but resolved against the REAL guard instead of a module stand-in.)
const PEER_TOKEN = "fed-gap-07-peer-token";
const REMOTE_IP = "203.0.113.7";

// Everything this file pins or must not inherit: a real deployment could have any of
// these set, and each one alone would let the negative controls pass for the wrong
// reason (REQUIRE_API_KEY=false, a peer token that makes the request look local, or a
// federation token that re-routes key extraction through the relay header).
const ENV_KEYS = [
  "DATA_DIR",
  "REQUIRE_API_KEY",
  "NINEROUTER_PEER_TOKEN",
  "FEDERATION_MODE",
  "FEDERATION_CENTRAL_URL",
  "FEDERATION_EDGE_ID",
  "FEDERATION_SYNC_INTERVAL_MS",
  "FEDERATION_TOKEN",
  "MACHINE_ID_SALT",
];

let tempDir;
let savedEnv = {};
let keysRoute;
let keysIdRoute;
let keysRepo;
let settingsRepo;
let driver;
let guard;
let created; // { status, body, headerNames } — the ONE real POST this file creates
let createdKey; // the key the real route returned, reused by every guard request

beforeAll(async () => {
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-fed-gap-07-"));
  process.env.DATA_DIR = tempDir;
  process.env.NINEROUTER_PEER_TOKEN = PEER_TOKEN;

  // driver.js caches the adapter on global; paths.js/dataDir.mjs read DATA_DIR at
  // module load, so the cache must be dropped and the modules re-imported after the
  // env is pinned.
  delete global._dbAdapter;
  vi.resetModules();

  keysRoute = await import("../../src/app/api/keys/route.js");
  keysIdRoute = await import("../../src/app/api/keys/[id]/route.js");
  keysRepo = await import("../../src/lib/db/repos/apiKeysRepo.js");
  settingsRepo = await import("../../src/lib/db/repos/settingsRepo.js");
  driver = await import("../../src/lib/db/driver.js");
  guard = await import("../../src/dashboardGuard.js");

  // The one real create: a plain Request, exactly as the route's callers build one.
  const res = await keysRoute.POST(
    new Request("http://9router.test/api/keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "fed-gap-07-chain" }),
    })
  );
  const body = await res.json();
  created = { status: res.status, body, headerNames: Object.keys(body).sort() };
  createdKey = body.key;
}, 60000);

afterAll(() => {
  try {
    global._dbAdapter?.instance?.close?.();
  } catch {
    /* noop */
  }
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  tempDir = null;
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

// A remote (non-loopback) request to a public LLM API path: the peer proof headers say
// the socket was a real TCP peer at 203.0.113.7, never a loopback client, and no CLI
// token is presented. Nothing here dispatches upstream — proxy() only gates.
function remoteV1Request(pathname, { authorization } = {}) {
  const headers = { "x-9r-peer-token": PEER_TOKEN, "x-9r-real-ip": REMOTE_IP };
  if (authorization) headers.authorization = authorization;
  return new NextRequest(`http://9router.test${pathname}`, { headers });
}

function isPassThrough(res) {
  // NextResponse.next() as the shipped next/server produces it: status 200 carrying
  // only the middleware-continue marker.
  return res.status === 200 && res.headers.get("x-middleware-next") === "1";
}

// ─── The real route: POST /api/keys ─────────────────────────────────────

describe("real POST /api/keys route (src/app/api/keys/route.js)", () => {
  it("answers 201 with exactly {key,name,id,machineId} for a named key", () => {
    expect(created.status).toBe(201);
    expect(created.headerNames).toEqual(["id", "key", "machineId", "name"]);
    expect(created.body.name).toBe("fed-gap-07-chain");
    expect(created.body.id).toEqual(expect.any(String));
    // The value a /v1 caller must present: a real generated credential, not a stub.
    expect(created.body.key).toMatch(/^sk-/);
    // machineId comes from the server-side getConsistentMachineId(), never the body.
    expect(created.body.machineId).toMatch(/^[0-9a-f]{16}$/);
  });

  it("persists that id as an ACTIVE row the repository can read back", async () => {
    const rows = await keysRepo.getApiKeys();
    const row = rows.find((r) => r.id === created.body.id);
    expect(row).toBeDefined();
    expect(row.isActive).toBe(true);
    expect(row.key).toBe(created.body.key);
    expect(row.name).toBe("fed-gap-07-chain");
    expect(row.machineId).toBe(created.body.machineId);
  });

  it("answers 400 for a missing name and stores nothing", async () => {
    const before = (await keysRepo.getApiKeys()).length;
    const res = await keysRoute.POST(
      new Request("http://9router.test/api/keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      })
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Name is required" });
    expect((await keysRepo.getApiKeys()).length).toBe(before);
  });
});

// ─── The real guard: proxy() at /v1 ─────────────────────────────────────

describe("real dashboardGuard proxy() authenticating a created key at /v1", () => {
  it("premise: the fixture peer is REMOTE and the fresh DB requires a key", async () => {
    const settings = await settingsRepo.getSettings();
    expect(settings.requireApiKey).toBe(true);
    // If this ever reads true, the request is treated as local and every negative
    // control below would pass without the guard consulting the database at all.
    expect(guard.__test__.isLocalRequest(remoteV1Request("/v1/models"))).toBe(false);
  });

  it("positive: the key POST /api/keys just returned passes the real guard", async () => {
    const res = await guard.proxy(
      remoteV1Request("/v1/models", { authorization: `Bearer ${createdKey}` })
    );
    expect(isPassThrough(res)).toBe(true);
  });

  it("negative control A: the same request with no key → 401", async () => {
    const res = await guard.proxy(remoteV1Request("/v1/models"));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toEqual(KEY_REQUIRED_ERROR);
  });

  it("negative control B: a bogus key of the same shape → the same 401", async () => {
    // A syntactically plausible neighbour of the real key (last character flipped):
    // never the federation token, never another live credential.
    const bogus = createdKey.slice(0, -1) + (createdKey.endsWith("a") ? "b" : "a");
    expect(bogus).not.toBe(createdKey);
    expect(await keysRepo.validateApiKey(bogus)).toBe(false);

    const res = await guard.proxy(remoteV1Request("/v1/models", { authorization: `Bearer ${bogus}` }));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toEqual(KEY_REQUIRED_ERROR);
  });

  it("negative control C: deactivating the row flips the accepted request back to 401", async () => {
    // Same request, same key, one database column changed. If the guard were not
    // reading the row, this would keep returning the pass-through.
    await keysRepo.updateApiKey(created.body.id, { isActive: false });
    expect((await keysRepo.getApiKeys()).find((r) => r.id === created.body.id).isActive).toBe(false);
    expect(await keysRepo.validateApiKey(createdKey)).toBe(false);

    const denied = await guard.proxy(
      remoteV1Request("/v1/models", { authorization: `Bearer ${createdKey}` })
    );
    expect(denied.status).toBe(401);
    expect((await denied.json()).error).toEqual(KEY_REQUIRED_ERROR);

    // Reactivating restores the pass-through — so the 401 above came from the row
    // state and nothing else in this file's ordering.
    await keysRepo.updateApiKey(created.body.id, { isActive: true });
    const restored = await guard.proxy(
      remoteV1Request("/v1/models", { authorization: `Bearer ${createdKey}` })
    );
    expect(isPassThrough(restored)).toBe(true);
  });

  it("accepts the key on a second public prefix (/v1/chat/completions) too", async () => {
    const res = await guard.proxy(
      remoteV1Request("/v1/chat/completions", { authorization: `Bearer ${createdKey}` })
    );
    expect(isPassThrough(res)).toBe(true);
  });

  it("negative control D: DELETING the row revokes the key the guard just accepted", async () => {
    // FED-GAP-13. deleteApiKey is a TOMBSTONE (stampDelete sets deleted = 1 and
    // leaves isActive = 1 — federation replication needs the row to survive), so
    // this is the assertion that fails if the auth read forgets the NOT_DELETED
    // predicate: pre-fix the deleted key kept passing the guard for remote /v1
    // traffic — a revocation that did not revoke.
    // Premise first: the key is accepted right now (control C restored it).
    expect(
      isPassThrough(
        await guard.proxy(remoteV1Request("/v1/models", { authorization: `Bearer ${createdKey}` }))
      )
    ).toBe(true);

    expect(await keysRepo.deleteApiKey(created.body.id)).toBe(true);

    // "revoked, not merely hidden": the authorization read refuses it AND the
    // logical reads hide it — the trio is the whole claim.
    expect(await keysRepo.validateApiKey(createdKey)).toBe(false);
    expect(await keysRepo.getApiKeyById(created.body.id)).toBeNull();
    expect((await keysRepo.getApiKeys()).some((r) => r.id === created.body.id)).toBe(false);

    const revoked = await guard.proxy(
      remoteV1Request("/v1/models", { authorization: `Bearer ${createdKey}` })
    );
    expect(revoked.status).toBe(401);
    expect(revoked.headers.get("x-middleware-next")).toBeNull();
    expect((await revoked.json()).error).toEqual(KEY_REQUIRED_ERROR);
  });
});

// ─── FED-GAP-13: revocation through the shipped routes ──────────────────
//
// The defect: DELETE /api/keys/[id] answered "Key deleted successfully" while
// the credential kept authenticating remote /v1 traffic (validateApiKey read the
// tombstoned row). This describe walks the revocation from the ROUTE down to the
// guard, and pins the two things a one-line predicate fix could silently break:
// the row must stay a tombstone (not become a hard delete — the federation delta
// ships deletions as tombstones), and a key created afterwards must still work.
//
// It is a SEQUENCE over the file's one temp DB: each test builds on the row the
// previous one asserted, and vitest runs it-blocks in declaration order.
describe("FED-GAP-13 revocation via the shipped routes", () => {
  let viaRouteKey;
  let viaRouteId;
  let viaRepoKey;
  let viaRepoId;

  it("setup: two freshly created keys are accepted by the real guard", async () => {
    const a = await keysRepo.createApiKey("fed-gap-13-via-route", created.body.machineId);
    const b = await keysRepo.createApiKey("fed-gap-13-via-repo", created.body.machineId);
    viaRouteKey = a.key;
    viaRouteId = a.id;
    viaRepoKey = b.key;
    viaRepoId = b.id;

    expect(viaRouteKey).not.toBe(viaRepoKey);
    expect(await keysRepo.validateApiKey(viaRouteKey)).toBe(true);
    expect(await keysRepo.validateApiKey(viaRepoKey)).toBe(true);
    for (const key of [viaRouteKey, viaRepoKey]) {
      expect(
        isPassThrough(
          await guard.proxy(remoteV1Request("/v1/models", { authorization: `Bearer ${key}` }))
        )
      ).toBe(true);
    }
  });

  it("the real DELETE route answers {message} and its key is 401 on the same remote request", async () => {
    const res = await keysIdRoute.DELETE(null, { params: Promise.resolve({ id: viaRouteId }) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ message: "Key deleted successfully" });

    // Tombstone, not a hard delete: the row survives with deleted = 1 so the
    // central's delta endpoint can propagate the deletion to edges.
    const db = await driver.getAdapter();
    const raw = db.all("SELECT deleted, isActive FROM apiKeys WHERE id = ?", [viaRouteId]);
    expect(raw.length).toBe(1);
    expect(raw[0].deleted).toBe(1);

    expect(await keysRepo.validateApiKey(viaRouteKey)).toBe(false);
    const revoked = await guard.proxy(
      remoteV1Request("/v1/models", { authorization: `Bearer ${viaRouteKey}` })
    );
    expect(revoked.status).toBe(401);
    expect(revoked.headers.get("x-middleware-next")).toBeNull();
    expect((await revoked.json()).error).toEqual(KEY_REQUIRED_ERROR);
  });

  it("deleteApiKey (the fn that route delegates to) revokes: validate false, reads hide the row", async () => {
    expect(await keysRepo.deleteApiKey(viaRepoId)).toBe(true);

    expect(await keysRepo.validateApiKey(viaRepoKey)).toBe(false);
    expect(await keysRepo.getApiKeyById(viaRepoId)).toBeNull();
    expect((await keysRepo.getApiKeys()).some((r) => r.id === viaRepoId)).toBe(false);

    const revoked = await guard.proxy(
      remoteV1Request("/v1/models", { authorization: `Bearer ${viaRepoKey}` })
    );
    expect(revoked.status).toBe(401);
    expect(revoked.headers.get("x-middleware-next")).toBeNull();
    expect((await revoked.json()).error).toEqual(KEY_REQUIRED_ERROR);
  });

  it("updateApiKey cannot write behind the tombstone", async () => {
    // A tombstoned row must be invisible to WRITES as well as reads: a direct
    // caller (the federation replay path, which does not pre-check getApiKeyById)
    // could otherwise re-point `key` on a row every sibling read hides.
    const db = await driver.getAdapter();
    const select = "SELECT id, key, name, machineId, isActive, deleted FROM apiKeys WHERE id = ?";
    const before = db.all(select, [viaRepoId])[0];

    const returned = await keysRepo.updateApiKey(viaRepoId, {
      name: "resurrect-attempt",
      isActive: true,
    });
    expect(returned).toBeNull();

    const after = db.all(select, [viaRepoId])[0];
    expect(after).toEqual(before);
    expect(await keysRepo.validateApiKey(viaRepoKey)).toBe(false);
  });

  it("the real PUT route still answers 404 for a deleted id (behaviour unchanged)", async () => {
    const res = await keysIdRoute.PUT(
      new Request("http://9router.test/api/keys/" + viaRepoId, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "resurrect-attempt" }),
      }),
      { params: Promise.resolve({ id: viaRepoId }) }
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Key not found" });
  });

  it("positive control: a key created AFTER the revocations still authenticates", async () => {
    const fresh = await keysRepo.createApiKey("fed-gap-13-fresh-control", created.body.machineId);
    expect(fresh.key).not.toBe(viaRouteKey);
    expect(fresh.key).not.toBe(viaRepoKey);
    expect(await keysRepo.validateApiKey(fresh.key)).toBe(true);

    const res = await guard.proxy(
      remoteV1Request("/v1/models", { authorization: `Bearer ${fresh.key}` })
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });
});

// ─── The file's own premise ─────────────────────────────────────────────

describe("FED-GAP-07 realness guard", () => {
  it("declares no module stand-in (mock call, or import of the localDb barrel)", () => {
    const src = fs.readFileSync(THIS_FILE, "utf8");
    // Needles are assembled from fragments so they cannot match this file's own
    // source text (a contiguous literal would make every check vacuously true).
    const needle = (...parts) => parts.join("");
    expect(src.includes(needle("vi.", "mock", "("))).toBe(false);
    // The guard's validator arrives through src/lib/localDb → src/lib/db/index.js →
    // repos/apiKeysRepo.js; this file imports the repo directly and never the barrel.
    expect(src.includes(needle("@/lib/", "localDb"))).toBe(false);
    expect(src.includes(needle("@/lib/", "db/"))).toBe(false);
  });
});
