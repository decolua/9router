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

// A session fixes its proxy at creation, so one session per egress.
const sessions = new Map();
const MAX_SESSIONS = 16;

export class OpencodeTlsUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = "OpencodeTlsUnavailableError";
  }
}

// A failed on-demand install fails the same way on the next call, so remember
// it for a while instead of paying for it every request.
const UNAVAILABLE_RECHECK_MS = 60 * 60 * 1000;
let unavailableUntil = 0;

async function loadSession(proxyUrl = "") {
  if (unavailableUntil > Date.now()) {
    throw new OpencodeTlsUnavailableError("wreq-js install failed recently — retrying later");
  }
  const key = proxyUrl || "";
  let sessionPromise = sessions.get(key);
  if (!sessionPromise) {
    if (sessions.size >= MAX_SESSIONS) {
      const oldest = sessions.keys().next().value;
      const stale = sessions.get(oldest);
      sessions.delete(oldest);
      stale?.then((session) => session.close?.()).catch(() => {});
    }
    sessionPromise = (async () => {
      const wreq = await loadRuntimeDep("wreq-js");
      if (typeof wreq.createSession !== "function") {
        throw new Error("wreq-js runtime is missing createSession");
      }
      // An empty proxy means direct. The native layer handles http(s) CONNECT
      // and SOCKS4/4a/5/5h itself.
      return wreq.createSession({
        ...(key ? { proxy: key } : {}),
        emulation: { tlsOptions: { cipherList: OPENCODE_CIPHER_LIST } },
      });
    })().catch((error) => {
      sessions.delete(key);
      throw error;
    });
    sessions.set(key, sessionPromise);
  }
  return sessionPromise;
}

/**
 * True when the impersonating client can be built, i.e. wreq-js is installed.
 * Fail-open: any load problem reports "not available".
 */
export async function isOpencodeTlsAvailable(proxyUrl = "") {
  try {
    await loadSession(proxyUrl);
    return true;
  } catch {
    return false;
  }
}

/** Drop every cached session so the next call builds a fresh one. */
export function resetOpencodeTlsSession() {
  const pending = [...sessions.values()];
  sessions.clear();
  for (const promise of pending) {
    promise.then((session) => session.close?.()).catch(() => {});
  }
}

/**
 * Fetch through the impersonated-TLS session. Returns a native Response so
 * downstream `.body` / `.text()` / `.json()` consumers keep working unchanged.
 *
 * Streaming is preserved: the response body is handed over as the live
 * ReadableStream, never buffered.
 */
export async function opencodeTlsFetch(url, init = {}, { signal, timeoutMs = DEFAULT_TIMEOUT_MS, proxyUrl = "" } = {}) {
  let session;
  try {
    session = await loadSession(proxyUrl);
  } catch (error) {
    if (error instanceof OpencodeTlsUnavailableError) throw error;
    unavailableUntil = Date.now() + UNAVAILABLE_RECHECK_MS;
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
