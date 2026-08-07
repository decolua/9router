// Federation central route handlers (FED-002).
//
// The spec's "src/lib/federation/server.js (central routes)" — the route
// LOGIC lives here as plain async functions returning plain JSON payloads;
// thin Next.js wrappers at src/app/api/federation/{snapshot,delta,verify,
// status}/route.js import from this module and translate to NextResponse.
// Keeping the logic framework-free makes it directly testable in vitest
// without mocking next/server.
//
// Role gating: every endpoint refuses to serve when the instance is not
// running as central (standalone/edge → 403). This keeps standalone
// behavior byte-identical to baseline: the routes exist but are inert.
//
// Auth is intentionally OUT of scope (FED-003 adds FEDERATION_TOKEN Bearer
// auth via roleGuard.js).
import { getAdapter } from "../db/driver.js";
import { latestVersion } from "../db/migrations/index.js";
import { buildSnapshot, buildDelta, computeWatermark } from "./replication.js";
import { isCentral, isStandalone, getEdgeId } from "./config.js";

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
export async function handleVerify(request) {
  assertCentral();
  await ensureCentralRole();
  const edgeId =
    request?.headers?.get?.("x-federation-edge-id") ||
    request?.nextUrl?.searchParams?.get?.("edgeId") ||
    null;
  return {
    ok: true,
    role: "central",
    schemaVersion: latestVersion(),
    edgeId,
    revision: computeWatermark(await getAdapter()),
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
