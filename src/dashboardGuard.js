import { NextResponse } from "next/server";
import { getSettings, validateApiKey, admitApiKey } from "@/lib/localDb";
import { getConsistentMachineId } from "@/shared/utils/machineId";
import { ADMIN, VIEWER } from "@/lib/auth/dashboardRoles";
import { getDashboardAuthSession } from "@/lib/auth/dashboardSession";
import { hasTrustedPeerHeaders } from "@/lib/auth/trustedPeer";

function admissionError(body, status, headers) {
  return NextResponse.json(body, { status, headers: { ...headers, "X-Request-Id": crypto.randomUUID() } });
}

const CLI_TOKEN_HEADER = "x-9r-cli-token";
const CLI_TOKEN_SALT = "9r-cli-auth";

let cachedCliToken = null;
async function getCliToken() {
  if (!cachedCliToken) cachedCliToken = await getConsistentMachineId(CLI_TOKEN_SALT);
  return cachedCliToken;
}

export async function hasValidCliToken(request) {
  const token = request.headers.get(CLI_TOKEN_HEADER);
  if (!token) return false;
  return token === await getCliToken();
}

// Public API paths — no auth required (LLM API has its own key auth inside handler).
const PUBLIC_API_PATHS = new Set([
  "/api/health",
  "/api/init",
  "/api/locale",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/status",
  "/api/auth/oidc/start",
  "/api/auth/oidc/callback",
  "/api/auth/saml/start",
  "/api/auth/saml/acs",
  "/api/auth/saml/metadata",
  "/api/version",
  "/api/settings/require-login",
]);

// Public top-level prefixes (LLM API endpoints with their own API key auth).
// Keep root-level rewrites here too: middleware runs before Next.js rewrites.
const PUBLIC_PREFIXES = ["/v1", "/v1beta", "/api/v1", "/api/v1beta", "/codex", "/responses"];

// Always require JWT token regardless of requireLogin setting
const ALWAYS_PROTECTED = [
  "/api/shutdown",
  "/api/settings/database",
  "/api/version/shutdown",
  "/api/version/update",
  "/api/oauth/cursor/auto-import",
  "/api/oauth/kiro/auto-import",
  "/api/oauth/zed/auto-import",
  "/api/oauth/minimax-code/lease",
  "/api/oauth/minimax-code-global/lease",
];

// Exact normalized paths only.
const VIEWER_READ_PATHS = new Set([
  "/api/notifications", "/api/usage/chart", "/api/usage/stats", "/api/usage/providers", "/api/providers/summary",
  "/api/models", "/api/combos",
]);

function viewerMayAccess(request) {
  const { pathname, searchParams } = request.nextUrl;
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  if (pathname === "/api/keys") {
    return searchParams.size === 1 && searchParams.get("view") === "summary";
  }
  return VIEWER_READ_PATHS.has(pathname);
}

// Routes that spawn child processes or read host secrets — restrict to localhost.
const LOCAL_ONLY_PATHS = [
  "/api/cli-tools/cowork-settings",
  "/api/cli-tools/antigravity-mitm",
  "/api/mcp/",
  "/api/tunnel/tailscale-install",
  "/api/tunnel/tailscale-enable",
  "/api/tunnel/tailscale-disable",
  "/api/tunnel/tailscale-check",
  "/api/tunnel/enable",
  "/api/tunnel/disable",
  "/api/oauth/cursor/auto-import",
  "/api/oauth/kiro/auto-import",
  "/api/oauth/zed/auto-import",
  "/api/oauth/minimax-code/lease",
  "/api/oauth/minimax-code-global/lease",
  "/api/auth/reset-password",
  "/api/headroom/start",
  "/api/headroom/stop",
  "/api/headroom/restart",
  "/api/headroom/extras",
  "/api/headroom/proxy",
];

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

// Accepts a Host header, a URL hostname or a raw socket address. Splitting on the first
// colon only works for IPv4 and would reduce every IPv6 form to "", so a dual-stack
// listener handing back ::ffff:127.0.0.1 would not read as loopback.
function isLoopbackHostname(h) {
  if (!h) return false;
  let name = String(h).trim().toLowerCase();
  if (name.startsWith("[")) {
    const end = name.indexOf("]");
    if (end === -1) return false;
    name = name.slice(1, end);
  } else if (name.indexOf(":") !== -1 && name.indexOf(":") === name.lastIndexOf(":")) {
    name = name.slice(0, name.indexOf(":"));
  }
  if (name.startsWith("::ffff:")) name = name.slice(7);
  return LOOPBACK_HOSTS.has(name);
}

function isLoopbackPeer(request) {
  if (hasTrustedPeerHeaders(request)) {
    return isLoopbackHostname(request.headers.get("x-9r-real-ip"));
  }
  // Bare `next dev` forks its server, so the wrapper never loads and no peer address
  // reaches us. Host is spoofable, so this stays confined to development.
  if (process.env.NODE_ENV === "development") {
    return isLoopbackHostname(request.headers.get("host"));
  }
  return false;
}

export function isLocalRequest(request) {
  // Stamped by custom-server.js when forwarding headers exist: request came through
  // a reverse proxy, so the loopback socket is the proxy hop, not the end-user.
  if (request.headers.get("x-9r-via-proxy")) return false;
  if (!isLoopbackPeer(request)) return false;
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      if (!isLoopbackHostname(new URL(origin).hostname)) return false;
    } catch { return false; }
  }
  return true;
}

function isPublicLlmApi(pathname) {
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function extractApiKey(request) {
  const authHeader = request.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) return authHeader.slice(7);
  const apiKeyHeader = request.headers.get("x-api-key");
  if (apiKeyHeader) return apiKeyHeader;
  const googleApiKeyHeader = request.headers.get("x-goog-api-key");
  if (googleApiKeyHeader) return googleApiKeyHeader;
  return request.nextUrl.searchParams?.get("key") || null;
}

async function hasValidApiKey(request) {
  const apiKey = extractApiKey(request);
  if (!apiKey) return false;
  return await validateApiKey(apiKey);
}

async function canAccessPublicLlmApi(request) {
  if (isLocalRequest(request)) return true;
  if (await hasValidCliToken(request)) return true;
  return await hasValidApiKey(request);
}

// Read settings directly from DB to avoid self-fetch deadlock in proxy
async function loadSettings() {
  try {
    return await getSettings();
  } catch {
    return null;
  }
}

// An invalid presented cookie never falls back to anonymous admin access.
export async function dashboardRole(request, { requireCredential = false } = {}) {
  if (await hasValidCliToken(request)) return ADMIN;
  const token = request.cookies.get("auth_token")?.value;
  if (token) return (await getDashboardAuthSession(token))?.role ?? null;
  if (!requireCredential && (await loadSettings())?.requireLogin === false) return ADMIN;
  return null;
}

function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

function administratorRequired() {
  return NextResponse.json({ error: "Administrator required" }, { status: 403 });
}

export async function requireDashboardAdmin(request, options) {
  const role = await dashboardRole(request, options);
  return role === ADMIN ? null : role === VIEWER ? administratorRequired() : unauthorized();
}

export const __test__ = {
  isLocalRequest,
  isPublicLlmApi,
  extractApiKey,
  canAccessPublicLlmApi,
};

export async function proxy(request) {
  const { pathname } = request.nextUrl;

  // Next supplies the normalized pathname. Never let alternate spellings of
  // the API namespace fall through to the unguarded page branch.
  let decodedPath;
  try { decodedPath = decodeURIComponent(pathname); } catch { return unauthorized(); }
  if (/^\/api(?:\/|$)/i.test(decodedPath) && !pathname.startsWith("/api/")) {
    return await dashboardRole(request) === VIEWER ? administratorRequired() : unauthorized();
  }

  // /systemone is a legacy rewrite: apply admission to a presented key
  // without changing the existing rules for requests that present no key.
  const publicLlm = isPublicLlmApi(pathname);
  const keyedSystemone = pathname === "/systemone" && request.method === "POST" && extractApiKey(request);
  if (publicLlm || keyedSystemone) {
    const key = extractApiKey(request);
    if (key) {
      const post = request.method === "POST";
      // Voice lookup and video polling can contact a provider on GET (or HEAD).
      const mediaRead = ["GET", "HEAD"].includes(request.method) && /^\/(?:api\/)?v1\/(?:audio|videos)(?:\/|$)/.test(pathname);
      if (post || mediaRead) {
        const { status, retryAfter, windows } = await admitApiKey(key, pathname, post);
        if (status === 403) return admissionError({ error: "Budgeted keys support chat completions, messages and responses endpoints" }, status);
        if (status === 200) return NextResponse.next();
        if (status === 429) return admissionError({ error: "API key request limit exceeded", windows },
          status, { "Retry-After": String(retryAfter), "Cache-Control": "no-store" });
        if (status === 503) return admissionError({ error: "Quota storage unavailable" }, status);
      } else if (await validateApiKey(key)) return NextResponse.next();
    } else if (await canAccessPublicLlmApi(request)) return NextResponse.next();
    return admissionError({ error: "API key required for remote API access" }, 401);
  }

  // Dashboard API: public entry points are exact paths, never whole subtrees.
  if (pathname.startsWith("/api/")) {
    if (PUBLIC_API_PATHS.has(pathname)) return NextResponse.next();
    const gatePath = decodedPath.toLowerCase();
    const localOnly = LOCAL_ONLY_PATHS.some(p => gatePath.startsWith(p));
    const requireCredential = ALWAYS_PROTECTED.some(p => gatePath.startsWith(p)) ||
      /^\/api\/keys\/[^/]+\/rotate\/?$/.test(gatePath);
    const role = await dashboardRole(request, { requireCredential });
    if (role === VIEWER && (localOnly || requireCredential || !viewerMayAccess(request))) return administratorRequired();
    if (localOnly && !(await hasValidCliToken(request)) && (!isLocalRequest(request) || !role)) {
      return NextResponse.json({ error: "Local only: CLI token required" }, { status: 403 });
    }
    if (role) return NextResponse.next();
    return unauthorized();
  }

  // Page rendering only needs GET/HEAD. Server actions must not provide a
  // second write path outside the API routes.
  if (request.method && !["GET", "HEAD"].includes(request.method) &&
      (pathname.startsWith("/dashboard") || request.headers.has("next-action"))) {
    const denied = await requireDashboardAdmin(request);
    if (denied) return denied;
  }

  // Protect all dashboard routes
  if (pathname.startsWith("/dashboard")) {
    let requireLogin = true;
    let tunnelDashboardAccess = true;

    try {
      const settings = await loadSettings();
      if (settings) {
        requireLogin = settings.requireLogin !== false;
        tunnelDashboardAccess = settings.tunnelDashboardAccess === true;

        // Block tunnel/tailscale access if disabled (redirect to login)
        if (!tunnelDashboardAccess) {
          const host = (request.headers.get("host") || "").split(":")[0].toLowerCase();
          const tunnelHost = settings.tunnelUrl ? new URL(settings.tunnelUrl).hostname.toLowerCase() : "";
          const tailscaleHost = settings.tailscaleUrl ? new URL(settings.tailscaleUrl).hostname.toLowerCase() : "";
          if ((tunnelHost && host === tunnelHost) || (tailscaleHost && host === tailscaleHost)) {
            return NextResponse.redirect(new URL("/login", request.url));
          }
        }
      }
    } catch {
      // On error, keep defaults (require login, block tunnel)
    }

    const token = request.cookies.get("auth_token")?.value;
    if (await hasValidCliToken(request) || (token ? await getDashboardAuthSession(token) : !requireLogin)) return NextResponse.next();

    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Redirect / to /dashboard if logged in, or /dashboard if it's the root
  if (pathname === "/") {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return NextResponse.next();
}
