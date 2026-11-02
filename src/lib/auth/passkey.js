// Passkey (WebAuthn) dashboard login helpers: relying-party resolution, the
// single-use challenge store, cookie handling and credential encoding.
import crypto from "node:crypto";
import net from "node:net";
import { deriveInstallId, getDashboardAuthSession, shouldUseSecureCookie } from "@/lib/auth/dashboardSession";

export const PASSKEY_RP_NAME = "9Router";
export const PASSKEY_USER_NAME = "admin";
export const PASSKEY_USER_DISPLAY_NAME = "9Router admin";
export const PASSKEY_ALGORITHMS = [-7, -257]; // ES256, RS256
export const MAX_PASSKEYS = 20;
export const PASSKEY_NAME_MAX = 64;

export const CHALLENGE_COOKIE = "passkey_challenge";
export const CHALLENGE_COOKIE_PATH = "/api/auth/passkey";
export const CHALLENGE_TTL_MS = 5 * 60 * 1000;
// Login and register challenges live in separate pools so public sign-in traffic can
// never displace an authenticated owner's "Add passkey" ceremony.
export const MAX_PENDING_CHALLENGES = 1000;
export const MAX_PENDING_REGISTER_CHALLENGES = 100;
// Per client address: asking for options again only displaces that client's own entries.
export const MAX_PENDING_PER_CLIENT = 5;

export const NO_STORE_HEADERS = { "Cache-Control": "no-store" };
export const PASSKEY_ORIGIN_ERROR = "Passkeys require HTTPS or http://localhost — open the dashboard via a domain name";

export class PasskeyError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "PasskeyError";
    this.status = status;
  }
}

function isLocalhostName(hostname) {
  return hostname === "localhost" || hostname.endsWith(".localhost");
}

function isIpHostname(hostname) {
  return net.isIP(hostname.replace(/^\[|\]$/g, "")) !== 0;
}

function hostnameOf(hostValue) {
  if (!hostValue) return "";
  try {
    return new URL(`http://${String(hostValue).split(",")[0].trim()}`).hostname.toLowerCase();
  } catch {
    return "";
  }
}

// Hostnames the server considers itself reachable as, for the Origin == Host check.
// - Host header: always (cloudflared / tailscale serve / `proxy_set_header Host $host` keep it).
// - X-Forwarded-Host: only with TRUST_PROXY=true, the same opt-in loginLimiter uses for XFF;
//   otherwise any client could set it to match a forged Origin.
// - BASE_URL / NEXT_PUBLIC_BASE_URL: operator-configured public origin (as getPublicOrigin
//   in oidc.js), for proxies that rewrite Host to the upstream address.
function trustedHostnames(request) {
  const names = new Set();
  const add = (h) => { if (h) names.add(h); };
  add(hostnameOf(request.headers.get("host")));
  if (process.env.TRUST_PROXY === "true") add(hostnameOf(request.headers.get("x-forwarded-host")));
  for (const base of [process.env.BASE_URL, process.env.NEXT_PUBLIC_BASE_URL]) {
    if (!base) continue;
    try { add(new URL(base).hostname.toLowerCase()); } catch { /* ignore malformed */ }
  }
  return names;
}

// Derive the WebAuthn RP ID and expected origin from the browser's Origin header.
// All passkey endpoints are POST, so browsers always send it. The RP ID must be a
// domain name (WebAuthn forbids IP addresses) on a secure context (https, or
// http://localhost which browsers treat as secure).
export function resolveRelyingParty(request) {
  const originHeader = request.headers.get("origin");
  if (!originHeader) throw new PasskeyError(PASSKEY_ORIGIN_ERROR);

  let url;
  try {
    url = new URL(originHeader);
  } catch {
    throw new PasskeyError(PASSKEY_ORIGIN_ERROR);
  }
  // A real Origin header is exactly scheme://host[:port] — reject anything with a path,
  // credentials or other noise rather than normalizing it.
  if (url.origin !== originHeader) throw new PasskeyError(PASSKEY_ORIGIN_ERROR);

  const hostname = url.hostname.toLowerCase();
  if (!hostname || isIpHostname(hostname)) throw new PasskeyError(PASSKEY_ORIGIN_ERROR);
  const secure = url.protocol === "https:" || (url.protocol === "http:" && isLocalhostName(hostname));
  if (!secure) throw new PasskeyError(PASSKEY_ORIGIN_ERROR);

  if (!trustedHostnames(request).has(hostname)) {
    throw new PasskeyError("Passkey request origin does not match this server's host", 403);
  }

  return { rpId: hostname, origin: url.origin };
}

// Per-install WebAuthn user handle. Authenticators keep one discoverable credential per
// (RP ID, user handle), so a constant handle would let a second 9router install reached
// under the same hostname (e.g. another localhost port) silently replace this one's
// passkey. Derived from the session secret: stable per install, nothing extra to store.
// Login does not check the handle, so rotating JWT_SECRET only affects new enrolments.
export function getPasskeyUserId() {
  return deriveInstallId("9router-passkey-user-id", 32);
}

// ── Challenge store ─────────────────────────────────────────────────────────
// Process-wide: Next may bundle each route handler separately, so module-level
// state is not shared between /options and /verify, but globalThis is.
const STORE_KEY = Symbol.for("9router.passkey.challenges.v2");
const POOL_CAPS = { login: MAX_PENDING_CHALLENGES, register: MAX_PENDING_REGISTER_CHALLENGES };

function challengePools() {
  const pools = globalThis[STORE_KEY];
  if (pools?.login instanceof Map && pools?.register instanceof Map) return pools;
  globalThis[STORE_KEY] = { login: new Map(), register: new Map() };
  return globalThis[STORE_KEY];
}

// `client` is the limiter bucket (getClientIp). The per-client cap stops one address
// from cycling the pool and evicting other people's in-flight ceremonies; it is skipped
// for the shared "unknown" bucket (no trusted peer address), where every caller looks
// the same and only the global bound applies.
export function saveChallenge({ challenge, type, rpId, origin, client }, now = Date.now()) {
  const pool = challengePools()[type];
  if (!pool) throw new Error(`Unknown passkey challenge type: ${type}`);
  for (const [key, entry] of pool) {
    if (entry.expiresAt <= now) pool.delete(key);
  }
  const owner = typeof client === "string" && client && client !== "unknown" ? client : null;
  if (owner) {
    const own = [];
    for (const [key, entry] of pool) {
      if (entry.client === owner) own.push(key);
    }
    while (own.length >= MAX_PENDING_PER_CLIENT) pool.delete(own.shift());
  }
  // Hard memory bound; with the per-client cap, reaching it takes many distinct addresses.
  while (pool.size >= POOL_CAPS[type]) {
    pool.delete(pool.keys().next().value);
  }
  const id = crypto.randomBytes(32).toString("base64url");
  pool.set(id, { challenge, type, rpId, origin, client: owner, expiresAt: now + CHALLENGE_TTL_MS });
  return id;
}

// Single use: the entry is removed on read (from whichever pool holds it) whether or
// not it turns out valid.
export function consumeChallenge(id, type, now = Date.now()) {
  if (typeof id !== "string" || !id || id.length > 128) return null;
  let entry = null;
  for (const [poolType, pool] of Object.entries(challengePools())) {
    const found = pool.get(id);
    if (!found) continue;
    pool.delete(id);
    if (poolType === type) entry = found;
  }
  if (!entry || entry.type !== type || entry.expiresAt <= now) return null;
  return entry;
}

export function pendingChallengeCount(type) {
  const pools = challengePools();
  if (type) return pools[type]?.size ?? 0;
  return pools.login.size + pools.register.size;
}

export function clearChallenges() {
  const pools = challengePools();
  pools.login.clear();
  pools.register.clear();
}

function challengeCookieOptions(request, maxAge) {
  return {
    httpOnly: true,
    secure: shouldUseSecureCookie(request),
    sameSite: "strict",
    path: CHALLENGE_COOKIE_PATH,
    maxAge,
  };
}

export function setChallengeCookie(cookieStore, request, id) {
  cookieStore.set(CHALLENGE_COOKIE, id, challengeCookieOptions(request, Math.floor(CHALLENGE_TTL_MS / 1000)));
}

// Overwrite with maxAge 0 on the same path; a bare delete() would target path "/".
export function clearChallengeCookie(cookieStore, request) {
  cookieStore.set(CHALLENGE_COOKIE, "", challengeCookieOptions(request, 0));
}

// ── Auth / input helpers ────────────────────────────────────────────────────

// Mirrors dashboardGuard.isAuthenticated: a valid dashboard session, or login disabled.
export async function hasDashboardAccess(cookieStore, settings) {
  const session = await getDashboardAuthSession(cookieStore.get("auth_token")?.value);
  if (session) return true;
  return settings?.requireLogin === false;
}

export function isValidCredentialId(id) {
  return typeof id === "string" && id.length > 0 && id.length <= 1024 && /^[A-Za-z0-9_-]+$/.test(id);
}

// Fields safe to return to the dashboard: no public key, counter or transports.
export function toPublicPasskey(passkey) {
  return {
    id: passkey.id,
    name: passkey.name,
    rpId: passkey.rpId,
    deviceType: passkey.deviceType,
    backedUp: passkey.backedUp,
    createdAt: passkey.createdAt,
    lastUsedAt: passkey.lastUsedAt,
  };
}

export function sanitizePasskeyName(name) {
  if (typeof name !== "string") return "Passkey";
  const clean = name.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, PASSKEY_NAME_MAX).trim();
  return clean || "Passkey";
}

export function toBase64Url(bytes) {
  return Buffer.from(bytes).toString("base64url");
}

export function fromBase64Url(value) {
  return new Uint8Array(Buffer.from(String(value || ""), "base64url"));
}
