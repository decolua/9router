/**
 * Extract lowercase hostname from an HTTP Host header (port and IPv6 brackets removed).
 * @param {string|null|undefined} hostHeader
 * @returns {string}
 */
export function normalizeHostHeaderHostname(hostHeader) {
  if (!hostHeader || typeof hostHeader !== "string") return "";

  const trimmed = hostHeader.trim().toLowerCase();
  if (!trimmed) return "";

  if (trimmed.startsWith("[")) {
    const end = trimmed.indexOf("]");
    if (end > 0) return trimmed.slice(1, end);
  }

  const lastColon = trimmed.lastIndexOf(":");
  if (lastColon > -1 && /^\d+$/.test(trimmed.slice(lastColon + 1))) {
    return trimmed.slice(0, lastColon);
  }

  return trimmed;
}
