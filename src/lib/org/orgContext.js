import { isOnPrem, isSaas } from "@/lib/deploy/deployMode.js";
import { getDefaultOrgId, getOrganizationById, getOrganizationBySlug } from "@/lib/db/repos/organizationsRepo.js";
import { getRuntimeOrgId, runWithOrgId } from "@/lib/auth/runtimeUserContext.js";

export const ORG_SLUG_HEADER = "x-ebr-org-slug";
export const ORG_ID_HEADER = "x-ebr-org-id";

/** Extract org slug from Host subdomain, /o/:slug path, or dev header. */
export function resolveOrgSlugFromRequest(request) {
  const headerSlug = request.headers.get(ORG_SLUG_HEADER);
  if (headerSlug) return String(headerSlug).trim().toLowerCase();

  const url = new URL(request.url);
  const pathMatch = url.pathname.match(/^\/o\/([a-z0-9-]+)/i);
  if (pathMatch) return pathMatch[1].toLowerCase();

  const baseDomain = String(process.env.SAAS_BASE_DOMAIN || "").trim().toLowerCase();
  if (baseDomain) {
    const host = (request.headers.get("host") || "").split(":")[0].toLowerCase();
    if (host === baseDomain || host === `www.${baseDomain}`) return null;
    if (host.endsWith(`.${baseDomain}`)) {
      const sub = host.slice(0, -(baseDomain.length + 1));
      const slug = sub.split(".")[0];
      if (slug && slug !== "www") return slug;
    }
  }

  if (process.env.DEFAULT_ORG_SLUG) {
    return String(process.env.DEFAULT_ORG_SLUG).trim().toLowerCase();
  }

  return null;
}

export async function resolveOrgFromRequest(request) {
  if (isOnPrem()) {
    const id = await getDefaultOrgId();
    return id ? getOrganizationById(id) : null;
  }

  const slug = resolveOrgSlugFromRequest(request);
  if (!slug) return null;
  return getOrganizationBySlug(slug);
}

/** Resolve org from JWT session or user record when URL/header lacks tenant slug (SaaS dashboard). */
export async function resolveOrgWithFallback(request, { session = null, user = null } = {}) {
  const fromRequest = await resolveOrgFromRequest(request);
  if (fromRequest) return fromRequest;

  if (session?.orgId) {
    const org = await getOrganizationById(session.orgId);
    if (org) return org;
  }
  if (session?.orgSlug) {
    const org = await getOrganizationBySlug(String(session.orgSlug).trim().toLowerCase());
    if (org) return org;
  }
  if (user?.orgId) {
    return getOrganizationById(user.orgId);
  }
  return null;
}

export async function requireOrgFromRequest(request) {
  const org = await resolveOrgFromRequest(request);
  if (org) return { org, error: null };

  if (isSaas()) {
    const { NextResponse } = await import("next/server");
    return {
      org: null,
      error: NextResponse.json({ error: "Organization not found" }, { status: 404 }),
    };
  }

  const id = await getDefaultOrgId();
  if (id) {
    const fallback = await getOrganizationById(id);
    if (fallback) return { org: fallback, error: null };
  }

  const { NextResponse } = await import("next/server");
  return {
    org: null,
    error: NextResponse.json({ error: "Organization not configured" }, { status: 503 }),
  };
}

/** Run handler with orgId in AsyncLocalStorage (for settings/users before session exists). */
export async function runWithRequestOrg(request, fn) {
  const org = await resolveOrgFromRequest(request);
  const orgId = org?.id || (isOnPrem() ? await getDefaultOrgId() : null);
  return runWithOrgId(orgId, fn);
}

function protocolAndPortFromBaseUrl(baseUrl, secureDefault) {
  let protocol = secureDefault ? "https" : "http";
  let port = "";
  if (!baseUrl) return { protocol, port };

  try {
    const parsed = new URL(baseUrl);
    protocol = parsed.protocol.replace(":", "") || protocol;
    port = parsed.port ? `:${parsed.port}` : "";
  } catch {
    // keep defaults
  }
  return { protocol, port };
}

export function buildOrgDashboardUrl(slug, path = "/dashboard") {
  const baseDomain = String(process.env.SAAS_BASE_DOMAIN || "").trim();
  const baseUrl = (process.env.BASE_URL || process.env.NEXT_PUBLIC_BASE_URL || "").replace(/\/+$/, "");
  const secure = process.env.AUTH_COOKIE_SECURE === "true";

  if (baseDomain) {
    const { protocol, port } = protocolAndPortFromBaseUrl(baseUrl, secure);
    return `${protocol}://${slug}.${baseDomain}${port}${path}`;
  }
  if (baseUrl) {
    return `${baseUrl}/o/${slug}${path}`;
  }
  return `/o/${slug}${path}`;
}

export function userBelongsToOrg(user, org) {
  if (!user || !org) return false;
  return user.orgId === org.id;
}

export async function resolveEffectiveOrgId(request) {
  const runtime = getRuntimeOrgId();
  if (runtime) return runtime;
  const org = await resolveOrgFromRequest(request);
  if (org?.id) return org.id;
  if (isOnPrem()) return getDefaultOrgId();
  return null;
}
