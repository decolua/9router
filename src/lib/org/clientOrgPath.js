/** Org slug from browser path (/o/:slug/...) for SaaS path-mode routing. */
export function getClientOrgSlug() {
  if (typeof window === "undefined") return null;
  const match = window.location.pathname.match(/^\/o\/([a-z0-9-]+)/i);
  return match ? match[1].toLowerCase() : null;
}

/** Prefix API/page paths with /o/:slug when the user is on an org-scoped URL. */
export function orgScopedPath(path) {
  const slug = getClientOrgSlug();
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return slug ? `/o/${slug}${normalized}` : normalized;
}
