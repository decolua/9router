// FED-006 — e2e child: ONE federation instance (central or edge) for the
// 3-instance lifecycle proof. Spawned by e2e.mjs (see that file for the
// full scenario). This process:
//
//   - serves the federation API through the REAL framework-free handlers
//     (src/lib/federation/server.js) with the same Bearer-token gate the
//     Next.js route wrappers apply (roleGuard.js semantics, inlined here
//     because next/server is not importable outside a Next build)
//   - serves the REAL application route modules over this HTTP server through
//     the Next route contract (web Request in → web Response out):
//       GET/OPTIONS  /api/health      ← src/app/api/health/route.js (the file
//                                        the packaged app routes to)
//       POST /v1/chat/completions     ← src/app/api/v1/chat/completions/route.js
//                                        for the app's credentialless
//                                        FREE-TIER model only (FED-GAP-04)
//     The free-tier provider's OUTBOUND transport is answered by the local
//     fixture in free-tier-fixture.mjs, so the completion is deterministic and
//     network-free while every other stage (auth, model resolution, free-tier
//     credential injection, translation, SSE) is the app's real code.
//   - runs the REAL edge proxy (proxy.js), DEGRADED write queue (queue.js),
//     failover state machine (failover.js) and replication poll
//     (edgeClient.js) — the same modules custom-server.js wires in
//   - serves a minimal local /v1 stand-in that reads the local replica
//     (the real chat pipeline reads the same local tables: accounts,
//     combos, keys, aliases) for the synthetic `e2e-model` the federation
//     lifecycle phases use
//   - reports readiness on stdout as: E2E_READY {"role":...,"port":...}
//
// Env: 9ROUTER_E2E_SRC (repo src/), E2E_ROLE (central|edge|standalone),
// E2E_EDGE_ID, E2E_PORT (0 = ephemeral), DATA_DIR, FEDERATION_* (as in a
// real deployment).
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, timingSafeEqual, randomUUID } from "node:crypto";
import { resolveFreeTierTarget, installFreeTierFixture } from "./free-tier-fixture.mjs";

const ROLE = process.env.E2E_ROLE || "edge";
const EDGE_ID = process.env.E2E_EDGE_ID || process.env.FEDERATION_EDGE_ID || "edge";
const PORT = Number(process.env.E2E_PORT || 0);

// Captured BEFORE any app module loads (every app import below is dynamic):
// the free-tier fixture must pass unrelated requests through to the NATIVE
// fetch. Capturing later would pick up the app's patched proxy wrapper and
// recurse (see installFreeTierFixture).
const NATIVE_FETCH = globalThis.fetch;

const { getAdapter } = await import("@/lib/db/driver.js");
const {
  handleSnapshot,
  handleDelta,
  handleVerify,
  handleStatus,
  handleReplay,
  handleLocalStatus,
  handleConfigStatus,
  applyReplayMutation,
  HttpError,
} = await import("@/lib/federation/server.js");
const { proxyRequest, isMutatingDashboardApi } = await import("@/lib/federation/proxy.js");
const { handleDegradedWrite } = await import("@/lib/federation/queue.js");
const { flipToDegraded, start: startFailover } = await import("@/lib/federation/failover.js");
const { getEdgeState } = await import("@/lib/federation/state.js");
const { start: startEdgeClient } = await import("@/lib/federation/edgeClient.js");
const { getToken } = await import("@/lib/federation/config.js");
// The real /api/keys route reads through this repo function — the harness
// reuses it (rather than hand-written SQL) so the local replica read applies
// the same NOT_DELETED filter production applies (FED-GAP-01).
const { getApiKeys } = await import("@/lib/db/repos/apiKeysRepo.js");
const { DATA_DIR } = await import("@/lib/dataDir.mjs");

// ─── REAL application routes (FED-GAP-04) ────────────────────────────────
// The health route is the tracked module the packaged app serves; it is
// loaded here and dispatched through the Next route contract below, so the
// harness exercises the application's own route code (its status, its JSON
// body and its CORS headers), never a hand-rolled copy. The chat route is
// imported lazily: only instances that actually serve a free-tier completion
// pay for loading the SSE pipeline.
const healthRoute = await import("@/app/api/health/route.js");
const healthRouteFile = (() => {
  try {
    return fileURLToPath(import.meta.resolve("@/app/api/health/route.js"));
  } catch {
    return path.join(String(process.env["9ROUTER_E2E_SRC"] || ""), "app", "api", "health", "route.js");
  }
})();
// Provenance: the sha256 of the route source that is actually loaded. The E2E
// compares it against the file in the repo, so the check cannot pass against a
// re-implemented (harness-only) endpoint.
const healthRouteSha256 = createHash("sha256").update(fs.readFileSync(healthRouteFile)).digest("hex");

// The app's credentialless free-tier completion target + the deterministic
// local transport fixture. The fixture is installed unconditionally: with it
// in place the harness cannot reach the live free-tier endpoint at all.
const FREE_TIER = await resolveFreeTierTarget();
const freeTierFixture = installFreeTierFixture(FREE_TIER, { passthrough: NATIVE_FETCH });
let chatRoute = null;
async function getChatRoute() {
  if (!chatRoute) chatRoute = await import("@/app/api/v1/chat/completions/route.js");
  return chatRoute;
}
const isFreeTierModel = (model) => typeof model === "string" && model === FREE_TIER.model;

// ─── Server-derived machine id (harness-side) ────────────────────────────
// The REAL /api/keys route binds a new key to a server-derived machine id
// (getConsistentMachineId() in src/shared/utils/machineId.js). That module is
// NOT loadable in this plain-node child: it does
// `import { machineIdSync } from "node-machine-id"`, a NAMED import from a
// CommonJS package (main: ./dist/index.js, no "type", no exports map), which
// only resolves under a bundler (Next / vitest interop) — under plain node it
// throws `SyntaxError: Named export 'machineIdSync' not found`, so the shared
// federation replay path could not create an api-key row at all in this
// harness. Mirror the production derivation instead: same DATA_DIR machine-id
// file (created on first use, mode 0600) and the same formula —
// sha256(raw + salt).substring(0, 16). Nothing about the federation apply or
// replication path is bypassed; only the value the next hop would have derived
// is supplied, and the client-visible request body stays just {name}.
function harnessMachineId() {
  const file = path.join(DATA_DIR, "machine-id");
  let raw = null;
  try {
    raw = fs.readFileSync(file, "utf8").trim() || null;
  } catch {
    /* not created yet */
  }
  if (!raw) {
    raw = randomUUID();
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(file, raw, { mode: 0o600 });
    } catch {
      /* best effort — same as the production helper */
    }
  }
  const salt = process.env.MACHINE_ID_SALT || "endpoint-proxy-salt";
  return createHash("sha256").update(raw + salt).digest("hex").substring(0, 16);
}

// ─── Auth (roleGuard.js semantics, inlined — next/server is not
//     importable outside a Next build) ───────────────────────────────────
function tokenMatches(provided, expected) {
  if (!provided || !expected) return false;
  const a = createHash("sha256").update(String(provided)).digest();
  const b = createHash("sha256").update(String(expected)).digest();
  return timingSafeEqual(a, b);
}

function bearerOk(req) {
  const header = req.headers["authorization"] || "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
  return tokenMatches(provided, getToken());
}

// ─── Helpers ─────────────────────────────────────────────────────────────
function writeJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(payload);
}

function tagDegraded(res) {
  if (!res.getHeader("x-federation-state")) res.setHeader("X-Federation-State", "degraded");
}

// Streaming stand-in (dependency-free): the real pipeline streams SSE deltas
// as they arrive; this writes two delta frames + the terminal [DONE] so the
// proxy's relay path (proxy.js relayResponse) is exercised with a real
// event-stream body. Each delta carries the same `source` marker the JSON
// branch uses, so a proxied stream (central) is distinguishable from one
// served locally.
function writeSse(res, revision) {
  const source = ROLE === "central" ? "central" : "local-replica";
  const delta = (content) => ({
    choices: [{ index: 0, delta: { role: "assistant", content }, finish_reason: null }],
    source,
    replicaRevision: revision,
  });
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
  });
  for (const content of ["ok", "!"]) res.write(`data: ${JSON.stringify(delta(content))}\n\n`);
  res.write("data: [DONE]\n\n");
  res.end();
}

function safeJson(str, fallback = null) {
  if (str == null) return fallback;
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

async function toRequest(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);
  return new Request(`http://127.0.0.1${req.url}`, {
    method: req.method,
    headers: req.headers,
    body: body.length ? body : undefined,
  });
}

// Read (and drain) a request body ONCE, returning the raw bytes. The raw
// buffer is what the Next route contract needs (a Request re-built from the
// bytes) and what the JSON branches parse, so a request that is dispatched to
// a real route module is not consumed twice.
async function readRawBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

function requestFrom(req, buf) {
  return new Request(`http://127.0.0.1${req.url}`, {
    method: req.method,
    headers: req.headers,
    body: buf.length ? buf : undefined,
  });
}

// ─── Next route contract adapter ─────────────────────────────────────────
// Next dispatches an app-route module by handing it a web Request and writing
// the returned web Response to the socket (status, headers, streamed body).
// These helpers are that contract: the REAL route module runs and its REAL
// Response is what the client receives. What the harness does not reproduce is
// Next's own router/telemetry around the module — the route logic is the
// app's.
async function writeWebResponse(res, response) {
  const headers = {};
  for (const [k, v] of response.headers) headers[k] = v;
  res.writeHead(response.status, headers);
  if (!response.body) {
    res.end();
    return;
  }
  const reader = response.body.getReader();
  let clientGone = false;
  res.on("close", () => {
    clientGone = true;
    reader.cancel().catch(() => {});
  });
  for (;;) {
    const { done, value } = await reader.read();
    if (done || clientGone) break;
    if (!res.write(Buffer.from(value))) await new Promise((r) => res.once("drain", r));
  }
  if (!clientGone) res.end();
}

async function serveRoute(req, res, handler) {
  const response = await handler(await toRequest(req));
  await writeWebResponse(res, response);
}

// Read a request body as JSON. Returns null for an absent/unparseable body —
// the non-streaming branch is the default.
function bufToJson(buf) {
  if (!buf.length) return null;
  try {
    return JSON.parse(buf.toString("utf8"));
  } catch {
    return null;
  }
}

// ─── Local /v1 handlers ─────────────────────────────────────────────────
// Two surfaces live behind /v1 on a child instance:
//   * the REAL chat route module (FED-GAP-04) for the app's credentialless
//     free-tier model — the full app pipeline runs, with only the free
//     provider's outbound transport answered by the local fixture;
//   * the minimal replica-backed stand-in for the synthetic `e2e-model` the
//     federation lifecycle phases use (the real chat pipeline reads the same
//     local tables: accounts, combos, keys, aliases).
async function handleLocalV1(req, res) {
  const db = await getAdapter();
  const path = (req.url || "").split("?")[0];
  const meta = db.get(`SELECT lastAppliedRevision FROM federation_meta WHERE id = 1`);
  const revision = meta?.lastAppliedRevision ?? 0;

  // The body is read exactly once: the free-tier branch re-builds a web
  // Request from these bytes for the real route, the stand-in parses them.
  const bodyBuf = await readRawBody(req);
  const body = bufToJson(bodyBuf);

  if (path === "/v1/models" || path === "/v1/models/") {
    const rows = db.all(
      `SELECT key, value FROM kv WHERE scope = 'modelAliases' AND (deleted = 0 OR deleted IS NULL) ORDER BY key`
    );
    writeJson(res, 200, {
      object: "list",
      data: rows.map((r) => ({ id: r.key, model: safeJson(r.value, r.value) })),
      source: ROLE === "central" ? "central" : "local-replica",
      replicaRevision: revision,
    });
    return;
  }

  if (path === "/v1/chat/completions" && isFreeTierModel(body?.model)) {
    // REAL route module, Next route contract. `source`/`replicaRevision` are
    // stand-in markers and deliberately absent here: this response is the
    // application's OpenAI-compatible completion, not the harness's.
    const route = await getChatRoute();
    await writeWebResponse(res, await route.POST(requestFrom(req, bodyBuf)));
    return;
  }

  if (path === "/v1/chat/completions" || path === "/v1/responses") {
    if (body?.stream === true) {
      writeSse(res, revision);
      return;
    }
    writeJson(res, 200, {
      id: `e2e-${Date.now()}`,
      object: "chat.completion",
      model: "e2e-model",
      choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
      source: ROLE === "central" ? "central" : "local-replica",
      replicaRevision: revision,
    });
    return;
  }

  writeJson(res, 404, { error: { message: `no local /v1 handler for ${path}` } });
}

// ─── Federation API (central routes gated like the Next wrappers) ───────
const TOKENLESS_ROUTES = new Set(["local-status", "config-status"]);

async function handleFederationApi(req, res, path) {
  const route = path.replace("/api/federation/", "");
  if (!TOKENLESS_ROUTES.has(route) && !bearerOk(req)) {
    writeJson(res, 401, { error: "Missing or invalid FEDERATION_TOKEN" });
    return;
  }
  const r = await toRequest(req);
  try {
    let payload;
    switch (route) {
      case "snapshot":
        payload = await handleSnapshot(r);
        break;
      case "delta":
        payload = await handleDelta(r);
        break;
      case "verify":
        payload = await handleVerify(r);
        break;
      case "status":
        payload = await handleStatus();
        break;
      case "replay":
        payload = await handleReplay(r);
        break;
      case "local-status":
        payload = await handleLocalStatus();
        break;
      case "config-status":
        payload = await handleConfigStatus();
        break;
      default:
        writeJson(res, 404, { error: { message: `unknown federation route ${route}` } });
        return;
    }
    writeJson(res, 200, payload);
  } catch (err) {
    if (err instanceof HttpError) {
      writeJson(res, err.status, { error: err.message, ...err.extra });
    } else {
      console.error("[e2e-child] federation handler error:", err);
      writeJson(res, 500, { error: { message: err?.message || String(err) } });
    }
  }
}

// ─── Main request handler ────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  try {
    const path = (req.url || "").split("?")[0];
    const db = await getAdapter();

    if (ROLE === "edge") {
      const state = getEdgeState(db);

      // DEGRADED write-queue intercept (real queue.js — same branch as
      // custom-server.js): mutating dashboard API calls are queued locally.
      if (state === "degraded" && isMutatingDashboardApi(req.method, req.url)) {
        handleDegradedWrite(req, res, db);
        return;
      }

      // Edge proxy (real proxy.js — same call as custom-server.js): LINKED
      // edges forward /v1/* + mutating dashboard API to central; a
      // 502/timeout flips the edge to DEGRADED immediately.
      const proxied = await proxyRequest(req, res, {
        onUpstreamFailure: () => flipToDegraded({ db }),
      });
      if (proxied) return;

      // Fall through to local handlers; DEGRADED responses say so.
      if (state === "degraded") tagDegraded(res);
    }

    if (path.startsWith("/api/federation/")) {
      await handleFederationApi(req, res, path);
      return;
    }

    if (path === "/v1" || path.startsWith("/v1/")) {
      await handleLocalV1(req, res);
      return;
    }

    // The REAL application health route (src/app/api/health/route.js) through
    // the Next route contract — GET and OPTIONS are the module's own exports.
    // FED-GAP-04: this replaced the harness-only {ok, role, edgeId, state}
    // body, which now lives on the harness-only /api/e2e/instance path below.
    if (path === "/api/health") {
      await serveRoute(req, res, req.method === "OPTIONS" ? healthRoute.OPTIONS : healthRoute.GET);
      return;
    }

    // Harness-only instance introspection. NOT an application route: it
    // reports this child's role/edge id/edge state plus the provenance of the
    // real route module it serves and the free-tier fixture evidence, so the
    // E2E can assert that the completion really reached the free-tier
    // provider's transport (instead of the replica stand-in).
    if (path === "/api/e2e/instance") {
      writeJson(res, 200, {
        ok: true,
        role: ROLE,
        edgeId: EDGE_ID,
        state: ROLE === "edge" ? getEdgeState(db) : null,
        healthRoute: { file: healthRouteFile, sha256: healthRouteSha256 },
        freeTier: {
          providerId: FREE_TIER.providerId,
          alias: FREE_TIER.alias,
          model: FREE_TIER.model,
          upstream: { ...freeTierFixture.state },
        },
      });
      return;
    }

    if (path.startsWith("/api/")) {
      const method = String(req.method || "GET").toUpperCase();
      if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
        // Mutating dashboard API: applied through the same repo functions
        // the real dashboard routes use (applyReplayMutation is the shared
        // path — the replay endpoint uses it too). Token-gated here as the
        // stand-in for the session auth the real routes enforce.
        if (!bearerOk(req)) {
          writeJson(res, 401, { error: { message: "Missing or invalid FEDERATION_TOKEN" } });
          return;
        }
        const r = await toRequest(req);
        const body = await r.json().catch(() => null);
        // POST /api/keys answers with the REAL route's shape
        // (src/app/api/keys/route.js: 201 {key, name, id, machineId}) instead
        // of the generic {ok:true}. The apply path is unchanged
        // (applyReplayMutation → server.js createApiKey), but that path
        // returns no row, so the id set is diffed around the call to recover
        // the created key. Without an id, the write hop through an edge is
        // unobservable and the replication chain cannot be asserted
        // (FED-GAP-01: edge write → central → both edges).
        const keysBefore = path === "/api/keys" ? new Set((await getApiKeys()).map((k) => k.id)) : null;
        // The shared replay path derives the machine id itself when the body
        // carries none (server.js: getConsistentMachineId). That derivation is
        // unavailable in this child (see harnessMachineId), so the harness
        // supplies the same server-derived value; every other path passes the
        // client body through untouched.
        const replayBody = keysBefore && !body?.machineId ? { ...body, machineId: harnessMachineId() } : body;
        const result = await applyReplayMutation(db, { method, path, body: replayBody });
        if (!result.ok) {
          writeJson(res, result.status || 400, { error: { message: result.error } });
          return;
        }
        if (keysBefore) {
          const created = (await getApiKeys()).find((k) => !keysBefore.has(k.id));
          if (created) {
            writeJson(res, 201, {
              key: created.key,
              name: created.name,
              id: created.id,
              machineId: created.machineId,
            });
            return;
          }
        }
        writeJson(res, 200, { ok: true });
        return;
      }
      // GET /api/keys — local REPLICA read. Dashboard GETs are never proxied
      // (proxy.js shouldForward forwards only mutating methods on the
      // forward-set prefixes), so this answers from THIS instance's replica.
      // That asymmetry is what makes the replication chain observable:
      // write via an edge (proxied) → read central → read both edges (local).
      // A sub-path (/api/keys/<id>) still falls through to the 404 below —
      // only the route the real app serves is implemented here.
      if (path === "/api/keys") {
        writeJson(res, 200, { keys: await getApiKeys() });
        return;
      }
      if (path === "/api/settings") {
        const row = db.get(`SELECT data FROM settings WHERE id = 1`);
        writeJson(res, 200, { settings: row ? safeJson(row.data, {}) : {} });
        return;
      }
      writeJson(res, 404, { error: { message: `no local handler for ${method} ${path}` } });
      return;
    }

    writeJson(res, 404, { error: { message: "not found" } });
  } catch (err) {
    console.error("[e2e-child] handler error:", err);
    if (!res.headersSent) writeJson(res, 500, { error: { message: err?.message || String(err) } });
    else res.destroy();
  }
});

// ─── Loops (real modules; only run on edges) ─────────────────────────────
if (ROLE === "edge") {
  // Replication poll: snapshot bootstrap + delta catch-up every 500ms.
  startEdgeClient({ intervalMs: 500 });
  // Failover: heartbeat every 500ms, DEGRADED after 3000ms of failures
  // (jittered ±20%), bounded reconnect backoff so recovery is noticed
  // within ~2s of central returning.
  startFailover({ intervalMs: 500, thresholdMs: 3000, backoffBaseMs: 500, backoffCapMs: 2000 });
}

process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
});

server.listen(PORT, "127.0.0.1", () => {
  const port = server.address().port;
  console.log(`E2E_READY ${JSON.stringify({ role: ROLE, edgeId: EDGE_ID, port })}`);
});
