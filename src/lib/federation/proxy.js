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
import { getEdgeState, canServeFromReplica } from "./state.js";
import { STATES } from "./constants.js";
import { FEDERATION_STATE_HEADER } from "./headers.js";

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

// True when the request is a mutating dashboard API call (the forward-set
// minus /v1). FED-004's DEGRADED-mode write queue intercepts exactly this
// set: /v1 traffic is served from the local replica through the unchanged
// chat pipeline, while dashboard writes are queued.
export function isMutatingDashboardApi(method, url) {
  const m = String(method || "GET").toUpperCase();
  const path = String(url || "").split("?")[0];
  if (path === "/v1" || path.startsWith("/v1/")) return false;
  if (!MUTATING_METHODS.has(m)) return false;
  return MUTATING_API_PREFIXES.some((p) => path === p || path.startsWith(p + "/"));
}

// True when the request is served by the /v1 API surface. DF-9ROUTER-31 uses
// this to bound the pre-DEGRADED fail-open: /v1 requests are READS against the
// replica (the chat pipeline reads accounts/combos/keys/aliases) and are safe
// to serve locally; a mutating dashboard write is NOT — applying it locally
// while still LINKED would bypass the pendingWrites queue and diverge the edge
// from central (the write would never be replayed). Those stay fail-hard in
// the window, so the client retries after the DEGRADED flip and the write is
// queued exactly once.
export function isV1Path(url) {
  const path = String(url || "").split("?")[0];
  return path === "/v1" || path.startsWith("/v1/");
}

// True when the path is a dashboard API path (any method) — the forward-set
// prefixes. FED-005 uses this to tag DEGRADED-mode dashboard READ responses
// with X-Federation-State: degraded (spec §3.5): reads on these paths
// resolve from the local replica while degraded, and the response must say
// so. /v1/* and everything else (static assets, page navigations,
// /api/federation/*) are excluded — the header is a dashboard-data signal,
// not a transport signal.
export function isDashboardApiPath(url) {
  const path = String(url || "").split("?")[0];
  if (path === "/v1" || path.startsWith("/v1/")) return false;
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
// piped through untouched (arbitrary methods/bodies, spec §3.2) — but only
// once the upstream socket is CONNECTED (DF-9ROUTER-31):
//
//   The pre-DEGRADED outage window may now fall back to local replica serving
//   (see proxyRequest), and that fallback hands the SAME req to the local
//   handler. Piping the client body into a doomed upstream request consumes
//   it: the local pipeline would then see an empty body and answer a bogus
//   400. Deferring the pipe to the socket's `connect` event keeps the body
//   readable by whoever ultimately serves the request whenever the failure
//   happened BEFORE a connection ever existed (ECONNREFUSED on a dead
//   central — the dogfood case; verified live: with keep-alive the dead
//   upstream always presents a fresh, not-yet-connected socket, so the body
//   is never touched).
//
//   A failure AFTER connect (central accepted, then reset mid-response) can
//   still consume the body, so such a failure is marked and remains
//   fail-hard — never replayed locally. Both `node:http` and undici-style
//   transports honour this via the `federationBodyUntouched` flag, which the
//   transport and proxyRequest are the only two parties to (undocumented on
//   the public transport contract; injectable transports simply never set
//   it, which keeps them on the fail-hard path).
export const BODY_UNTOUCHED_FLAG = "federationBodyUntouched";

// Gate a transport error on whether the client body is still readable. A
// transport that never sets the flag (a test double, a custom transport) is
// treated as "body consumed" — fail-hard, exactly the pre-DF-31 behavior.
export function isBodyUntouched(err) {
  return err?.[BODY_UNTOUCHED_FLAG] === true;
}

function defaultTransport(req, base, headers) {
  return new Promise((resolve, reject) => {
    const upstream = http.request(
      `${base}${req.url}`,
      { method: req.method, headers },
      (upstreamRes) => resolve({ response: upstreamRes, request: upstream })
    );
    let bodyPiped = false;
    const pipeBody = () => {
      if (bodyPiped) return;
      bodyPiped = true;
      req.pipe(upstream);
    };
    // Pipe on connect for a socket that is still connecting; pipe at once
    // when the agent hands back an already-connected (pooled) socket.
    upstream.on("socket", (socket) => {
      if (socket.connecting === false) pipeBody();
      else socket.once("connect", pipeBody);
    });
    upstream.on("error", (err) => {
      if (!bodyPiped) err[BODY_UNTOUCHED_FLAG] = true;
      reject(err);
    });
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
//
// FED-004: `onUpstreamFailure` is invoked when the upstream request fails
// (connection error/timeout) while the edge is LINKED — the failover state
// machine flips to DEGRADED immediately on a proxy-side 502/timeout (spec
// §3.4). It is injected (not imported) so proxy.js never depends on
// failover.js (no circular import; failover depends on proxy's exports).
//
// DF-9ROUTER-31 (fail-open in the pre-DEGRADED window): while the heartbeat
// failure span has not yet reached the jittered outage threshold the edge is
// still LINKED, so the old code answered a hard 502 FED_UPSTREAM_ERROR — even
// when the local replica was fully caught up (revisionLag 0) and serving from
// it was safe. Now, when the upstream failure happened BEFORE a connection
// existed (the client body is therefore still unread) AND the local replica is
// fresh, the request falls through to the local handlers with
// X-Federation-State: degraded — the same header and the same serving path the
// post-flip DEGRADED state uses. Failures after connect stay fail-hard: the
// body may already have been consumed, so a local replay would read an empty
// body. `isFreshReplica` is injectable (a predicate over the edge's own
// federation_meta); it defaults to the DB-backed check in state.js and,
// crucially, defaults to FALSE whenever `getState` was injected, so callers
// that stub the state read get a pure function with no hidden DB dependency.
export async function proxyRequest(req, res, options = {}) {
  const {
    transport = null,
    getState = null,
    isFreshReplica = null,
    centralUrl = null,
    token = null,
    log = console,
    onUpstreamFailure = null,
  } = options;

  if (!isEdge()) return false; // standalone/central: no-op pass-through

  let state;
  let dbForFreshness = null;
  if (getState) {
    state = getState();
  } else {
    try {
      const { getAdapter } = await import("../db/driver.js");
      const dbAdapter = await getAdapter();
      dbForFreshness = dbAdapter;
      state = getEdgeState(dbAdapter);
    } catch {
      state = STATES.LINKED; // DB unavailable → proxy-up-by-default
    }
  }
  if (state === STATES.DEGRADED) return false; // DEGRADED → local handlers

  // Resolved lazily — only a failed forward ever asks whether the replica is
  // good enough to answer from, so the happy path pays nothing.
  const replicaIsFresh = async () => {
    if (typeof isFreshReplica === "function") return !!isFreshReplica();
    if (getState) return false; // stubbed state ⇒ no DB surprise; fail-hard
    if (!dbForFreshness) return false;
    return canServeFromReplica(dbForFreshness);
  };

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
    // FED-004: a proxy-side upstream failure (502/timeout) while LINKED
    // flips the edge to DEGRADED immediately (spec §3.4). Fire-and-forget —
    // the flip must not block the 502 response.
    if (onUpstreamFailure) {
      try {
        Promise.resolve(onUpstreamFailure(err)).catch((e) => log.error(`[federation] onUpstreamFailure hook failed: ${e?.message || e}`));
      } catch (e) {
        log.error(`[federation] onUpstreamFailure hook failed: ${e?.message || e}`);
      }
    }

    // DF-9ROUTER-31: pre-DEGRADED window, fresh replica, body never sent, /v1
    // request → serve locally instead of failing hard. The client keeps its
    // unread body, so the local pipeline sees a request identical to one that
    // arrived while DEGRADED. Bounded to /v1 on purpose: those are reads
    // against the replica. A mutating dashboard write stays fail-hard below —
    // applying it locally while still LINKED would skip the pendingWrites
    // queue and diverge the edge (it would never be replayed).
    if (isV1Path(req.url) && isBodyUntouched(err) && (await replicaIsFresh())) {
      log.warn(
        `[federation] edge proxy: upstream ${req.method} ${req.url} failed before the request body was sent; ` +
          `serving from the fresh local replica (state '${state}').`
      );
      try {
        res.setHeader(FEDERATION_STATE_HEADER, STATES.DEGRADED);
      } catch {
        /* response already gone — the local handler will fail on its own */
      }
      return false;
    }

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
