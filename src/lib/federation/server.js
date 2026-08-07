// Federation central route handlers (FED-002, FED-004).
//
// The spec's "src/lib/federation/server.js (central routes)" — the route
// LOGIC lives here as plain async functions returning plain JSON payloads;
// thin Next.js wrappers at src/app/api/federation/{snapshot,delta,verify,
// status,replay}/route.js import from this module and translate to
// NextResponse. Keeping the logic framework-free makes it directly testable
// in vitest without mocking next/server.
//
// Role gating: every endpoint refuses to serve when the instance is not
// running as central (standalone/edge → 403). This keeps standalone
// behavior byte-identical to baseline: the routes exist but are inert.
//
// Auth is enforced by roleGuard.js (FED-003): FEDERATION_TOKEN Bearer on
// every route in non-standalone modes.
//
// Fencing (FED-004, spec §3.3): each /verify heartbeat renews the central
// lease — a fresh fencing_token (randomUUID) + leaseExpiry (now +
// FEDERATION_LEASE_TTL_MS) + leaseOwner (the verify caller's edgeId) are
// persisted in federation_meta and echoed in the response. The edge stores
// the token and presents it with replays; a replay whose token does not
// match the CURRENT lease is rejected 409 (stale-fenced). This is the
// split-brain guard: after a central restart the old token is dead, so a
// zombie edge cannot apply writes against a lease it no longer holds.
import { randomUUID } from "node:crypto";
import { getAdapter } from "../db/driver.js";
import { latestVersion } from "../db/migrations/index.js";
import { buildSnapshot, buildDelta, computeWatermark } from "./replication.js";
import { isCentral, isStandalone, getEdgeId } from "./config.js";

// Lease TTL: how long a fencing token stays valid after issuance. Heartbeats
// renew it, so a healthy edge never sees a stale token; a restarted central
// (or a long network partition) invalidates old tokens.
const LEASE_TTL_MS = 60000;

// Error with an HTTP status, thrown by handlers and translated by the route
// wrappers. Keeps next/server out of this module.
export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.extra = extra;
  }
}

// GET /api/federation/snapshot?since=0
// Full config snapshot in exportDb() shape + version columns. since is
// accepted for protocol symmetry (spec §3.3) — since=0 (or absent) returns
// the full snapshot; since>0 returns the delta-shaped rows (same semantics
// as /delta, so an edge can bootstrap from either endpoint).
export async function handleSnapshot(request) {
  assertCentral();
  await ensureCentralRole();
  const db = await getAdapter();
  const since = parseSince(request);
  if (since > 0) {
    return buildDelta(db, since);
  }
  return buildSnapshot(db);
}

// GET /api/federation/delta?since=N
// Rows with federation_version > N + tombstones + max_version watermark +
// schemaVersion. The edge uses maxVersion as its next lastAppliedRevision.
export async function handleDelta(request) {
  assertCentral();
  await ensureCentralRole();
  const db = await getAdapter();
  return buildDelta(db, parseSince(request));
}

// GET /api/federation/verify
// Reachability + schema-compat probe used by edges as their heartbeat.
// Advertises the central schemaVersion; echoes the requesting edgeId when
// supplied (?edgeId= or X-Federation-Edge-Id header).
//
// FED-004: each verify RENEWS the central lease — a fresh fencing token +
// leaseExpiry are persisted in federation_meta and echoed, with leaseOwner
// set to the verify caller's edgeId. Old edges ignore the extra fields
// (additive protocol change).
export async function handleVerify(request) {
  assertCentral();
  await ensureCentralRole();
  const edgeId =
    request?.headers?.get?.("x-federation-edge-id") ||
    request?.nextUrl?.searchParams?.get?.("edgeId") ||
    null;
  const db = await getAdapter();
  const fencingToken = randomUUID();
  const leaseExpiry = new Date(Date.now() + LEASE_TTL_MS).toISOString();
  db.run(
    `INSERT INTO federation_meta(id, leaseOwner, leaseExpiry, fencing_token) VALUES(1, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       leaseOwner = excluded.leaseOwner,
       leaseExpiry = excluded.leaseExpiry,
       fencing_token = excluded.fencing_token`,
    [edgeId, leaseExpiry, fencingToken]
  );
  return {
    ok: true,
    role: "central",
    schemaVersion: latestVersion(),
    edgeId,
    revision: computeWatermark(db),
    leaseOwner: edgeId,
    leaseExpiry,
    fencing_token: fencingToken,
  };
}

// GET /api/federation/status
// Diagnostics: role, edgeId, lastAppliedRevision, schemaVersion, watermark.
// (Spec §6.1 mentions a JWT/API_KEY_SECRET mismatch warning here — kept
// simple per FED-002 scope: role + schemaVersion + revision.)
export async function handleStatus() {
  const db = await getAdapter();
  const meta = db.get(`SELECT role, edgeId, lastAppliedRevision, schemaVersion FROM federation_meta WHERE id = 1`);
  return {
    role: isCentral() ? "central" : "standalone",
    edgeId: meta?.edgeId || getEdgeId(),
    lastAppliedRevision: meta?.lastAppliedRevision ?? 0,
    schemaVersion: latestVersion(),
    maxVersion: computeWatermark(db),
  };
}

// ─── Replay (FED-004) ────────────────────────────────────────────────────

// POST /api/federation/replay
// Edge → central replay of a queued write. Body:
//   { idempotency_key, method, path, body, fencing_token }
// Semantics (spec §3.3/§3.4):
//   - fencing_token must match the CURRENT central lease → else 409
//     (stale-fenced; the edge re-verifies for a fresh token and retries
//     ONCE, then marks the write failed — no infinite loop).
//   - idempotency_key already in replayLog → 200 no-op (never double-apply;
//     the idempotency contract of the replay path).
//   - otherwise apply the mutation through the same repo functions the
//     dashboard routes use, then record the key in replayLog.
// Returns 200 { applied:true } / 200 { applied:false, duplicate:true } /
// 409 { error } / 400 { error }.
export async function handleReplay(request) {
  assertCentral();
  await ensureCentralRole();
  const db = await getAdapter();

  let body;
  try {
    body = await request.json();
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
  if (!body || typeof body !== "object") {
    throw new HttpError(400, "Replay body must be an object");
  }

  const key = body.idempotency_key;
  if (!key || typeof key !== "string") {
    throw new HttpError(400, "idempotency_key is required");
  }

  // Fencing: the presented token must match the current lease.
  const meta = db.get(`SELECT fencing_token, leaseExpiry FROM federation_meta WHERE id = 1`);
  const currentToken = meta?.fencing_token ?? null;
  if (!currentToken || body.fencing_token !== currentToken) {
    throw new HttpError(409, "Stale fencing token — re-verify to obtain a fresh lease", {
      code: "FED_STALE_FENCE",
    });
  }
  if (meta?.leaseExpiry && new Date(meta.leaseExpiry).getTime() < Date.now()) {
    throw new HttpError(409, "Federation lease expired — re-verify to renew", {
      code: "FED_STALE_FENCE",
    });
  }

  // Idempotency: already applied → no-op.
  const seen = db.get(`SELECT 1 AS x FROM replayLog WHERE idempotency_key = ?`, [key]);
  if (seen) {
    return { applied: false, duplicate: true, idempotency_key: key };
  }

  const method = String(body.method || "GET").toUpperCase();
  const path = String(body.path || "/");
  const payload = body.body ?? null;

  const result = await applyReplayMutation(db, { method, path, body: payload });
  if (!result.ok) {
    throw new HttpError(result.status || 400, result.error || "Replay mutation failed", result.extra || {});
  }

  db.run(
    `INSERT OR IGNORE INTO replayLog(idempotency_key, applied_at, method, path) VALUES(?, ?, ?, ?)`,
    [key, new Date().toISOString(), method, path]
  );
  return { applied: true, idempotency_key: key };
}

// Apply one replayed mutation through the same repo functions the dashboard
// routes use. The forward-set prefixes (proxy.js MUTATING_API_PREFIXES)
// map to their repos:
//   /api/settings        → updateSettings (PATCH)
//   /api/providers       → createProviderConnection (POST) /
//                          updateProviderConnection (PUT/PATCH on /[id]) /
//                          deleteProviderConnection (DELETE on /[id])
//   /api/keys            → createApiKey (POST) / updateApiKey (PUT on /[id]) /
//                          deleteApiKey (DELETE on /[id])
//   /api/models/alias    → setModelAlias (PUT) / deleteModelAlias (DELETE)
//   /api/combos          → createCombo (POST) / updateCombo (PUT/PATCH on
//                          /[id]) / deleteCombo (DELETE on /[id])
//   /api/pricing         → updatePricing (PATCH) / resetPricing|resetAllPricing
//                          (DELETE)
//   /api/usage           → host-local telemetry — NOT replayed (usage stays
//                          local per spec §2; the queue intercepts these
//                          paths for forward-set symmetry but they are
//                          dropped on replay).
// Unknown paths → { ok:false, status:400 } (never silently applied).
// Returns { ok:true } or { ok:false, status, error }.
export async function applyReplayMutation(db, { method, path, body = null } = {}) {
  const m = String(method || "GET").toUpperCase();
  const p = String(path || "").split("?")[0];
  const qs = new URLSearchParams(String(path || "").split("?")[1] || "");

  try {
    if (p === "/api/settings" && m === "PATCH") {
      const { updateSettings } = await import("../db/repos/settingsRepo.js");
      await updateSettings(body && typeof body === "object" ? body : {});
      return { ok: true };
    }

    if (p === "/api/providers" && m === "POST") {
      const { createProviderConnection } = await import("../db/repos/connectionsRepo.js");
      await createProviderConnection(body && typeof body === "object" ? body : {});
      return { ok: true };
    }
    const providersId = p.match(/^\/api\/providers\/([^/]+)$/);
    if (providersId && (m === "PUT" || m === "PATCH")) {
      const { updateProviderConnection } = await import("../db/repos/connectionsRepo.js");
      await updateProviderConnection(decodeURIComponent(providersId[1]), body && typeof body === "object" ? body : {});
      return { ok: true };
    }
    if (providersId && m === "DELETE") {
      const { deleteProviderConnection } = await import("../db/repos/connectionsRepo.js");
      await deleteProviderConnection(decodeURIComponent(providersId[1]));
      return { ok: true };
    }

    if (p === "/api/keys" && m === "POST") {
      const { createApiKey } = await import("../db/repos/apiKeysRepo.js");
      const name = body?.name;
      if (!name) return { ok: false, status: 400, error: "name is required" };
      await createApiKey(name, body?.machineId || null);
      return { ok: true };
    }
    const keysId = p.match(/^\/api\/keys\/([^/]+)$/);
    if (keysId && m === "PUT") {
      const { updateApiKey } = await import("../db/repos/apiKeysRepo.js");
      await updateApiKey(decodeURIComponent(keysId[1]), body && typeof body === "object" ? body : {});
      return { ok: true };
    }
    if (keysId && m === "DELETE") {
      const { deleteApiKey } = await import("../db/repos/apiKeysRepo.js");
      await deleteApiKey(decodeURIComponent(keysId[1]));
      return { ok: true };
    }

    if (p === "/api/models/alias" && m === "PUT") {
      const { setModelAlias } = await import("../db/repos/aliasRepo.js");
      if (!body?.model || !body?.alias) return { ok: false, status: 400, error: "model and alias required" };
      await setModelAlias(body.alias, body.model);
      return { ok: true };
    }
    if (p === "/api/models/alias" && m === "DELETE") {
      const { deleteModelAlias } = await import("../db/repos/aliasRepo.js");
      const alias = qs.get("alias");
      if (!alias) return { ok: false, status: 400, error: "alias required" };
      await deleteModelAlias(alias);
      return { ok: true };
    }

    if (p === "/api/combos" && m === "POST") {
      const { createCombo } = await import("../db/repos/combosRepo.js");
      if (!body?.name) return { ok: false, status: 400, error: "name is required" };
      await createCombo({ name: body.name, models: body.models || [], kind: body.kind || null });
      return { ok: true };
    }
    const combosId = p.match(/^\/api\/combos\/([^/]+)$/);
    if (combosId && (m === "PUT" || m === "PATCH")) {
      const { updateCombo } = await import("../db/repos/combosRepo.js");
      await updateCombo(decodeURIComponent(combosId[1]), body && typeof body === "object" ? body : {});
      return { ok: true };
    }
    if (combosId && m === "DELETE") {
      const { deleteCombo } = await import("../db/repos/combosRepo.js");
      await deleteCombo(decodeURIComponent(combosId[1]));
      return { ok: true };
    }

    if (p === "/api/pricing" && m === "PATCH") {
      const { updatePricing } = await import("../db/repos/pricingRepo.js");
      await updatePricing(body && typeof body === "object" ? body : {});
      return { ok: true };
    }
    if (p === "/api/pricing" && m === "DELETE") {
      const { resetPricing, resetAllPricing } = await import("../db/repos/pricingRepo.js");
      const provider = qs.get("provider");
      const model = qs.get("model");
      if (provider && model) await resetPricing(provider, model);
      else if (provider) await resetPricing(provider);
      else await resetAllPricing();
      return { ok: true };
    }

    if (p === "/api/usage" || p.startsWith("/api/usage/")) {
      // Host-local telemetry — never replayed (spec §2: usage stays local).
      return { ok: true };
    }

    return { ok: false, status: 400, error: `Unsupported replay path ${m} ${p}` };
  } catch (err) {
    return { ok: false, status: 500, error: err?.message || String(err) };
  }
}

// Set federation_meta.role when the instance boots as central (idempotent).
// Called lazily from the central route handlers so the role is recorded the
// first time the federation API is exercised (no boot-time wiring needed).
export async function ensureCentralRole() {
  if (!isCentral()) return;
  const db = await getAdapter();
  db.run(
    `INSERT INTO federation_meta(id, role, schemaVersion) VALUES(1, 'central', ?)
     ON CONFLICT(id) DO UPDATE SET role = 'central', schemaVersion = excluded.schemaVersion`,
    [latestVersion()]
  );
}

function assertCentral() {
  if (isStandalone()) {
    throw new HttpError(403, "Federation is not enabled on this instance (FEDERATION_MODE=standalone)");
  }
  if (!isCentral()) {
    throw new HttpError(403, "This endpoint is only served by the central federation instance");
  }
}

function parseSince(request) {
  let raw = null;
  if (request?.nextUrl?.searchParams?.get) {
    raw = request.nextUrl.searchParams.get("since");
  } else if (typeof request?.url === "string") {
    raw = new URL(request.url).searchParams.get("since");
  }
  if (raw === null || raw === undefined || raw === "") return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    throw new HttpError(400, `Invalid 'since' value '${raw}' (expected a non-negative integer)`);
  }
  return Math.floor(n);
}
