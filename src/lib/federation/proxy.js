// Federation edge proxy (FED-003) — spec §3.2.
//
// The forwarding layer for LINKED edges. It lives in custom-server.js as
// middleware BEFORE Next.js dispatch and proxies:
//   - every /v1/* request (any method — chat/completions, messages,
//     responses, models, count_tokens, …)
//   - mutating dashboard API calls (POST/PUT/PATCH/DELETE on /api/settings,
//     /api/providers*, /api/keys*, /api/models/alias, /api/combos*,
//     /api/pricing, /api/usage writes)
// up to the central instance with `Authorization: Bearer <FEDERATION_TOKEN>`.
//
// Dashboard GET reads fall through to the local replica (fast, warm — spec
// §3.2). In DEGRADED state (federation_meta.last_state = 'degraded') the
// proxy falls through to local handlers for EVERYTHING (spec §3.4). In
// standalone/central mode the middleware is a pure no-op pass-through.
//
// The module is framework-free and transport-injectable so vitest can drive
// it against a local node:http server without touching Next.js.
import http from "node:http";
import { isEdge, getCentralUrl, getToken } from "./config.js";
import { getEdgeState } from "./state.js";
import { STATES } from "./constants.js";

// ─── Forward-set matching (spec §3.2) ────────────────────────────────────

// Mutating dashboard API prefixes. GET reads on these paths resolve locally
// from the replica and are NOT forwarded.
const MUTATING_API_PREFIXES = [
  "/api/settings",
  "/api/providers",
  "/api/keys",
  "/api/models/alias",
  "/api/combos",
  "/api/pricing",
  "/api/usage",
];

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// A request is forwarded when:
//   - path is /v1 or starts with /v1/ (any method), or
//   - path matches a mutating dashboard API prefix AND the method is
//     POST/PUT/PATCH/DELETE.
// Everything else (dashboard GET reads, /api/federation/*, static assets,
// Next internals) falls through to local handlers.
export function shouldForward(method, url) {
  const m = String(method || "GET").toUpperCase();
  const path = String(url || "").split("?")[0];
  if (path === "/v1" || path.startsWith("/v1/")) return true;
  if (!MUTATING_METHODS.has(m)) return false;
  return MUTATING_API_PREFIXES.some((p) => path === p || path.startsWith(p + "/"));
}

// ─── Header plumbing ─────────────────────────────────────────────────────

// Headers that describe the transport hop and must NOT be replayed upstream
// (the central derives its own view of the peer). Everything else — Content-
// Type, Accept, the client's Authorization (its own API key), x-api-key,
// etc. — passes through untouched.
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
  "x-forwarded-for",
  "x-real-ip",
  "x-9r-via-proxy",
]);

// Build the upstream request headers. The edge's ALREADY-DERIVED client IP
// (x-9r-real-ip, set by custom-server.js from the unspoofable TCP peer) is
// forwarded so the central can key on the real client; client-supplied XFF
// stays stripped (the XFF-stripping boundary is preserved — see
// custom-server.js). The federation token rides in Authorization: Bearer.
// A client's own Authorization (its API key for /v1 calls) is preserved in
// X-9r-Client-Authorization so the central's auth layer can still
// authenticate the end client (the central reads it in a follow-up; the
// header is inert when absent).
export function buildUpstreamHeaders(reqHeaders, token) {
  const out = {};
  for (const [k, v] of Object.entries(reqHeaders || {})) {
    if (v === undefined || v === null) continue;
    const lk = String(k).toLowerCase();
    if (HOP_BY_HOP.has(lk)) continue;
    if (lk === "authorization") {
      out["X-9r-Client-Authorization"] = v;
      continue;
    }
    out[k] = v;
  }
  if (reqHeaders?.["x-9r-real-ip"]) out["x-9r-real-ip"] = reqHeaders["x-9r-real-ip"];
  out.Authorization = `Bearer ${token}`;
  return out;
}

// ─── Streaming response relay ─────────────────────────────────────────────

// Pipe the upstream response back to the client preserving status, headers
// and chunks. SSE: every chunk is written as soon as it arrives (flush per
// chunk) and backpressure is respected via res.write()'s return value +
// 'drain'. Aborts propagate both ways:
//   - client closes / aborts → upstream request is destroyed (via onAbort)
//   - upstream errors/closes early → client response is destroyed
// Returns a promise that resolves when the relay finishes cleanly.
export function relayResponse(upstreamRes, clientRes, { onAbort } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const cleanup = () => {
      upstreamRes.off("data", onData);
      upstreamRes.off("end", onEnd);
      upstreamRes.off("error", onUpstreamError);
      upstreamRes.off("aborted", onUpstreamAborted);
      clientRes.off("close", onClientClose);
      clientRes.off("error", onClientError);
    };
    const done = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };

    const onData = (chunk) => {
      if (settled) return;
      if (!clientRes.write(chunk)) {
        // Backpressure: pause upstream until the client drains.
        upstreamRes.pause();
        clientRes.once("drain", () => {
          if (!settled) upstreamRes.resume();
        });
      }
    };
    const onEnd = () => {
      if (settled) return;
      try {
        clientRes.end();
      } catch {
        /* already closed */
      }
      done();
    };
    const onUpstreamError = (err) => {
      if (settled) return;
      try {
        clientRes.destroy(err);
      } catch {
        /* already closed */
      }
      done();
    };
    const onUpstreamAborted = () => {
      if (settled) return;
      try {
        clientRes.destroy();
      } catch {
        /* already closed */
      }
      done();
    };
    const onClientClose = () => {
      if (settled) return;
      try {
        onAbort?.();
      } catch {
        /* ignore */
      }
      try {
        upstreamRes.destroy();
      } catch {
        /* already destroyed */
      }
      done();
    };
    const onClientError = () => {
      if (settled) return;
      try {
        upstreamRes.destroy();
      } catch {
        /* already destroyed */
      }
      done();
    };

    upstreamRes.on("data", onData);
    upstreamRes.on("end", onEnd);
    upstreamRes.on("error", onUpstreamError);
    upstreamRes.on("aborted", onUpstreamAborted);
    clientRes.on("close", onClientClose);
    clientRes.on("error", onClientError);
  });
}

// ─── Default transport: node:http request to the central ────────────────

// Returns a promise of { response, request }. The request handle is kept so
// client aborts can destroy the upstream socket. The client request body is
// piped through untouched (arbitrary methods/bodies, spec §3.2).
function defaultTransport(req, base, headers) {
  return new Promise((resolve, reject) => {
    const upstream = http.request(
      `${base}${req.url}`,
      { method: req.method, headers },
      (upstreamRes) => resolve({ response: upstreamRes, request: upstream })
    );
    upstream.on("error", reject);
    req.pipe(upstream);
  });
}

// ─── The proxy ───────────────────────────────────────────────────────────

// Proxy one request to the central instance. Returns true when the request
// was handled (response relayed or error response written); false when the
// caller must fall through to the local handler.
//
// Injectable transport: `transport(req, base, headers)` must return a
// promise of { response, request } where `response` is a duck-typed
// IncomingMessage (statusCode, headers, on/pause/resume/destroy) and
// `request` is the upstream request handle (destroy() aborts it). Tests pass
// a fake transport or a real local node:http server pair. `getState`
// defaults to the real federation_meta read (via the DB driver); tests
// inject a stub.
export async function proxyRequest(req, res, options = {}) {
  const {
    transport = null,
    getState = null,
    centralUrl = null,
    token = null,
    log = console,
  } = options;

  if (!isEdge()) return false; // standalone/central: no-op pass-through

  let state;
  if (getState) {
    state = getState();
  } else {
    try {
      const { getAdapter } = await import("../db/driver.js");
      state = getEdgeState(await getAdapter());
    } catch {
      state = STATES.LINKED; // DB unavailable → proxy-up-by-default
    }
  }
  if (state === STATES.DEGRADED) return false; // DEGRADED → local handlers

  if (!shouldForward(req.method, req.url)) return false;

  const base = centralUrl || getCentralUrl();
  const tok = token || getToken();
  if (!base || !tok) {
    log.warn(
      `[federation] edge proxy: FEDERATION_CENTRAL_URL/FEDERATION_TOKEN missing — ` +
        `falling through to local handler for ${req.method} ${req.url} (never proxy without a token).`
    );
    return false;
  }

  const headers = buildUpstreamHeaders(req.headers, tok);
  let handle;
  try {
    handle = transport
      ? await transport(req, base, headers)
      : await defaultTransport(req, base, headers);
  } catch (err) {
    log.error(`[federation] edge proxy: upstream request failed: ${err.message}`);
    if (!res.headersSent) {
      try {
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: { message: "Federation upstream unavailable", code: "FED_UPSTREAM_ERROR" },
          })
        );
      } catch {
        /* already closed */
      }
    } else {
      try {
        res.destroy();
      } catch {
        /* already closed */
      }
    }
    return true;
  }

  const { response: upstreamRes, request: upstreamReq } = handle;
  try {
    res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
  } catch {
    // Client already gone — abort upstream and bail.
    try {
      upstreamReq.destroy();
    } catch {
      /* ignore */
    }
    return true;
  }
  relayResponse(upstreamRes, res, {
    onAbort: () => {
      try {
        upstreamReq.destroy();
      } catch {
        /* ignore */
      }
    },
  });
  return true;
}
