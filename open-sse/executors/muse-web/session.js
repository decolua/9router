// muse.ai session facts: cookie parsing and the /api/session renewal flow.
//
// Everything here was observed from the public web client and may change
// without notice. Keep upstream-specific constants in this module so that a
// site update is a one-file fix.

const SITE = "https://muse.ai";
const NEW_THREAD_URL = `${SITE}/thread/new`;
const SESSION_API = `${SITE}/api/session`;
const VM_WAKE_API = `${SITE}/api/hatch/vm/wake`;

// Cookies that together make up a logged-in session.
const SESSION_COOKIES = ["hatch_sess", "hatch_gw", "hatch_vml", "hatch_native_auth_device"];

const MUSE_USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/140.0.0.0 Safari/537.36";

// Error kinds the executor maps to HTTP statuses.
export class MuseWebAuthError extends Error {
  constructor(message) {
    super(message);
    this.name = "MuseWebAuthError";
  }
}
export class MuseWebUpstreamError extends Error {
  constructor(message) {
    super(message);
    this.name = "MuseWebUpstreamError";
  }
}
export class MuseWebQuotaError extends Error {
  constructor(message) {
    super(message);
    this.name = "MuseWebQuotaError";
  }
}
export class MuseWebTimeoutError extends Error {
  constructor(message) {
    super(message);
    this.name = "MuseWebTimeoutError";
  }
}

const COOKIE_ATTR_NAMES = new Set([
  "path",
  "domain",
  "expires",
  "max-age",
  "secure",
  "httponly",
  "samesite",
]);

/**
 * Parse a raw Cookie header string into [{ name, value }] pairs, skipping
 * cookie attributes (Path, Domain, Expires, ...) that are not pairs.
 */
export function parseCookiePairs(raw) {
  return String(raw || "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const eq = part.indexOf("=");
      if (eq === -1) return null;
      const name = part.slice(0, eq).trim();
      const value = part.slice(eq + 1).trim();
      if (!name || !value) return null;
      if (COOKIE_ATTR_NAMES.has(name.toLowerCase())) return null;
      return { name, value };
    })
    .filter(Boolean);
}

export function cookieHeaderOf(pairs) {
  return pairs
    .filter((p) => p.value)
    .map((p) => `${p.name}=${p.value}`)
    .join("; ");
}

/** Missing required session cookies (empty list when the session looks complete). */
export function missingSessionCookies(pairs) {
  const names = new Set(pairs.map((p) => p.name));
  return SESSION_COOKIES.filter((name) => !names.has(name));
}

/** Playwright addCookies() shape for the .muse.ai domain. */
export function toMuseCookies(header) {
  return parseCookiePairs(header).map(({ name, value }) => ({
    name,
    value,
    domain: name.startsWith("__Host-") ? "muse.ai" : ".muse.ai",
    path: "/",
    secure: true,
    httpOnly: false,
    sameSite: "Lax",
    expires: -1,
  }));
}

function readSetCookies(response) {
  if (typeof response.headers.getSetCookie === "function") {
    return response.headers.getSetCookie();
  }
  const joined = response.headers.get("set-cookie");
  return joined ? [joined] : [];
}

function parseSetCookieLine(line) {
  // "name=value; Path=/; Expires=Wed, 21 Oct 2026 07:28:00 GMT" → first pair only
  const firstPair = line.split(";")[0].trim();
  const eq = firstPair.indexOf("=");
  if (eq <= 0) return null;
  return { name: firstPair.slice(0, eq).trim(), value: firstPair.slice(eq + 1).trim() };
}

function parseSetCookieExpires(line) {
  const match = line.match(/expires\s*=\s*([^;]+)/i);
  if (!match) return 0;
  const ts = Date.parse(match[1].trim());
  return Number.isFinite(ts) ? Math.floor(ts / 1000) : 0;
}

/**
 * Hit the session endpoint, which rotates short-lived cookies via Set-Cookie,
 * and optionally wake the account's cloud workspace so the first request is fast.
 *
 * @returns {Promise<{ cookieHeader: string, jar: Object<string,string>, meta: object }>}
 * @throws {MuseWebAuthError} session rejected (HTTP 401/403)
 * @throws {MuseWebUpstreamError} other non-2xx from the session endpoint
 */
export async function renewSession(rawCookieHeader, { wakeVm = true, timeoutMs = 15000, signal } = {}) {
  const jar = {};
  for (const { name, value } of parseCookiePairs(rawCookieHeader)) jar[name] = value;

  let response;
  try {
    response = await fetch(SESSION_API, {
      headers: {
        "User-Agent": MUSE_USER_AGENT,
        Origin: SITE,
        Referer: NEW_THREAD_URL,
        Accept: "application/json",
        Cookie: cookieHeaderOf(Object.entries(jar).map(([name, value]) => ({ name, value }))),
      },
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new MuseWebUpstreamError(`muse.ai session endpoint unreachable: ${error.message}`);
  }

  if (response.status === 401 || response.status === 403) {
    throw new MuseWebAuthError(`muse.ai session rejected (HTTP ${response.status}); cookies are no longer valid`);
  }
  if (response.status >= 400) {
    throw new MuseWebUpstreamError(`muse.ai session endpoint returned HTTP ${response.status}`);
  }

  for (const line of readSetCookies(response)) {
    const pair = parseSetCookieLine(line);
    if (pair?.value) jar[pair.name] = pair.value;
  }

  let bodyJson = {};
  try {
    const contentType = response.headers.get("content-type") || "";
    if (contentType.startsWith("application/json")) bodyJson = await response.json();
  } catch {
    /* non-JSON body — meta stays empty */
  }

  const meta = {
    session_status: bodyJson.status,
    vm_id: bodyJson.vm_id,
    vm_state: bodyJson.vm_state,
  };

  if (wakeVm && meta.vm_id && meta.vm_state !== "DISABLED") {
    try {
      const wake = await fetch(VM_WAKE_API, {
        method: "POST",
        headers: {
          "User-Agent": MUSE_USER_AGENT,
          Origin: SITE,
          Referer: NEW_THREAD_URL,
          "Content-Type": "application/json",
          Cookie: cookieHeaderOf(Object.entries(jar).map(([name, value]) => ({ name, value }))),
        },
        body: JSON.stringify({
          vm_id: meta.vm_id,
          retry_count: 0,
          connect_attempt_id: crypto.randomUUID(),
        }),
        signal,
      });
      meta.vm_wake_ok = wake.status === 200;
    } catch {
      meta.vm_wake_ok = false;
    }
  }

  const renewedHeader = cookieHeaderOf(Object.entries(jar).map(([name, value]) => ({ name, value })));
  if (meta.session_status && meta.session_status !== "assigned") {
    // Not fatal on its own — the page may still load — but surface it for logs.
    meta.warning = `session status "${meta.session_status}"`;
  }
  return { cookieHeader: renewedHeader, jar, meta };
}

export { SITE, NEW_THREAD_URL, SESSION_API, VM_WAKE_API, SESSION_COOKIES, MUSE_USER_AGENT };
