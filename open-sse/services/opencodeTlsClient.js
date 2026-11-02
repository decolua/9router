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
const DIRECT_KEY = "(direct)";
const MAX_PROXY_SESSIONS = 64;
const sessionCache = new Map();

// Fresh-connection mode (default ON): each request builds an impersonated TLS
// session that is closed as soon as the response stream completes or cancels.
// This prevents connection-pooling reuse from chaining 429 rate-limit states.
// OPENCODE_TLS_FRESH=0 restores pooled sessions per proxy.
const FRESH_TLS = process.env.OPENCODE_TLS_FRESH !== "0" && process.env.OPENCODE_TLS_FRESH !== "false";

export class OpencodeTlsUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = "OpencodeTlsUnavailableError";
  }
}

async function buildSession(proxyUrl) {
  const wreq = await loadRuntimeDep("wreq-js");
  if (typeof wreq.createSession !== "function") {
    throw new Error("wreq-js runtime is missing createSession");
  }
  const options = {
    emulation: { tlsOptions: { cipherList: OPENCODE_CIPHER_LIST } },
  };
  if (proxyUrl && proxyUrl !== DIRECT_KEY) {
    options.proxy = proxyUrl;
  }
  return wreq.createSession(options);
}

function getSession(proxyUrl) {
  const key = proxyUrl || DIRECT_KEY;
  const cached = sessionCache.get(key);
  if (cached) {
    sessionCache.delete(key);
    sessionCache.set(key, cached);
    return cached;
  }
  const p = buildSession(proxyUrl).catch((err) => {
    sessionCache.delete(key);
    throw err;
  });
  sessionCache.set(key, p);
  if (sessionCache.size > MAX_PROXY_SESSIONS) {
    const oldestKey = sessionCache.keys().next().value;
    const oldest = sessionCache.get(oldestKey);
    sessionCache.delete(oldestKey);
    oldest?.then((s) => s?.close?.()).catch(() => {});
  }
  return p;
}

/** Drop cached sessions so subsequent calls build fresh ones. */
export function resetOpencodeTlsSession() {
  for (const [, p] of sessionCache.entries()) {
    p?.then((session) => session?.close?.()).catch(() => {});
  }
  sessionCache.clear();
}

/**
 * Fetch through the impersonated-TLS session. Returns a native Response so
 * downstream `.body` / `.text()` / `.json()` consumers keep working unchanged.
 *
 * Streaming is preserved: the response body is handed over as the live
 * ReadableStream, never buffered. Sockets are gracefully torn down when
 * the stream finishes or cancels.
 */
export async function opencodeTlsFetch(url, init = {}, { signal, timeoutMs = DEFAULT_TIMEOUT_MS, proxyUrl } = {}) {
  let session;
  try {
    session = FRESH_TLS ? await buildSession(proxyUrl) : await getSession(proxyUrl);
  } catch (error) {
    throw new OpencodeTlsUnavailableError(
      `wreq-js unavailable (${error instanceof Error ? error.message : "unknown"}) — install the optional wreq-js dependency to reach the OpenCode free tier`
    );
  }

  const closeSession = () => {
    try {
      const p = session?.close?.();
      if (p && typeof p.catch === "function") p.catch(() => {});
    } catch {}
  };

  const options = {
    method: init.method || "GET",
    headers: {
      ...init.headers,
      "Connection": "close",
    },
    redirect: "follow",
    timeout: timeoutMs,
  };
  if (init.body !== undefined) options.body = init.body;
  if (signal) options.signal = signal;

  let res;
  try {
    res = await session.fetch(url, options);
  } catch (err) {
    if (FRESH_TLS) closeSession();
    throw err;
  }

  const headers = {};
  res.headers?.forEach?.((value, key) => {
    headers[key] = value;
  });

  let body = res.body;
  if (FRESH_TLS) {
    if (body && typeof body.pipeThrough === "function") {
      body = body.pipeThrough(new TransformStream({
        flush() { closeSession(); },
        cancel() { closeSession(); }
      }));
    } else {
      closeSession();
    }
  }

  return new Response(body, { status: res.status, statusText: res.statusText, headers });
}

export const __test__ = { OPENCODE_CIPHER_LIST };
