const HEADER_NAME_RE = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

function normalizeTtl(ttl) {
  if (ttl === null || ttl === undefined) return null;
  if (typeof ttl !== "number" || !Number.isInteger(ttl) || ttl < 0) return null;
  return ttl;
}

export function normalizeCustomHeaders(input) {
  if (!Array.isArray(input)) return { headers: [], error: null };

  const byLower = new Map();
  for (const row of input) {
    if (!row || typeof row.name !== "string") continue;
    const name = row.name.trim();
    if (!name) continue;
    if (!HEADER_NAME_RE.test(name)) {
      return { headers: [], error: `Invalid header name: "${name}"` };
    }
    const value = typeof row.value === "string" ? row.value : "";
    if (/[\r\n]/.test(value)) {
      return { headers: [], error: `Invalid header value for "${name}"` };
    }
    byLower.set(name.toLowerCase(), { name, value, ttlMinutes: normalizeTtl(row.ttlMinutes) });
  }
  return { headers: [...byLower.values()], error: null };
}
