/**
 * Server-side Xiaomi account session login (mimics MiMo Desktop's login surface).
 *
 * Flow (reverse-engineered from Desktop traffic / mimoAccount.js):
 *   1. GET {mimo-server}/api/user/xiaomi/me            -> 302 account /pass/serviceLogin?sid=mimopc&callback={sts}
 *   2. GET account /pass/serviceLogin                   -> 302 /fe/service/login (the SPA)
 *   3. Browser (via the src/proxy.js reverse proxy) completes login on the REAL
 *      page (password / whatever the page offers) — every account.xiaomi.com
 *      request passes through the proxy; Set-Cookie lands in OUR jar (which
 *      travels in the httpOnly 9r_mimo_login cookie between hops).
 *   4. SPA navigates to the sts callback -> rewritten to /__mimo_login/mimo/*,
 *      middleware takes over and follows the chain server-side:
 *      sts -> Set-Cookie serviceToken -> me (200 JSON = logged in).
 *   5. passToken/userId/cUserId read from the jar -> stored on the connection.
 *
 * Edge-safe: no Node-only APIs (used from both middleware and API routes).
 */

const ACCOUNT_HOST = "account.xiaomi.com";
export const SESSION_COOKIE = "9r_mimo_login";
const SESSION_TTL_MS = 15 * 60 * 1000;
const API_UA =
  "miNative PC/Normal Windows_NT/10.0.19045 SDKV/1.0.0 DEVT/PC DEVS/Windows APP/miaccount_desktop APPV/0.1.0";
const SSO_UA = "MiClaw/1.0";
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// Paths that belong to the 9router app itself — never proxy these upstream,
// even while a login session is active. Everything else is fair game: the
// login SPA hits evolving endpoints (/pass2/config, /v3/...), so a static
// allowlist rots fast. (Edge-safe: plain strings only.)
const APP_PREFIXES = [
  "/_next/", "/api/", "/dashboard", "/v1/", "/v1beta/",
  "/login", "/landing", "/__mimo_login/", "/i18n/", "/icons/", "/providers/",
];
const APP_FILES = new Set([
  "/favicon.svg", "/favicon.ico", "/file.svg", "/globe.svg", "/next.svg",
  "/vercel.svg", "/window.svg", "/sw.js", "/robots.txt", "/manifest.webmanifest",
]);

const APP_PATH_MATCHES = (pathname) =>
  APP_FILES.has(pathname) ||
  APP_PREFIXES.some((p) => pathname === p || pathname.startsWith(p.endsWith("/") ? p : p + "/"));

const MIMO_BASES = {
  cn: "https://mimo-server-cn.xiaomimimo.com",
  sgp: "https://mimo-server-sgp.xiaomimimo.com",
  ams: "https://mimo-server-ams.xiaomimimo.com",
  ru: "https://mimo-server-ru.xiaomimimo.com",
  in: "https://mimo-server-in.xiaomimimo.com",
};
// Unknown/absent region falls back to SGP (the international/open cluster).
const DEFAULT_REGION = "sgp";
// passToken-prefix -> last failure ts (60s backoff for the service exchange)
const _exchangeBackoff = new Map();

export function resolveMimoRegionBase(region) {
  const r = String(region || "").toLowerCase();
  return MIMO_BASES[r] || MIMO_BASES[DEFAULT_REGION];
}

/**
 * Browser-facing origin for this request. Prefer the Host header — request.url
 * / nextUrl may carry the bind address (0.0.0.0), which must never leak into
 * rewritten callbacks (start and proxy must agree on the exact same origin,
 * and both see the same Host header).
 */
export function originOf(request) {
  const proto = request.nextUrl?.protocol
    || (request.headers?.get?.("x-forwarded-proto") || "http");
  const host = request.headers?.get?.("host") || request.nextUrl?.host;
  return host ? `${proto}//${host}` : (request.nextUrl?.origin || "http://localhost:20131");
}

// The session (incl. the accumulated cookie jar) travels in the SESSION_COOKIE
// itself — Next runs route handlers and the proxy in separate bundles, so a
// module-level Map is NOT shared between them. Cookie-carried state works
// regardless of runtime topology. httpOnly + SameSite=Lax, TTL-bounded.

export function beginSession(region) {
  const normalizedRegion = String(region || "").toLowerCase();
  return {
    state: crypto.randomUUID(),
    region: normalizedRegion in MIMO_BASES ? normalizedRegion : DEFAULT_REGION,
    proxyUrl: null, // resolved by the start route (env | local-probe for sgp | null)
    jar: new Map(), // "name|domain|path" -> { name, value, domain, path }
    status: "pending",
    createdAt: Date.now(),
    upstreamBase: resolveMimoRegionBase(region),
  };
}

const KEEP_ON_OVERFLOW = /^(passToken|userId|cUserId|serviceToken|.*_serviceToken|.*_ph|.*_slh|deviceId)$/;
// Browser hard limit for one cookie value is 4096 bytes. base64url inflates
// ~1.34x, so the JSON payload must stay under ~2800 to be safe.
const COOKIE_JSON_BUDGET = 2800;

function b64urlEncode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s) {
  let t = s.replace(/-/g, "+").replace(/_/g, "/");
  while (t.length % 4) t += "=";
  const bin = atob(t);
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export function encodeSessionCookie(sess) {
  const entries = [...sess.jar.values()].map((c) => [c.name, c.value, c.domain, c.path]);
  const base = { s: sess.state, r: sess.region, t: sess.createdAt, p: sess.proxyUrl || "" };
  let payload = JSON.stringify({ ...base, j: entries });
  if (payload.length > COOKIE_JSON_BUDGET) {
    // Cookie budget: drop everything but identity/session essentials.
    payload = JSON.stringify({ ...base, j: entries.filter(([name]) => KEEP_ON_OVERFLOW.test(name)) });
  }
  return `v2.${b64urlEncode(payload)}`;
}

export function decodeSessionCookie(value) {
  if (!value) return null;
  let payload;
  try {
    if (value.startsWith("v2.")) {
      payload = JSON.parse(b64urlDecode(value.slice(3)));
    } else if (value.startsWith("v1.")) {
      payload = JSON.parse(decodeURIComponent(value.slice(3))); // legacy
    } else {
      return null;
    }
  } catch {
    return null;
  }
  if (!payload || typeof payload.t !== "number") return null;
  if (Date.now() - payload.t > SESSION_TTL_MS) return null;
  const jar = new Map();
  for (const raw of payload.j || []) {
    if (!Array.isArray(raw) || raw.length < 4) continue;
    const [name, val, domain, path] = raw;
    jar.set(`${name}|${domain}|${path}`, { name, value: val, domain, path });
  }
  return {
    state: payload.s,
    region: payload.r in MIMO_BASES ? payload.r : DEFAULT_REGION,
    proxyUrl: typeof payload.p === "string" && payload.p ? payload.p : null,
    jar,
    status: "pending",
    createdAt: payload.t,
    upstreamBase: resolveMimoRegionBase(payload.r),
  };
}

/** Read the session straight from an incoming request (any runtime). */
export function sessionFromRequest(request) {
  const raw = request.cookies?.get?.(SESSION_COOKIE)?.value
    ?? parseCookieHeader(request.headers?.get?.("cookie"))?.[SESSION_COOKIE];
  return decodeSessionCookie(raw || null);
}

function parseCookieHeader(header) {
  if (!header) return null;
  const out = {};
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

/** Append the re-encoded session to any Response (proxy writes go through here). */
export function attachSessionCookie(response, sess) {
  const headers = new Headers(response.headers);
  headers.append(
    "Set-Cookie",
    `${SESSION_COOKIE}=${encodeSessionCookie(sess)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  );
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function clearedSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

// ---------- cookie jar (server-side) ----------

function jarKey(c) {
  return `${c.name}|${c.domain}|${c.path}`;
}

function domainMatch(cookieDomain, host) {
  const d = String(cookieDomain || "").replace(/^\./, "").toLowerCase();
  const h = String(host || "").toLowerCase();
  return h === d || h.endsWith("." + d);
}

/** Parse one Set-Cookie header value. Returns { cookie, expired } or null. */
function parseSetCookie(raw, requestUrl) {
  if (!raw) return null;
  const parts = raw.split(";");
  const nv = /^([^=]+)=([\s\S]*)$/.exec(parts[0].trim());
  if (!nv) return null;
  const name = nv[1].trim();
  const value = (nv[2] || "").trim();
  const url = new URL(requestUrl);
  const cookie = {
    name,
    value,
    domain: url.hostname,
    path: (url.pathname || "/").replace(/[^/]*$/, "") || "/",
  };
  let expired = value === "EXPIRED";
  for (let i = 1; i < parts.length; i++) {
    const f = parts[i].trim();
    const eq = f.indexOf("=");
    const k = (eq >= 0 ? f.slice(0, eq) : f).trim().toLowerCase();
    const v = eq >= 0 ? f.slice(eq + 1).trim() : "";
    if (k === "domain" && v) cookie.domain = v.replace(/^\./, "");
    else if (k === "path" && v) cookie.path = v;
    else if (k === "expires") {
      if (/expired/i.test(v)) expired = true;
      else {
        const t = Date.parse(v);
        if (!Number.isNaN(t) && t <= Date.now()) expired = true;
      }
    } else if (k === "max-age" && Number(v) <= 0) expired = true;
  }
  return { cookie, expired };
}

export function absorbSetCookies(sess, res, requestUrl) {
  for (const raw of res.headers.getSetCookie?.() || []) {
    const parsed = parseSetCookie(raw, requestUrl);
    if (!parsed) continue;
    const key = jarKey(parsed.cookie);
    if (parsed.expired || !parsed.cookie.value) sess.jar.delete(key);
    else sess.jar.set(key, parsed.cookie);
  }
}

function cookieHeaderFor(sess, targetUrl) {
  const u = new URL(targetUrl);
  const out = [];
  for (const c of sess.jar.values()) {
    if (!domainMatch(c.domain, u.hostname)) continue;
    if (!(u.pathname || "/").startsWith(c.path)) continue;
    out.push(`${c.name}=${c.value}`);
  }
  return out.join("; ");
}

/** Extract identity cookies from the account host jar. */
export function readSessionIdentity(sess) {
  const pick = (name) => {
    for (const c of sess.jar.values()) {
      if (c.name === name && domainMatch(c.domain, ACCOUNT_HOST)) return c.value;
    }
    return null;
  };
  const passToken = pick("passToken");
  if (!passToken || passToken === "EXPIRED") return null;
  return { passToken, userId: pick("userId"), cUserId: pick("cUserId") };
}

/**
 * Redeem the captured passToken for a mimo-server service session using the
 * BATTLE-TESTED desktop handshake (serviceLogin sid=mimopc + clientSign) that
 * powers every existing CN desktop connection — instead of the interactive
 * /api/sts webview callback, which rejects server-side calls (401).
 * Merges the resulting serviceCookie into sess.jar, then confirms via me.
 * @returns {Promise<boolean>} true when the me probe answers 200 (logged in).
 */
export async function ensureServiceSession(sess) {
  const id = readSessionIdentity(sess);
  if (!id) return false;
  const T = () => new Date().toISOString().slice(11, 23);
  const log = (m) => console.log(`${T()} [mimo-login][exchange] ${m}`);
  // Backoff: a failed full 5-step chain must not re-run on every 2.5s poll.
  const bkKey = id.passToken.slice(0, 24);
  const lastFail = _exchangeBackoff.get(bkKey);
  if (lastFail && Date.now() - lastFail < 60_000) {
    log("exchange in backoff (60s), skip");
    return false;
  }
  try {
    const mod = await import("../../open-sse/shared/mimoAccount.js");
    const proxyOptions = sess.proxyUrl ? { enabled: true, url: sess.proxyUrl } : null;
    log(`exchanging passToken (region=${sess.region}, egress=${sess.proxyUrl || "direct"}) ...`);
    const serviceCookie = await mod.getMimoAccountCookie(
      {
        region: sess.region,
        mimoPassToken: id.passToken,
        mimoUserId: id.userId,
        mimoCUserId: id.cUserId,
      },
      proxyOptions,
    );
    if (!serviceCookie) {
      log("exchange failed: no service cookie");
      _exchangeBackoff.set(bkKey, Date.now());
      return false;
    }
    // Flatten "a=b; c=d" into the jar under the mimo-server host.
    _exchangeBackoff.delete(bkKey);
    const host = new URL(sess.upstreamBase).hostname;
    for (const pair of String(serviceCookie).split(";")) {
      const eq = pair.indexOf("=");
      if (eq <= 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (!name || !value) continue;
      sess.jar.set(`${name}|${host}|/`, { name, value, domain: host, path: "/" });
    }
    log(`serviceCookie merged, jar=[${[...sess.jar.keys()].map((k) => k.split("|")[0]).join(",").slice(0, 160)}]`);

    const meUrl = `${sess.upstreamBase}/api/user/xiaomi/me`;
    const res = await fetchUpstream(
      sess,
      meUrl,
      { method: "GET", headers: { "User-Agent": API_UA } },
      cookieHeaderFor(sess, meUrl),
    );
    absorbSetCookies(sess, res, meUrl);
    log(`me confirm http=${res.status}`);
    return res.status === 200;
  } catch (e) {
    log(`exchange error: ${e?.message || e}`);
    _exchangeBackoff.set(bkKey, Date.now());
    return false;
  }
}

// ---------- URL rewriting (mimo-server base <-> /__mimo_login/mimo) ----------

function encodingVariants(s) {
  // The callback/followup params appear raw, url-encoded once, twice...
  const out = [s];
  let cur = s;
  for (let i = 0; i < 3; i++) {
    cur = encodeURIComponent(cur);
    out.push(cur);
  }
  return out;
}

/**
 * Rewrite mimo-server base URLs (any encoding depth) in a string.
 * direction "toProxy": mimo-base -> `${origin}/__mimo_login/mimo`
 * direction "toUpstream": reverse.
 */
export function rewriteMimoBases(text, direction, origin, upstreamBase = null) {
  if (!text) return text;
  let out = String(text);
  const proxyBase = `${origin}/__mimo_login/mimo`;
  const bases = [...new Set(Object.values(MIMO_BASES))];
  const fromBases = direction === "toProxy" ? bases : [proxyBase];
  const toBase = direction === "toProxy" ? proxyBase : (upstreamBase || bases[0]);
  for (const fromBase of fromBases) {
    const variants = [
      fromBase,
      fromBase.replace("https://", "http://"),
      fromBase.replace(/^https?:/, ""),
      fromBase.replaceAll("/", "\\/"),
      fromBase.replace("https://", "http://").replaceAll("/", "\\/"),
    ]; // + protocol-relative + json escaped slashes
    const toVariants = [
      toBase,
      toBase.replace("https://", "http://"),
      toBase,
      toBase.replaceAll("/", "\\/"),
      toBase.replaceAll("/", "\\/"),
    ];
    for (let vIdx = 0; vIdx < variants.length; vIdx++) {
      const fromList = encodingVariants(variants[vIdx]);
      const toList = encodingVariants(toVariants[vIdx]);
      for (let i = 0; i < fromList.length; i++) {
        out = out.split(fromList[i]).join(toList[i]);
      }
    }
  }

  // account.xiaomi.com absolute URLs: keep navigation (e.g. identity/authStart
  // 2FA prompts) on our origin — every path on that host is already proxied
  // natively. Reverse applies to request URLs/bodies before hitting upstream.
  const acctOrigins = ["https://account.xiaomi.com", "http://account.xiaomi.com", "//account.xiaomi.com"];
  if (direction === "toProxy") {
    const toL = encodingVariants(origin);
    for (const a of acctOrigins) {
      const fromL = encodingVariants(a);
      for (let i = 0; i < fromL.length; i++) out = out.split(fromL[i]).join(toL[i]);
    }
  } else {
    const toA = encodingVariants("https://account.xiaomi.com");
    const toAEscaped = encodingVariants("https:\\/\\/account.xiaomi.com");
    const fromL = encodingVariants(origin);
    const fromLProto = encodingVariants(origin.replace(/^https?:/, ""));
    const fromLEscaped = encodingVariants(origin.replaceAll("/", "\\/"));
    for (let i = 0; i < fromL.length; i++) {
      out = out.split(fromL[i]).join(toA[i]);
      out = out.split(fromLProto[i]).join(toA[i]);
      out = out.split(fromLEscaped[i]).join(toAEscaped[i]);
    }
  }
  return out;
}

/** Reverse the proxy rewrite in an incoming URL before hitting upstream. */
export function deRewriteUrl(rawUrl, origin, upstreamBase = null) {
  return rewriteMimoBases(rawUrl, "toUpstream", origin, upstreamBase);
}

export function isAccountProxyPath(pathname) {
  // Inverted: proxy EVERYTHING except the app's own paths (only consulted
  // while a login session cookie/param is present).
  return !APP_PATH_MATCHES(pathname);
}

export function isMimoTakeoverPath(pathname) {
  return pathname.startsWith("/__mimo_login/mimo/");
}

/** Map /__mimo_login/mimo/* back to the upstream mimo-server path. */
export function takeoverUpstreamPath(pathname) {
  return pathname.slice("/__mimo_login/mimo".length) || "/";
}

// ---------- upstream fetch with optional egress proxy ----------
//
// The login page's feature set (Google sign-in etc.) is geo-decided by the
// egress IP of THESE requests. The proxy applies ONLY when the user picked
// region=sgp — the start route resolves it (via local-port probe) and rides it
// on the session cookie as sess.proxyUrl. CN sessions never proxy (null -> direct).

let _pafPromise = null;
let _socksPromise = null;

/** fetch-compatible wrapper over socks-proxy-agent (undici ProxyAgent has no socks support). */
async function socksFetch(url, init, proxyUrl) {
  if (!_socksPromise) {
    _socksPromise = import("socks-proxy-agent")
      .then((m) => m.SocksProxyAgent || m.default?.SocksProxyAgent || m.default)
      .catch((e) => {
        console.log(`${new Date().toISOString().slice(11,23)} [mimo-login] socks-proxy-agent unavailable:`, e?.message || e);
        return null;
      });
  }
  const SocksProxyAgent = await _socksPromise;
  if (!SocksProxyAgent) throw new Error("socks agent unavailable");

  const nodeUrl = new URL(url);
  // Literal specifiers on both branches — webpack forbids fully dynamic import().
  const protoMod = nodeUrl.protocol === "http:" ? await import("node:http") : await import("node:https");
  const lib = protoMod.default ?? protoMod;
  const { Readable } = await import("node:stream");

  let headers = {};
  const raw = init?.headers;
  if (raw instanceof Headers) for (const [k, v] of raw) headers[k] = v;
  else if (raw) headers = { ...raw };

  let body = init?.body;
  if (body && typeof body !== "string" && !Buffer.isBuffer(body)) body = Buffer.from(body);
  if (body) headers["content-length"] = String(Buffer.byteLength(body));

  const agent = new SocksProxyAgent(proxyUrl);
  return new Promise((resolve, reject) => {
    const req = lib.request(
      nodeUrl,
      { method: init?.method || "GET", agent, headers, timeout: 20000 },
      (res) => {
        const outHeaders = new Headers();
        for (const [k, v] of Object.entries(res.headers || {})) {
          if (Array.isArray(v)) v.forEach((x) => outHeaders.append(k, String(x)));
          else if (v != null) outHeaders.set(k, String(v));
        }
        resolve(new Response(Readable.toWeb(res), { status: res.statusCode || 200, headers: outHeaders }));
      },
    );
    const signal = init?.signal;
    if (signal) {
      if (signal.aborted) req.destroy(new Error("aborted"));
      else signal.addEventListener("abort", () => req.destroy(new Error("aborted")), { once: true });
    }
    req.on("timeout", () => req.destroy(new Error("socks fetch timeout")));
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function loginFetch(url, init, sessionProxyUrl = null) {
  if (!sessionProxyUrl) return fetch(url, init); // direct — no agent machinery needed
  const proxyOptions = { enabled: true, url: sessionProxyUrl };
  try {
    if (/^socks/i.test(sessionProxyUrl)) return await socksFetch(url, init, sessionProxyUrl);
    if (!_pafPromise) {
      _pafPromise = import("../../open-sse/utils/proxyFetch.js")
        .then((m) => m.proxyAwareFetch)
        .catch((e) => {
          console.log(`${new Date().toISOString().slice(11,23)} [mimo-login] proxyAwareFetch unavailable (runtime?), direct only:`, e?.message || e);
          return null;
        });
    }
    const paf = await _pafPromise;
    if (paf) return await paf(url, init, proxyOptions);
  } catch (e) {
    console.log(`${new Date().toISOString().slice(11,23)} [mimo-login] proxied fetch failed, falling back to direct:`, e?.message || e);
  }
  return fetch(url, init);
}

/** Public alias — start/status routes share the same egress path. */
export const loginUpstreamFetch = (url, init, sess = null) => loginFetch(url, init, sess?.proxyUrl || null);

// ---------- upstream proxying ----------

async function fetchUpstream(sess, url, init, cookieValue) {
  const headers = new Headers(init.headers);
  if (cookieValue) headers.set("Cookie", cookieValue);
  return loginFetch(url, { ...init, headers, redirect: "manual", signal: AbortSignal.timeout(20000) }, sess?.proxyUrl || null);
}

function browserCookieHeader(req) {
  return req.headers.get("cookie") || "";
}

// Headers never forwarded to the upstream account host.
const STRIP_UPSTREAM_HEADERS = new Set([
  "host", "cookie", "connection", "content-length", "transfer-encoding",
  "keep-alive", "upgrade", "expect", "proxy-connection",
  // Credentials for 9router itself — must never reach a third-party upstream.
  "authorization", "proxy-authorization",
]);

/**
 * Proxy one account.xiaomi.com request from the browser.
 * Captures Set-Cookie into the server jar, strips frame-blocking headers,
 * rewrites Location/body mimo-base references back into the proxy space.
 */
export async function proxyAccountRequest(sess, req, origin) {
  const u = new URL(req.url);
  u.searchParams.delete("__9r_sess"); // never forward our session to upstream
  const upstream = new URL(u.pathname + u.search, `https://${ACCOUNT_HOST}`);

  // The SPA's callback params were rewritten to our proxy — undo before upstream
  // so signature (_sign) validation on the real callback still passes.
  const upstreamStr = deRewriteUrl(upstream.toString(), origin, sess.upstreamBase);

  const headers = {};
  // Forward EVERYTHING the browser sent (minus hop-by-hop + host/cookie) so no
  // custom SDK header gets silently dropped. Then fix up cross-origin fields:
  // the SPA talks to account.xiaomi.com, so Origin/Referer must be rewritten
  // from our origin to the account origin — keeping the original path/query
  // (a wrong Referer path trips Xiaomi's login risk control, error 10025).
  for (const [k, v] of req.headers) {
    if (STRIP_UPSTREAM_HEADERS.has(k.toLowerCase())) continue;
    headers[k] = v;
  }
  const ourOrigin = origin;
  const fixOriginUrl = (val) => {
    if (!val) return null;
    try {
      const u = new URL(val);
      if (u.origin === ourOrigin) {
        u.protocol = "https:";
        u.host = ACCOUNT_HOST;
        return u.toString();
      }
      if (u.hostname === ACCOUNT_HOST) return u.toString();
      return null; // some other origin — let our forced account values win
    } catch { return null; }
  };
  const rawOrigin = headers.origin || headers.Origin || null;
  delete headers.origin;
  delete headers.Origin;
  // Real browsers only send Origin on XHR POSTs — preserve that shape, but
  // point it at the account host (never leak localhost upstream).
  if (rawOrigin) headers.Origin = `https://${ACCOUNT_HOST}`;
  const fixedReferer = fixOriginUrl(headers.referer || headers.Referer);
  headers.Referer = fixedReferer
    ? deRewriteUrl(fixedReferer, origin, sess.upstreamBase)
    : `https://${ACCOUNT_HOST}/fe/service/login`;
  delete headers.referer;

  const init = { method: req.method || "GET", headers };
  if (init.method !== "GET" && init.method !== "HEAD") {
    let buf = Buffer.from(await req.arrayBuffer());
    // The SPA reads callback params from location.search (which we rewrote to
    // our origin) and can echo them in the POST BODY — reverse that too, or
    // Xiaomi rejects with 10025 "Callback连接不合法".
    const ctBody = String(headers["Content-Type"] || headers["content-type"] || "");
    if (buf.length && /urlencoded|json|text/i.test(ctBody)) {
      const before = buf.toString("utf8");
      const after = rewriteMimoBases(before, "toUpstream", origin, sess.upstreamBase);
      if (after !== before) {
        buf = Buffer.from(after, "utf8");
        headers["Content-Length"] = String(buf.length);
      } else if (/__mimo_login|localhost/.test(before)) {
        // Anomaly: a local callback shape we cannot rewrite — must never reach Xiaomi.
        console.log(`${new Date().toISOString().slice(11, 23)} [mimo-login] body STILL local, not matchable: ${before.slice(0, 200)}`);
      }
    }
    init.body = buf;
  }

  // Follow same-host redirects server-side (they carry Set-Cookie we must keep).
  let current = upstreamStr;
  let res = null;
  const requestCookies = cookieHeaderFor(sess, current) || browserCookieHeader(req);
  for (let hop = 0; hop < 8; hop++) {
    res = await fetchUpstream(sess, current, hop === 0 ? init : { ...init, body: undefined }, requestCookies);
    absorbSetCookies(sess, res, current);
    const loc = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && loc) {
      const nextAbs = new URL(loc, current);
      if (nextAbs.hostname === ACCOUNT_HOST) {
        current = nextAbs.toString();
        continue;
      }
      // Cross-host redirect to mimo-server: rewrite into our takeover space so
      // the browser stays on our origin.
      if (/mimo-server-(cn|sgp)\.xiaomimimo\.com/.test(nextAbs.hostname)) {
        const proxiedLoc = rewriteMimoBases(nextAbs.toString(), "toProxy", origin);
        return new Response(null, { status: res.status, headers: { Location: proxiedLoc, "Cache-Control": "no-store" } });
      }
      // Any other host: pass through.
      return new Response(null, { status: res.status, headers: { Location: loc } });
    }
    break;
  }

  return buildBrowserResponse(sess, res, origin, u.pathname, current);
}

function buildBrowserResponse(sess, res, origin, reqPath = "", upstreamUrl = "") {
  const outHeaders = new Headers();
  const pass = ["content-type", "cache-control", "etag", "last-modified", "date"];
  for (const h of pass) {
    const v = res.headers.get(h);
    if (v) outHeaders.set(h, v);
  }
  // Allow embedding in our modal (upstream often sends X-Frame-Options).
  outHeaders.delete("x-frame-options");
  outHeaders.delete("content-security-policy");
  outHeaders.delete("content-security-policy-report-only");
  outHeaders.set("Cache-Control", "no-store");
  // Deliberately NOT forwarding upstream Set-Cookie to the browser: every
  // proxied request already strips the browser Cookie header, so upstream
  // auth lives only in the server-side jar. Replayed cookies would land on
  // our origin's jar (some without HttpOnly → readable by any script here).

  const ctType = res.headers.get("content-type") || "";
  const isText = /text\/|javascript|json/.test(ctType);
  if (!isText) return new Response(res.body, { status: res.status, headers: outHeaders });

  return res.text().then((rawBody) => {
    // JSON allows \/ as an escaped slash — Xiaomi backends (PHP-style) emit
    // "https:\/\/mimo-server..." which defeats scheme-based string matching
    // AND the SPA JSON.parses it back to a real URL (this leaked the sts
    // callback straight to the browser -> cross-origin 401). Unescaping \/ to
    // / inside JSON string values is semantics-preserving and stays valid.
    const body = /json/.test(ctType) ? rawBody.replaceAll("\\/", "/") : rawBody;
    // Surface upstream API errors (Xiaomi wraps JSON as &&&START&&&{code:...}).
    if (/^\/(pass|sts)/.test(reqPath) || res.status >= 400) {
      const m = body.match(/"code"\s*:\s*(-?\d+)/);
      if ((m && m[1] !== "0") || res.status >= 400) {
        console.log(`${new Date().toISOString().slice(11,23)} [mimo-login] upstream ${reqPath} http=${res.status} code=${m ? m[1] : "?"} | url=${upstreamUrl.slice(0, 180)} | ${body.replace(/\s+/g, " ").slice(0, 160)}`);
      }
    }
    const rewritten = rewriteMimoBases(body, "toProxy", origin);
    return new Response(rewritten, { status: res.status, headers: outHeaders });
  });
}

/**
 * Take over the mimo-server tail of the flow (sts -> me) server-side.
 * Runs the whole redirect chain, absorbs cookies, verifies me=logged-in.
 */
export async function runTakeover(sess, upstreamUrl, origin) {
  const T = () => new Date().toISOString().slice(11, 23);
  const log = (m) => console.log(`${T()} [mimo-login][takeover] ${m}`);
  const idSnap = () => {
    const id = readSessionIdentity(sess);
    const names = [...sess.jar.keys()].map((k) => k.split("|")[0]).join(",");
    return `passToken=${id ? "Y" : "N"} jar=[${names.slice(0, 160)}]`;
  };
  log(`sts-nav url=${upstreamUrl.slice(0, 160)} origin=${origin} | ${idSnap()}`);
  const id = readSessionIdentity(sess);
  // AUTHORIZATION COMPLETION = passToken captured (that IS the credential the
  // connection persists for the account route). The serviceToken exchange
  // (weekly quota) is intentionally NOT part of completion — its API moved;
  // ensureServiceSession stays exported for when that gets re-wired.
  if (id) {
    sess.status = "done";
    return donePage();
  }
  return pendingPage();
}

function htmlPage(title, lines, autoClose = false) {
  const body = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#111;color:#eee}
.card{padding:2rem 2.5rem;border-radius:12px;background:#1b1b1f;text-align:center;max-width:420px}
h1{font-size:1.1rem;margin:.2rem 0 .6rem}p{opacity:.8;font-size:.9rem;line-height:1.6}</style></head>
<body><div class="card"><h1>${title}</h1>${lines.map((l) => `<p>${l}</p>`).join("")}</div>
<script>setTimeout(function(){try{window.opener&&window.opener.postMessage({mimoSession:"ok"},location.origin)}catch(e){}},300);${autoClose ? "setTimeout(function(){try{window.close()}catch(e){}},1600);" : ""}</script>
</body></html>`;
  return new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

function donePage() {
  return htmlPage("登录成功 ✅", ["账号会话已捕获，可以关闭此窗口。", "回到 9router 弹窗继续。"], true);
}

function pendingPage() {
  return htmlPage("登录未完成", ["未检测到有效会话，请重试。"]);
}

export const __test__ = { STRIP_UPSTREAM_HEADERS, buildBrowserResponse };
