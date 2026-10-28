// TLS-impersonating HTTP client for opencode.ai's free tier.
//
// The free gate keys on the TLS ClientHello, not on headers: a request that
// passes from the OpenCode CLI is refused with 429 FreeUsageLimitError when the
// same body/headers ride Node's OpenSSL fingerprint, and passes again once the
// cipher list matches. Measured 2026-10-26 on one process, one egress IP, three
// transports: node fetch/https/http2 all 429, Bun's BoringSSL fetch 200.
// JA4's cipher hash identifies the list (Bun: 5b57614c22b0), so the match is on
// the cipher-list hash and nothing else — reordering the same list still passes.
//
// wreq-js is an optional dependency; when absent the caller keeps its native
// fetch and stays subject to the gate rather than failing the request here.
//
// Proxy handling (2026-10-28): wreq-js binds `proxy` to a Session AT CREATION
// and throws "Session proxy cannot be changed after creation" when a later
// fetch passes a different one — the none→proxy transition counts as a change
// too. A single shared session therefore cannot follow the round-robin proxy
// pool: every request throws, falls back to the server's own IP, and all
// traffic ends up on one egress identity until the upstream free quota answers
// 429 FreeUsageLimitError under load. Sessions are now cached PER PROXY
// (bounded LRU): the proxy is set when the session is built, and each request
// picks the session matching its resolved proxy.
//
// Fresh-connection mode (OPENCODE_TLS_FRESH=1, 2026-10-29): the configured
// pool hands out 1000 entries that all resolve to the same rotating gateway
// URL, so a per-URL cache collapses to one session and rides one pooled TCP
// connection (one egress IP) until it goes idle. In fresh mode every request
// builds its own impersonated session — a new connection, which the rotating
// gateway maps to a fresh residential egress IP — and the session is closed
// when the response stream ends so connections never pool behind one IP.

import { loadRuntimeDep } from "./lazyRuntime.js";

// BoringSSL/Chrome-family cipher list the upstream accepts, in the order Bun
// sends it. Only the list's hash is compared, so this must stay verbatim.
const OPENCODE_CIPHER_LIST = [
  "TLS_AES_128_GCM_SHA256",
  "TLS_AES_256_GCM_SHA384",
  "TLS_CHACHA20_POLY1305_SHA256",
  "ECDHE-ECDSA-AES128-GCM-SHA256",
  "ECDHE-RSA-AES128-GCM-SHA256",
  "ECDHE-ECDSA-AES256-GCM-SHA384",
  "ECDHE-RSA-AES256-GCM-SHA384",
  "ECDHE-ECDSA-CHACHA20-POLY1305",
  "ECDHE-RSA-CHACHA20-POLY1305",
  "ECDHE-ECDSA-AES128-SHA",
  "ECDHE-RSA-AES128-SHA",
  "ECDHE-ECDSA-AES256-SHA",
  "ECDHE-RSA-AES256-SHA",
  "AES128-GCM-SHA256",
  "AES256-GCM-SHA384",
  "AES128-SHA",
  "AES256-SHA",
].join(":");

const DEFAULT_TIMEOUT_MS = 120000;

// Bound on live impersonated sessions for the pooled (non-fresh) path. The
// round-robin pool hands out a fresh proxy on most requests, so in steady
// state this mainly bounds churn memory; same-proxy retries and concurrent
// requests still share a cached session.
const MAX_PROXY_SESSIONS = 64;

const DIRECT_KEY = "(direct)";
// proxyUrl (or "(direct)") -> Promise<wreq Session>. Map iteration is insertion
// order, so delete+re-set gives LRU semantics.
const sessionCache = new Map();

// OPENCODE_TLS_FRESH=1 — one impersonated session per request (see header
// comment). Sessions are closed when the response stream ends.
const FRESH_TLS = process.env.OPENCODE_TLS_FRESH === "1" || process.env.OPENCODE_TLS_FRESH === "true";

// Fresh connections through the rotating gateway occasionally stall before any
// response headers arrive (slow residential node / gateway congestion); wreq's
// request timeout only fires much later, long after the client has given up.
// Bound the wait for headers instead: abort, drop the session and retry ONCE
// on a brand-new session — a new connection maps to a new egress IP.
const FIRST_RESPONSE_GUARD_MS = 20000;

export class OpencodeTlsUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = "OpencodeTlsUnavailableError";
  }
}

async function buildSession(proxyKey) {
  const wreq = await loadRuntimeDep("wreq-js");
  if (typeof wreq.createSession !== "function") {
    throw new Error("wreq-js runtime is missing createSession");
  }
  const options = {
    emulation: { tlsOptions: { cipherList: OPENCODE_CIPHER_LIST } },
  };
  // The proxy must be part of the session from birth — it cannot be attached
  // or swapped afterwards; wreq-js rejects any post-creation change.
  if (proxyKey && proxyKey !== DIRECT_KEY) options.proxy = proxyKey;
  return wreq.createSession(options);
}

function getSession(proxyUrl) {
  const key = proxyUrl || DIRECT_KEY;
  const cached = sessionCache.get(key);
  if (cached) {
    // LRU touch
    sessionCache.delete(key);
    sessionCache.set(key, cached);
    return cached;
  }
  const created = buildSession(key).catch((error) => {
    if (sessionCache.get(key) === created) sessionCache.delete(key);
    throw error;
  });
  sessionCache.set(key, created);
  while (sessionCache.size > MAX_PROXY_SESSIONS) {
    const oldestKey = sessionCache.keys().next().value;
    const oldest = sessionCache.get(oldestKey);
    sessionCache.delete(oldestKey);
    oldest.then((session) => session.close?.()).catch(() => {});
  }
  return created;
}

/** Drop cached sessions so the next calls build fresh ones. */
export function resetOpencodeTlsSession() {
  const pending = [...sessionCache.values()];
  sessionCache.clear();
  for (const p of pending) p?.then((session) => session.close?.()).catch(() => {});
}

// wreq-js rejects proxy changes on live sessions and refuses fetches on closed
// ones; both mean the cached session is stale, so rebuild once and retry.
const STALE_SESSION_ERROR = /cannot be changed after creation|session is closed|closed session/i;

function unavailableError(cause) {
  return new OpencodeTlsUnavailableError(
    `wreq-js unavailable (${cause instanceof Error ? cause.message : "unknown"}) — install the optional wreq-js dependency to reach the OpenCode free tier`
  );
}

// Wrap the upstream body so the fresh session closes as soon as the response
// is fully consumed (flush) or abandoned (cancel) instead of lingering in a
// connection pool that would keep riding one egress IP.
function finishResponse(res, onClose) {
  const headers = {};
  res.headers?.forEach?.((value, key) => {
    headers[key] = value;
  });
  let body = res.body;
  if (onClose) {
    if (body && typeof body.pipeThrough === "function") {
      body = body.pipeThrough(new TransformStream({ flush: onClose, cancel: onClose }));
    } else {
      onClose();
    }
  }
  return new Response(body, { status: res.status, statusText: res.statusText, headers });
}

/**
 * Fetch through the impersonated-TLS session. Returns a native Response so
 * downstream `.body` / `.text()` / `.json()` consumers keep working unchanged.
 *
 * Streaming is preserved: the response body is handed over as the live
 * ReadableStream, never buffered.
 */
export async function opencodeTlsFetch(url, init = {}, { signal, timeoutMs = DEFAULT_TIMEOUT_MS, proxyUrl } = {}) {
  const send = async (session, signalOverride) => {
    const options = {
      method: init.method || "GET",
      headers: init.headers,
      redirect: "follow",
      timeout: timeoutMs,
    };
    if (init.body !== undefined) options.body = init.body;
    if (signalOverride) options.signal = signalOverride;
    else if (signal) options.signal = signal;
    // NOTE: deliberately no per-request `proxy` here — it rides the session.
    return session.fetch(url, options);
  };

  // Compose a bounded wait for response headers so a stalled gateway
  // connection cannot hang the request. IMPORTANT: wreq-js does not reliably
  // settle session.fetch when its signal aborts mid-connect, so awaiting the
  // fetch directly (even with an AbortController) can hang forever. Race the
  // fetch against a rejecting deadline instead — if the deadline wins the
  // caller escapes immediately, the session is closed (killing the stalled
  // socket) and the request retries on a brand-new session.
  const sendWithGuard = async (session) => {
    if (!FRESH_TLS) return send(session, signal);
    let guardTimer;
    let guardReject;
    const guard = new Promise((_, reject) => {
      guardReject = reject;
      guardTimer = setTimeout(
        () => guardReject(new Error(`opencode tls: no response headers within ${Math.round(FIRST_RESPONSE_GUARD_MS / 1000)}s (gateway connection stalled)`)),
        FIRST_RESPONSE_GUARD_MS
      );
    });
    try {
      // Promise.race subscribes to both inputs, so whichever way the abandoned
      // fetch settles later it stays handled — no unhandled rejections.
      return await Promise.race([send(session, signal), guard]);
    } finally {
      clearTimeout(guardTimer);
    }
  };

  let session;
  try {
    session = FRESH_TLS ? await buildSession(proxyUrl || DIRECT_KEY) : await getSession(proxyUrl);
  } catch (error) {
    throw unavailableError(error);
  }

  const closeSession = (target) => { try { (target || session).close?.(); } catch { } };

  let res;
  if (FRESH_TLS) {
    try {
      res = await sendWithGuard(session);
    } catch (error) {
      closeSession(session);
      // One retry on a brand-new session: the stall was connection-specific and
      // a fresh connection picks a fresh gateway egress.
      try {
        session = await buildSession(proxyUrl || DIRECT_KEY);
      } catch (retryError) {
        throw unavailableError(retryError);
      }
      try {
        res = await sendWithGuard(session);
      } catch (error2) {
        closeSession(session);
        throw error2;
      }
    }
  } else {
    try {
      res = await sendWithGuard(session);
    } catch (error) {
      if (!(error instanceof Error && STALE_SESSION_ERROR.test(error.message))) throw error;
      // Stale/bound session — rebuild this proxy's session and retry once.
      sessionCache.delete(proxyUrl || DIRECT_KEY);
      try {
        session = await getSession(proxyUrl);
      } catch (retryError) {
        throw unavailableError(retryError);
      }
      res = await sendWithGuard(session);
    }
  }

  return finishResponse(res, FRESH_TLS ? () => closeSession(session) : null);
}

export const __test__ = { OPENCODE_CIPHER_LIST };
