// SSRF guard: block internal/private/metadata targets for server-side fetch.

// Allowed URL schemes
const ALLOWED_SCHEMES = new Set(["http:", "https:"]);

// Loopback hosts (allowed in loopback mode, blocked in strict mode)
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

// Always-blocked hostnames
const BLOCKED_HOSTNAMES = new Set(["ip6-localhost", "ip6-loopback"]);
const BLOCKED_SUFFIXES = [".internal", ".local", ".localhost"];

// Cloud metadata endpoints (AWS, GCP, Azure, etc.)
const CLOUD_METADATA_IPS = new Set([
  "169.254.169.254",  // AWS, GCP, Azure, DigitalOcean
  "fd00:ec2::254",    // AWS IPv6 metadata
]);

// Parse dotted IPv4 to 32-bit integer, or null if not a valid IPv4 literal.
function ipv4ToInt(host) {
  const parts = host.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value >>> 0;
}

// Private/reserved IPv4 ranges as [startInt, maskBits].
const BLOCKED_V4_RANGES = [
  [ipv4ToInt("0.0.0.0"), 8],       // Current network
  [ipv4ToInt("10.0.0.0"), 8],      // Private class A
  [ipv4ToInt("127.0.0.0"), 8],     // Loopback
  [ipv4ToInt("169.254.0.0"), 16],  // Link-local (includes metadata)
  [ipv4ToInt("172.16.0.0"), 12],   // Private class B
  [ipv4ToInt("192.168.0.0"), 16],  // Private class C
  [ipv4ToInt("224.0.0.0"), 4],     // Multicast
  [ipv4ToInt("240.0.0.0"), 4],     // Reserved
];

// Loopback-only IPv4 range (127.0.0.0/8)
const LOOPBACK_V4_RANGE = [ipv4ToInt("127.0.0.0"), 8];

function isBlockedIpv4(host) {
  const ip = ipv4ToInt(host);
  if (ip === null) return false;
  return BLOCKED_V4_RANGES.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (ip & mask) === (base & mask);
  });
}

function isBlockedIpv6(host) {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (h === "::1" || h === "::") return true;
  return h.startsWith("fe80:") || h.startsWith("fc00:") || h.startsWith("fd00:");
}

function isLoopbackIpv4(host) {
  const ip = ipv4ToInt(host);
  if (ip === null) return false;
  const [base, bits] = LOOPBACK_V4_RANGE;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ip & mask) === (base & mask);
}

function isLoopbackIpv6(host) {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  return h === "::1";
}

/**
 * Validate URL for SSRF safety.
 * @param {string} rawUrl - URL to validate
 * @param {object} options - Validation options
 * @param {boolean} options.allowLoopback - If true, allow loopback (127.0.0.1, ::1, localhost)
 * @param {boolean} options.loopbackOnly - If true, ONLY allow loopback (stricter than allowLoopback)
 * @returns {{ ok: true, url: URL } | { ok: false, error: string }}
 */
export function validateUrl(rawUrl, { allowLoopback = false, loopbackOnly = false } = {}) {
  if (!rawUrl || typeof rawUrl !== "string") {
    return { ok: false, error: "URL required" };
  }

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, error: "Invalid URL" };
  }

  if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
    return {
      ok: false,
      error: `Scheme "${parsed.protocol}" not allowed (http/https only)`,
    };
  }

  const host = parsed.hostname.toLowerCase();
  // Normalize IPv6 for comparison (remove brackets)
  const normalizedHost = host.replace(/^\[|\]$/g, "");

  // Check cloud metadata endpoints first (always blocked)
  if (CLOUD_METADATA_IPS.has(host) || CLOUD_METADATA_IPS.has(normalizedHost)) {
    return { ok: false, error: "Blocked URL: cloud metadata endpoint" };
  }

  // Check always-blocked hostnames
  if (BLOCKED_HOSTNAMES.has(host)) {
    return { ok: false, error: "Blocked URL: internal host" };
  }

  // Check blocked suffixes
  if (BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) {
    return { ok: false, error: "Blocked URL: internal host" };
  }

  // Handle loopback checking
  const isLoopback =
    LOOPBACK_HOSTS.has(host) ||
    isLoopbackIpv4(host) ||
    isLoopbackIpv6(normalizedHost);

  if (isLoopback) {
    if (allowLoopback || loopbackOnly) {
      return { ok: true, url: parsed };
    }
    return { ok: false, error: "Blocked URL: loopback not allowed" };
  }

  // Check private IPv4 ranges (excluding loopback, already handled)
  if (isBlockedIpv4(host) && !isLoopbackIpv4(host)) {
    return { ok: false, error: "Blocked URL: private IP" };
  }

  // Check private IPv6 ranges (excluding loopback, already handled)
  if (isBlockedIpv6(normalizedHost) && !isLoopbackIpv6(normalizedHost)) {
    return { ok: false, error: "Blocked URL: private IP" };
  }

  // If loopbackOnly mode, reject non-loopback hosts
  if (loopbackOnly) {
    return {
      ok: false,
      error: "Blocked URL: only loopback addresses allowed",
    };
  }

  return { ok: true, url: parsed };
}

/**
 * Throw if URL targets a non-public host. Caller should map to 400.
 * @param {string} rawUrl - URL to validate
 * @param {object} options - Validation options
 * @param {boolean} options.allowLoopback - If true, allow loopback addresses
 */
export function assertPublicUrl(rawUrl, options = {}) {
  const result = validateUrl(rawUrl, options);
  if (!result.ok) {
    throw new Error(result.error);
  }
  return result.url;
}
