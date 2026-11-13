// TLS-impersonating HTTP client for grok.com.
//
// Grok sits behind Cloudflare Enterprise, which rejects Node's native TLS
// fingerprint even with valid sso+sso-rw+cf_clearance cookies. wreq-js sends
// a Chrome-like handshake instead (browser profile chrome_146). The session's
import { loadRuntimeDep } from "./lazyRuntime.js";
// User-Agent must match the browser that earned the cf_clearance cookie —
// callers send GROK_TLS_USER_AGENT with the pasted cookie header.
//
// wreq-js is an optional dependency: when it is not installed, requests fail
// fast with GrokTlsUnavailableError so callers can surface an actionable 503.

const GROK_TLS_BROWSER = "chrome_146";
const GROK_TLS_OS = "macos";

/** Must match the UA of the browser the pasted cf_clearance was issued to. */
export const GROK_TLS_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36";

let sessionPromise = null;

async function loadSession() {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const wreq = await loadRuntimeDep("wreq-js");
      if (typeof wreq.createSession !== "function") {
        throw new Error("wreq-js runtime is missing createSession");
      }
      return wreq.createSession({ browser: GROK_TLS_BROWSER, os: GROK_TLS_OS });
    })().catch((error) => {
      sessionPromise = null;
      throw error;
    });
  }
  return sessionPromise;
}

export class GrokTlsUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = "GrokTlsUnavailableError";
  }
}

/** Cloudflare interstitial pages arrive with 403 + this marker in the body. */
export function isCloudflareChallenge(text) {
  return typeof text === "string" && /just a moment|attention required|cf-mitigated/i.test(text);
}

/**
 * Fetch through the Chrome-TLS session. Returns a native Response — the body
 * is buffered (Grok's NDJSON replies are small), so downstream `.body` /
 * `.text()` consumers keep working unchanged.
 */
export async function grokTlsFetch(url, { method = "GET", headers = {}, body, timeoutMs = 120000, signal } = {}) {
  let session;
  try {
    session = await loadSession();
  } catch (error) {
    throw new GrokTlsUnavailableError(
      `wreq-js unavailable (${error instanceof Error ? error.message : "unknown"}) — install the optional wreq-js dependency to use Grok Web`
    );
  }

  const options = {
    method: method.toUpperCase(),
    headers,
    redirect: "follow",
    timeout: timeoutMs,
  };
  if (body !== undefined) options.body = body;
  if (signal) options.signal = signal;

  const res = await session.fetch(url, options);
  // Buffer as ArrayBuffer, never text(): asset downloads are binary JPEGs and
  // UTF-8 decoding would mangle every non-ASCII byte into U+FFFD.
  const buffer = await res.arrayBuffer();
  const responseHeaders = {};
  try {
    if (res.headers && typeof res.headers.forEach === "function") {
      res.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });
    }
  } catch {
    // Header iteration is best-effort.
  }
  return new Response(buffer, { status: res.status, headers: responseHeaders });
}
