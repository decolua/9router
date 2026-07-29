const RESERVED = new Set([
  "www", "api", "app", "admin", "register", "login", "signup", "static",
  "assets", "mail", "ftp", "cdn", "status", "health", "docs",
]);

export function normalizeOrgSlug(input) {
  return String(input || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function validateOrgSlug(slug) {
  if (!slug || slug.length < 3) {
    return { ok: false, error: "Slug must be at least 3 characters" };
  }
  if (slug.length > 32) {
    return { ok: false, error: "Slug must be at most 32 characters" };
  }
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(slug)) {
    return { ok: false, error: "Slug must use lowercase letters, numbers, and hyphens" };
  }
  if (RESERVED.has(slug)) {
    return { ok: false, error: "This slug is reserved" };
  }
  return { ok: true };
}
