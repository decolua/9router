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

let sessionPromise = null;
const proxySessions = new Map();

export class OpencodeTlsUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = "OpencodeTlsUnavailableError";
  }
}

async function createImpersonatedSession(proxy) {
  const wreq = await loadRuntimeDep("wreq-js");
  if (typeof wreq.createSession !== "function") {
    throw new Error("wreq-js runtime is missing createSession");
  }
  return wreq.createSession({
    emulation: { tlsOptions: { cipherList: OPENCODE_CIPHER_LIST } },
    // Public pool proxies routinely terminate TLS with broken or MITM certs;
    // verification stays on for the direct path, but a proxied session would
    // otherwise fail as 502 CERTIFICATE_VERIFY_FAILED before the gate is reached.
    ...(proxy ? { proxy, insecure: true } : {}),
  });
}

async function loadSession(proxy = null) {
  if (!proxy) {
    if (!sessionPromise) {
      sessionPromise = createImpersonatedSession(null).catch((error) => {
        sessionPromise = null;
        throw error;
      });
    }
    return sessionPromise;
  }
  // wreq-js locks the proxy for a session's lifetime ("Session proxy cannot be
  // changed after creation"), so each pool proxy gets its own cached session.
  let pending = proxySessions.get(proxy);
  if (!pending) {
    pending = createImpersonatedSession(proxy).catch((error) => {
      proxySessions.delete(proxy);
      throw error;
    });
    proxySessions.set(proxy, pending);
  }
  return pending;
}

/** Drop cached sessions so the next call builds fresh ones. */
export function resetOpencodeTlsSession() {
  const pending = sessionPromise;
  sessionPromise = null;
  pending?.then((session) => session.close?.()).catch(() => {});
  for (const entry of proxySessions.values()) {
    entry?.then((session) => session.close?.()).catch(() => {});
  }
  proxySessions.clear();
}

/**
 * Fetch through the impersonated-TLS session. Returns a native Response so
 * downstream `.body` / `.text()` / `.json()` consumers keep working unchanged.
 *
 * Streaming is preserved: the response body is handed over as the live
 * ReadableStream, never buffered.
 */
export async function opencodeTlsFetch(url, init = {}, { signal, timeoutMs = DEFAULT_TIMEOUT_MS, proxy = null } = {}) {
  let session;
  try {
    session = await loadSession(proxy);
  } catch (error) {
    throw new OpencodeTlsUnavailableError(
      `wreq-js unavailable (${error instanceof Error ? error.message : "unknown"}) — install the optional wreq-js dependency to reach the OpenCode free tier`
    );
  }

  const options = {
    method: init.method || "GET",
    headers: init.headers,
    redirect: "follow",
    timeout: timeoutMs,
  };
  // The free gate keys on the TLS ClientHello only (measured: same egress IP
  // passes on Bun's cipher hash and is refused on OpenSSL), so routing the
  // impersonated session through a pool proxy keeps the fingerprint while
  // moving the egress. The proxy is bound at session creation.
  if (init.body !== undefined) options.body = init.body;
  if (signal) options.signal = signal;

  const res = await session.fetch(url, options);
  const headers = {};
  res.headers?.forEach?.((value, key) => {
    headers[key] = value;
  });
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

export const __test__ = { OPENCODE_CIPHER_LIST };
