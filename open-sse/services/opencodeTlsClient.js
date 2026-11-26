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

// A wreq-js session pins one proxy at creation ("Session proxy cannot be
// changed after creation"), so the cache must be keyed by proxy URL: a proxy
// switch hands out a fresh session instead of silently reusing the old one's
// tunnel. The key "" is the no-proxy (direct) session.
const sessionsByProxy = new Map();
const SESSIONS_MAX = 8;

export class OpencodeTlsUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = "OpencodeTlsUnavailableError";
  }
}

function normalizeProxyKey(proxyUrl) {
  const raw = typeof proxyUrl === "string" ? proxyUrl.trim() : "";
  if (!raw) return "";
  try {
    // Credentials are part of the identity (auth context isolates pools), but
    // must never surface in logs or error text. Keep only scheme://host:port.
    const parsed = new URL(raw);
    return `${parsed.protocol}//${parsed.hostname}${parsed.port ? `:${parsed.port}` : ""}`;
  } catch {
    return raw; // unverifiable — treat the raw string as its own key
  }
}

async function buildSession(proxyUrl) {
  const wreq = await loadRuntimeDep("wreq-js");
  if (typeof wreq.createSession !== "function") {
    throw new Error("wreq-js runtime is missing createSession");
  }
  const session = await wreq.createSession({
    emulation: { tlsOptions: { cipherList: OPENCODE_CIPHER_LIST } },
    // wreq-js natively tunnels http/https/socks5 proxies at the transport
    // layer, so the impersonated TLS handshake still happens through the
    // proxy — not next to it.
    ...(proxyUrl ? { proxy: proxyUrl } : {}),
  });
  return Object.assign(session, { __proxyKey: normalizeProxyKey(proxyUrl) });
}

async function loadSession(proxyUrl = "") {
  const key = normalizeProxyKey(proxyUrl);
  if (!sessionsByProxy.has(key)) {
    if (sessionsByProxy.size >= SESSIONS_MAX) {
      // Evict oldest: a rotated-out pool identity should not hold connections.
      const oldestKey = sessionsByProxy.keys().next().value;
      const oldest = sessionsByProxy.get(oldestKey);
      sessionsByProxy.delete(oldestKey);
      oldest?.then?.((session) => session.close?.()).catch(() => {});
    }
    const promise = buildSession(proxyUrl).catch((error) => {
      sessionsByProxy.delete(key);
      throw error;
    });
    sessionsByProxy.set(key, promise);
  }
  return sessionsByProxy.get(key);
}

/** Drop the cached session(s) so the next call builds a fresh one. */
export function resetOpencodeTlsSession() {
  const pending = [...sessionsByProxy.values()];
  sessionsByProxy.clear();
  for (const promise of pending) promise?.then?.((session) => session.close?.()).catch(() => {});
}

/**
 * Fetch through the impersonated-TLS session. Returns a native Response so
 * downstream `.body` / `.text()` / `.json()` consumers keep working unchanged.
 *
 * Streaming is preserved: the response body is handed over as the live
 * ReadableStream, never buffered.
 *
 * `proxyUrl` routes the whole connection (TCP + impersonated TLS) through the
 * selected proxy. wreq-js owns the transport, so no undici dispatcher is
 * involved. Omit it for the direct path.
 */
export async function opencodeTlsFetch(url, init = {}, { signal, timeoutMs = DEFAULT_TIMEOUT_MS, proxyUrl = "" } = {}) {
  let session;
  try {
    session = await loadSession(proxyUrl);
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
  if (init.body !== undefined) options.body = init.body;
  if (signal) options.signal = signal;

  const res = await session.fetch(url, options);
  const headers = {};
  res.headers?.forEach?.((value, key) => {
    headers[key] = value;
  });
  // Transport-level proof, not selection-level: this is only set after the
  // session that actually holds the proxy tunnel returned a response. The
  // value never carries credentials (normalizeProxyKey strips them).
  if (proxyUrl) headers["x-9r-proxy-via"] = session.__proxyKey || "wreq-js-proxy";
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

export const __test__ = { OPENCODE_CIPHER_LIST, normalizeProxyKey, sessionsByProxy };
