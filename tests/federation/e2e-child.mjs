// FED-006 — e2e child: ONE federation instance (central or edge) for the
// 3-instance lifecycle proof. Spawned by e2e.mjs (see that file for the
// full scenario). This process:
//
//   - serves the federation API through the REAL framework-free handlers
//     (src/lib/federation/server.js) with the same Bearer-token gate the
//     Next.js route wrappers apply (roleGuard.js semantics, inlined here
//     because next/server is not importable outside a Next build)
//   - runs the REAL edge proxy (proxy.js), DEGRADED write queue (queue.js),
//     failover state machine (failover.js) and replication poll
//     (edgeClient.js) — the same modules custom-server.js wires in
//   - serves a minimal local /v1 stand-in that reads the local replica
//     (the real chat pipeline reads the same local tables: accounts,
//     combos, keys, aliases)
//   - reports readiness on stdout as: E2E_READY {"role":...,"port":...}
//
// Env: 9ROUTER_E2E_SRC (repo src/), E2E_ROLE (central|edge|standalone),
// E2E_EDGE_ID, E2E_PORT (0 = ephemeral), DATA_DIR, FEDERATION_* (as in a
// real deployment).
import http from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";

const ROLE = process.env.E2E_ROLE || "edge";
const EDGE_ID = process.env.E2E_EDGE_ID || process.env.FEDERATION_EDGE_ID || "edge";
const PORT = Number(process.env.E2E_PORT || 0);

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

// ─── Local /v1 stand-in (the real chat pipeline reads the same local
//     tables; this minimal handler proves replica-backed serving) ────────
async function handleLocalV1(req, res) {
  const db = await getAdapter();
  const path = (req.url || "").split("?")[0];
  const meta = db.get(`SELECT lastAppliedRevision FROM federation_meta WHERE id = 1`);
  const revision = meta?.lastAppliedRevision ?? 0;

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

  if (path === "/v1/chat/completions" || path === "/v1/responses") {
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

    if (path === "/api/health") {
      const state = ROLE === "edge" ? getEdgeState(db) : null;
      writeJson(res, 200, { ok: true, role: ROLE, edgeId: EDGE_ID, state });
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
        const result = await applyReplayMutation(db, { method, path, body });
        if (!result.ok) {
          writeJson(res, result.status || 400, { error: { message: result.error } });
          return;
        }
        writeJson(res, 200, { ok: true });
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
