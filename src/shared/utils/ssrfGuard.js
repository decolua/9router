// SSRF guard: block internal/private/metadata targets for server-side fetch.
import net from "node:net";

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.",
  "ip6-localhost",
  "ip6-loopback",
  "localtest.me",
  "vcap.me",
]);

const BLOCKED_SUFFIXES = [
  ".internal",
  ".local",
  ".localhost",
  ".localdomain",
  ".nip.io",
  ".sslip.io",
];

/**
 * Normalizes any IPv4 representation (decimal, hex, octal, truncated dotted) to 32-bit uint.
 * Returns null if not a valid IPv4 representation.
 */
export function parseIpv4ToInt(host) {
  let clean = host.replace(/\.$/, "").trim();

  // Pure 32-bit decimal (e.g. "2130706433")
  if (/^\d+$/.test(clean)) {
    const num = Number(clean);
    if (Number.isSafeInteger(num) && num >= 0 && num <= 0xffffffff) return num >>> 0;
    return null;
  }

  // Pure 32-bit hexadecimal (e.g. "0x7f000001")
  if (/^0x[0-9a-fA-F]+$/i.test(clean)) {
    const num = parseInt(clean, 16);
    if (Number.isSafeInteger(num) && num >= 0 && num <= 0xffffffff) return num >>> 0;
    return null;
  }

  // Pure 32-bit octal (e.g. "017700000001")
  if (/^0[0-7]+$/.test(clean)) {
    const num = parseInt(clean, 8);
    if (Number.isSafeInteger(num) && num >= 0 && num <= 0xffffffff) return num >>> 0;
    return null;
  }

  // Dotted notation (supports 1, 2, 3 or 4 parts in octal, hex, or decimal)
  const parts = clean.split(".");
  if (parts.length < 1 || parts.length > 4) return null;

  const parsedParts = [];
  for (const part of parts) {
    let val;
    if (/^0x[0-9a-fA-F]+$/i.test(part)) val = parseInt(part, 16);
    else if (/^0[0-7]+$/.test(part)) val = parseInt(part, 8);
    else if (/^\d+$/.test(part)) val = Number(part);
    else return null;

    if (!Number.isFinite(val) || val < 0) return null;
    parsedParts.push(val);
  }

  if (parsedParts.length === 4) {
    if (parsedParts.some((p) => p > 255)) return null;
    return ((parsedParts[0] << 24) | (parsedParts[1] << 16) | (parsedParts[2] << 8) | parsedParts[3]) >>> 0;
  } else if (parsedParts.length === 3) {
    if (parsedParts[0] > 255 || parsedParts[1] > 255 || parsedParts[2] > 0xffff) return null;
    return ((parsedParts[0] << 24) | (parsedParts[1] << 16) | parsedParts[2]) >>> 0;
  } else if (parsedParts.length === 2) {
    if (parsedParts[0] > 255 || parsedParts[1] > 0xffffff) return null;
    return ((parsedParts[0] << 24) | parsedParts[1]) >>> 0;
  } else if (parsedParts.length === 1) {
    if (parsedParts[0] > 0xffffffff) return null;
    return parsedParts[0] >>> 0;
  }
  return null;
}

// Blocked IPv4 ranges as [startInt, maskBits]
const BLOCKED_V4_RANGES = [
  [0x00000000, 8],  // 0.0.0.0/8 (Current network)
  [0x0a000000, 8],  // 10.0.0.0/8 (Private RFC 1918)
  [0x64400000, 10], // 100.64.0.0/10 (Carrier Grade NAT RFC 6598)
  [0x7f000000, 8],  // 127.0.0.0/8 (Loopback)
  [0xa9fe0000, 16], // 169.254.0.0/16 (Link-Local / Cloud Metadata)
  [0xac100000, 12], // 172.16.0.0/12 (Private RFC 1918)
  [0xc0000200, 24], // 192.0.2.0/24 (TEST-NET-1 RFC 5737)
  [0xc0a80000, 16], // 192.168.0.0/16 (Private RFC 1918)
  [0xc6120000, 15], // 198.18.0.0/15 (Benchmarking RFC 2544)
  [0xc6336400, 24], // 198.51.100.0/24 (TEST-NET-2 RFC 5737)
  [0xcb007100, 24], // 203.0.113.0/24 (TEST-NET-3 RFC 5737)
  [0xe0000000, 4],  // 224.0.0.0/4 (Multicast RFC 5771)
  [0xf0000000, 4],  // 240.0.0.0/4 (Reserved RFC 1112)
  [0xffffffff, 32], // 255.255.255.255/32 (Broadcast)
];

export function isBlockedIpv4(ipInt) {
  if (ipInt === null || ipInt === undefined) return false;
  return BLOCKED_V4_RANGES.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (ipInt & mask) === (base & mask);
  });
}

/**
 * Checks if an IPv6 address string is loopback, unique local, link-local, or IPv4-mapped private.
 */
export function isBlockedIpv6(host) {
  let clean = host.replace(/^\[|\]$/g, "").split("%")[0].toLowerCase();

  // IPv4-mapped IPv6 in dotted format (e.g. "::ffff:127.0.0.1")
  const v4Mapped = clean.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (v4Mapped) {
    const intV4 = parseIpv4ToInt(v4Mapped[1]);
    if (intV4 !== null) return isBlockedIpv4(intV4);
  }

  // IPv4-mapped IPv6 in hex notation (e.g. "::ffff:7f00:1")
  const hexMapped = clean.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (hexMapped) {
    const intV4 = ((parseInt(hexMapped[1], 16) << 16) | parseInt(hexMapped[2], 16)) >>> 0;
    return isBlockedIpv4(intV4);
  }

  // IPv4-compatible (e.g. "::127.0.0.1")
  const v4Compat = clean.match(/^::(\d+\.\d+\.\d+\.\d+)$/i);
  if (v4Compat) {
    const intV4 = parseIpv4ToInt(v4Compat[1]);
    if (intV4 !== null) return isBlockedIpv4(intV4);
  }

  // Loopback and unspecified
  if (clean === "::1" || clean === "::" || clean === "0:0:0:0:0:0:0:1" || clean === "0:0:0:0:0:0:0:0") return true;

  // Unique Local Addresses (fc00::/7 -> fc00:: to fdff::)
  if (/^f[cd][0-9a-f]{2}:/i.test(clean)) return true;

  // Link-Local (fe80::/10 -> fe80:: to febf::)
  if (/^fe[89ab][0-9a-f]:/i.test(clean) || clean.startsWith("fe80:")) return true;

  // Site-Local (fec0::/10)
  if (/^fe[c-f][0-9a-f]:/i.test(clean)) return true;

  // Documentation (2001:db8::/32) and Discard (100::/64)
  if (clean.startsWith("2001:db8:") || clean.startsWith("100:")) return true;

  return false;
}

/**
 * Throw if URL targets a non-public host. Caller should map to 400.
 */
export function assertPublicUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("Blocked URL: invalid URL structure");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Blocked URL: unsupported protocol (only HTTP/HTTPS allowed)");
  }

  let host = parsed.hostname.toLowerCase();
  if (!host) throw new Error("Blocked URL: missing hostname");

  // Strip trailing FQDN dot
  host = host.replace(/\.$/, "");

  if (BLOCKED_HOSTNAMES.has(host)) throw new Error("Blocked URL: internal host");
  if (BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) throw new Error("Blocked URL: internal host");

  // Check IPv4 in all numeric encodings
  const v4Int = parseIpv4ToInt(host);
  if (v4Int !== null) {
    if (isBlockedIpv4(v4Int)) throw new Error("Blocked URL: private IP");
  }

  // Check IPv6
  if (host.includes(":") || net.isIPv6(host)) {
    if (isBlockedIpv6(host)) throw new Error("Blocked URL: private IP");
  }
}

