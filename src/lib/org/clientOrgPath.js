/** Shared org slug resolution for browser URLs (path + subdomain). */
export function resolveClientOrgSlug({ hostname, pathname, baseDomain = "" } = {}) {
  const path = String(pathname || "");
  const pathMatch = path.match(/^\/o\/([a-z0-9-]+)/i);
  if (pathMatch) return pathMatch[1].toLowerCase();

  const host = String(hostname || "").toLowerCase();
  const base = String(baseDomain || "").trim().toLowerCase();

  if (base) {
    if (host === base || host === `www.${base}`) return null;
    if (host.endsWith(`.${base}`)) {
      const sub = host.slice(0, -(base.length + 1));
      const slug = sub.split(".")[0];
      if (slug && slug !== "www") return slug;
    }
    return null;
  }

  // Local SaaS dev: {slug}.localhost
  if (host.endsWith(".localhost")) {
    const slug = host.slice(0, -".localhost".length).split(".")[0];
    if (slug && slug !== "www") return slug;
  }

  return null;
}

function readBrowserBaseDomain() {
  if (typeof window === "undefined") return "";
  return (process.env.NEXT_PUBLIC_SAAS_BASE_DOMAIN || "").trim().toLowerCase();
}

/** Org slug from browser URL — /o/:slug path or {slug}.baseDomain subdomain. */
export function getClientOrgSlug() {
  if (typeof window === "undefined") return null;
  return resolveClientOrgSlug({
    hostname: window.location.hostname,
    pathname: window.location.pathname,
    baseDomain: readBrowserBaseDomain(),
  });
}

/** True when the org is encoded in the /o/:slug path (not subdomain routing). */
export function isPathBasedOrgUrl() {
  if (typeof window === "undefined") return false;
  return /^\/o\/[a-z0-9-]+/i.test(window.location.pathname);
}

/** Prefix paths with /o/:slug only in path-based SaaS routing mode. */
export function orgScopedPath(path) {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  if (!isPathBasedOrgUrl()) return normalized;
  const slug = getClientOrgSlug();
  return slug ? `/o/${slug}${normalized}` : normalized;
}
