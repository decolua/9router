const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);

function isPrivateOrReservedIpv4(a, b) {
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 0) return true;
  return false;
}

function isIpv4Literal(host) {
  const parts = host.split(".");
  if (parts.length !== 4) return false;
  return parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) >= 0 && Number(p) <= 255);
}

function isPrivateOrReservedIpv6(host) {
  const lower = host.toLowerCase();
  if (lower === "::1" || lower.startsWith("fe80:") || lower.startsWith("fc") || lower.startsWith("fd")) {
    return true;
  }
  if (lower.startsWith("::ffff:")) {
    const mapped = lower.slice(7);
    return isIpv4Literal(mapped) && isPrivateOrReservedIpv4(...mapped.split(".").map(Number));
  }
  return false;
}

export function isBlockedHostname(hostname) {
  if (!hostname) return true;
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (LOOPBACK_HOSTNAMES.has(h)) return true;
  if (h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (h === "metadata.google.internal" || h === "metadata") return true;
  if (isIpv4Literal(h)) {
    const [a, b] = h.split(".").map(Number);
    return isPrivateOrReservedIpv4(a, b);
  }
  if (h.includes(":")) {
    return isPrivateOrReservedIpv6(h);
  }
  return false;
}

/**
 * Validate a URL is safe for server-side fetch (blocks private/metadata hosts).
 * @throws {Error} when URL is not allowed
 */
export function assertSafeFetchUrl(urlString, options = {}) {
  const { requireHttps = true, allowHttp = false } = options;
  let parsed;
  try {
    parsed = new URL(urlString);
  } catch {
    throw new Error("Invalid URL");
  }

  if (requireHttps && parsed.protocol !== "https:") {
    if (!(allowHttp && parsed.protocol === "http:")) {
      throw new Error("Only HTTPS URLs are allowed");
    }
  }

  if (parsed.username || parsed.password) {
    throw new Error("URLs with credentials are not allowed");
  }

  if (isBlockedHostname(parsed.hostname)) {
    throw new Error("URL host is not allowed");
  }

  return parsed;
}

export function isSafeFetchUrl(urlString, options = {}) {
  try {
    assertSafeFetchUrl(urlString, options);
    return true;
  } catch {
    return false;
  }
}

/** Normalize and validate a provider base URL (no path traversal). */
export function validateProviderBaseUrl(baseUrl, options = {}) {
  const normalized = String(baseUrl || "").trim().replace(/\/$/, "");
  assertSafeFetchUrl(normalized, options);
  return normalized;
}
