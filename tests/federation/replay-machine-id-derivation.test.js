// FED-GAP-12 — prove the CENTRAL-side machineId derivation in the replay path.
//
// Residual this closes: tests/federation/e2e-child.mjs cannot load
// src/shared/utils/machineId.js under plain node (that module does a NAMED
// import from the CommonJS `node-machine-id` package, which only resolves under
// a bundler), so the E2E harness mirrors the derivation in harnessMachineId()
// and hands the replay body a machineId. Nothing then exercised the derivation
// src/lib/federation/server.js performs itself (applyReplayMutation →
// getConsistentMachineId, the parity fix of tick 170): the closest existing
// case (failover.test.js "replays POST /api/keys without machineId") asserted
// the persisted machineId was merely TRUTHY, so a regression in the salt, the
// truncation, or the file/location kept every federation check green.
//
// This test drives the REAL central handler chain — handleReplay →
// applyReplayMutation → createApiKey from src/lib/db/repos/apiKeysRepo.js — with
// the body an edge actually queues for a proxied dashboard write
// (proxy.js forwards the client body verbatim, so `{ name }` and nothing else),
// and asserts the PERSISTED row against the documented formula evaluated
// INDEPENDENTLY in the test from the two real inputs:
//
//   sha256(rawMachineIdFileContents + MACHINE_ID_SALT).digest("hex").substring(0, 16)
//
// The oracle below is never handed to the code under test — it exists so the
// assertion pins the exact input (the DATA_DIR/machine-id file contents), the
// exact salt (the env var, not machineId.js's 'endpoint-proxy-salt' fallback)
// and the exact truncation (16 hex chars of the sha256 digest). The value the
// application persists has to match it on its own.
//
// Determinism/isolation: every case gets its own temp DATA_DIR, its own
// MACHINE_ID_SALT, a machine-id file written by the test, and a freshly
// migrated SQLite DB — so the host's real machine id is never an input and the
// machineIdSync() fallback is structurally unreachable (the file exists). No
// network: handleReplay runs in-process; nothing here calls fetch.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const FED_ENV_KEYS = ["FEDERATION_MODE", "FEDERATION_CENTRAL_URL", "FEDERATION_EDGE_ID", "FEDERATION_TOKEN"];

// Deterministic fixture inputs (never read from the host).
const RAW_A = "37ac1f6b-1111-4a4a-8c3d-00000000000a";
const RAW_B = "37ac1f6b-2222-4a4a-8c3d-00000000000b";
const SALT_A = "fed-gap-12-salt-a";
const SALT_B = "fed-gap-12-salt-b";
// machineId.js's fallback salt when MACHINE_ID_SALT is unset — the value the
// derivation must NOT be using once the env var is set.
const FALLBACK_SALT = "endpoint-proxy-salt";

let tempDir;
let savedEnv = {};
let savedDataDir;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-fed-machineid-"));
  savedEnv = {};
  for (const k of FED_ENV_KEYS.concat(["MACHINE_ID_SALT"])) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  savedDataDir = process.env.DATA_DIR;
  process.env.DATA_DIR = tempDir; // every instance-local path (machine-id, DB) stays in temp
  delete global._dbAdapter;
  vi.resetModules();
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  tempDir = null;
  for (const k of Object.keys(savedEnv)) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  if (savedDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = savedDataDir;
});

// The production formula (src/shared/utils/machineId.js:49-54, called by
// server.js with no salt argument). Evaluated here from the RAW file contents
// and the salt the test installed — an oracle, not a stub.
function deriveExpected(raw, salt) {
  return createHash("sha256").update(raw + salt).digest("hex").substring(0, 16);
}

// The machine-id file the production helper reads first: DATA_DIR/machine-id
// (mode 0600 in production; the content is what matters here).
function writeMachineId(raw) {
  fs.writeFileSync(path.join(tempDir, "machine-id"), raw, { mode: 0o600 });
}

function machineIdFileContents() {
  return fs.readFileSync(path.join(tempDir, "machine-id"), "utf8").trim();
}

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
  const file = path.join(tempDir, `machineid-${Math.random().toString(36).slice(2)}.sqlite`);
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

// A migrated central DB behind the driver + the REAL federation handlers.
// The isolation premise (the machine-id file the derivation reads is the one
// this test wrote) is asserted by the caller.
async function bootCentral() {
  const db = await createMigratedDb();
  pointDriverAt(db);
  const server = await import("@/lib/federation/server.js");
  const machineId = await import("@/shared/utils/machineId.js");
  return { db, server, machineId };
}

// A replay as an edge sends it: the client's body verbatim, no machineId.
function replayRequest({ idempotencyKey, keyName, fencingToken, body }) {
  return {
    json: async () => ({
      idempotency_key: idempotencyKey,
      method: "POST",
      path: "/api/keys",
      body: body || { name: keyName },
      fencing_token: fencingToken,
    }),
  };
}

function persistedKey(db, name) {
  return db.get(`SELECT key, name, machineId FROM apiKeys WHERE name = '${name}'`);
}

describe("FED-GAP-12 — central replay derives the machineId from DATA_DIR/machine-id + MACHINE_ID_SALT", () => {
  // Vitest's default test timeout is 5000 ms. Every case below does dynamic
  // imports, real better-sqlite3 setup + five migrations and temp-dir I/O, and
  // that combination is load-sensitive: a loaded run failed one case with the
  // file's test time summing to 18.4 s while the same file completes in
  // ~0.6 s in isolation. Same class of flake the repo already budgets for —
  // the FED-022 describe in replication.test.js (commit e6e52b8a) sets the
  // identical 30 s budget for the identical reason. Every assertion here is
  // behavioural (exact derived values), never timing-based, so a larger budget
  // can only remove load-induced false reds.
  vi.setConfig({ testTimeout: 30000 });

  it("persists the value derived from the DATA_DIR machine-id file and the MACHINE_ID_SALT env var", async () => {
    process.env.FEDERATION_MODE = "central";
    process.env.FEDERATION_TOKEN = "fed-secret";
    process.env.MACHINE_ID_SALT = SALT_A;
    vi.resetModules();
    writeMachineId(RAW_A);

    // Isolation premise: the helper must resolve the temp DATA_DIR (a stale
    // real ~/.9router path here would make every assertion below meaningless).
    const { DATA_DIR } = await import("@/lib/dataDir.mjs");
    expect(DATA_DIR).toBe(tempDir);

    const { db, server, machineId } = await bootCentral();
    const { fencing_token } = await server.handleVerify({ headers: { get: () => "edge-1" } });

    const applied = await server.handleReplay(
      replayRequest({ idempotencyKey: "k-fed-gap-12-a", keyName: "replayed-key", fencingToken: fencing_token })
    );
    expect(applied.applied).toBe(true);

    const row = persistedKey(db, "replayed-key");
    expect(row).toBeTruthy();
    expect(row.key).toMatch(/^sk-/);
    // Shape: first 16 hex chars of a sha256 digest (truncation pinned).
    expect(row.machineId).toMatch(/^[0-9a-f]{16}$/);
    // The real row equals the formula over the real inputs — evaluated here.
    expect(row.machineId).toBe(deriveExpected(RAW_A, SALT_A));
    // …and equals what the application's own helper derives for this DATA_DIR.
    expect(row.machineId).toBe(await machineId.getConsistentMachineId());
    // The env salt is consumed: not the hardcoded 'endpoint-proxy-salt' fallback.
    expect(row.machineId).not.toBe(deriveExpected(RAW_A, FALLBACK_SALT));
  });

  it("takes the raw id from the file itself — rewriting DATA_DIR/machine-id changes the persisted value and the file is not regenerated", async () => {
    process.env.FEDERATION_MODE = "central";
    process.env.FEDERATION_TOKEN = "fed-secret";
    process.env.MACHINE_ID_SALT = SALT_A;
    vi.resetModules();
    writeMachineId(RAW_B);

    const { db, server } = await bootCentral();
    const { fencing_token } = await server.handleVerify({ headers: { get: () => "edge-1" } });
    await server.handleReplay(
      replayRequest({ idempotencyKey: "k-fed-gap-12-b", keyName: "file-sourced-key", fencingToken: fencing_token })
    );

    const row = persistedKey(db, "file-sourced-key");
    expect(row.machineId).toBe(deriveExpected(RAW_B, SALT_A));
    // Same salt, different file → different id (proves the file is an input,
    // not a constant, and not the host machine id).
    expect(row.machineId).not.toBe(deriveExpected(RAW_A, SALT_A));
    // The derivation READS the machine-id file; it never rewrites it (a
    // regenerate-on-read regression would make the id unstable across calls).
    expect(machineIdFileContents()).toBe(RAW_B);
  });

  it("derives with the MACHINE_ID_SALT that is set, not with a constant salt", async () => {
    process.env.FEDERATION_MODE = "central";
    process.env.FEDERATION_TOKEN = "fed-secret";
    process.env.MACHINE_ID_SALT = SALT_B;
    vi.resetModules();
    writeMachineId(RAW_A);

    const { db, server } = await bootCentral();
    const { fencing_token } = await server.handleVerify({ headers: { get: () => "edge-1" } });
    await server.handleReplay(
      replayRequest({ idempotencyKey: "k-fed-gap-12-c", keyName: "salted-key", fencingToken: fencing_token })
    );

    const row = persistedKey(db, "salted-key");
    expect(row.machineId).toBe(deriveExpected(RAW_A, SALT_B));
    expect(row.machineId).not.toBe(deriveExpected(RAW_A, SALT_A));
  });

  it("still honours an explicit machineId in the replayed body (derivation is a fallback, not an override)", async () => {
    process.env.FEDERATION_MODE = "central";
    process.env.FEDERATION_TOKEN = "fed-secret";
    process.env.MACHINE_ID_SALT = SALT_A;
    vi.resetModules();
    writeMachineId(RAW_A);

    const { db, server } = await bootCentral();
    const { fencing_token } = await server.handleVerify({ headers: { get: () => "edge-1" } });
    await server.handleReplay(
      replayRequest({
        idempotencyKey: "k-fed-gap-12-d",
        fencingToken: fencing_token,
        body: { name: "explicit-machine-key", machineId: "explicit-machine-id-0001" },
      })
    );

    const row = persistedKey(db, "explicit-machine-key");
    expect(row.machineId).toBe("explicit-machine-id-0001");
    expect(row.machineId).not.toBe(deriveExpected(RAW_A, SALT_A));
  });
});
