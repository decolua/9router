// SSRF guard: block internal/private/metadata targets for server-side fetch.

import { lookup as dnsLookup } from "node:dns";
import { isIP } from "node:net";
import { Agent, buildConnector } from "undici";

export const SSRF_BLOCKED_ERROR_CODE = "ERR_SSRF_BLOCKED";

const BLOCKED_HOSTNAMES = new Set(["localhost", "ip6-localhost", "ip6-loopback"]);
const BLOCKED_SUFFIXES = [".internal", ".local", ".localhost"];

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
  [ipv4ToInt("0.0.0.0"), 8],
  [ipv4ToInt("10.0.0.0"), 8],
  [ipv4ToInt("100.64.0.0"), 10],
  [ipv4ToInt("127.0.0.0"), 8],
  [ipv4ToInt("169.254.0.0"), 16],
  [ipv4ToInt("172.16.0.0"), 12],
  [ipv4ToInt("192.0.0.0"), 24],
  [ipv4ToInt("192.0.2.0"), 24],
  [ipv4ToInt("192.168.0.0"), 16],
  [ipv4ToInt("198.18.0.0"), 15],
  [ipv4ToInt("198.51.100.0"), 24],
  [ipv4ToInt("203.0.113.0"), 24],
  [ipv4ToInt("224.0.0.0"), 4],
  [ipv4ToInt("240.0.0.0"), 4],
];

function isBlockedIpv4(host) {
  const ip = ipv4ToInt(host);
  if (ip === null) return false;
  return BLOCKED_V4_RANGES.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (ip & mask) === (base & mask);
  });
}

function ipv6ToWords(host) {
  const raw = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (!raw || raw.includes("%")) return null;

  let normalized;
  try {
    normalized = new URL(`http://[${raw}]/`).hostname.slice(1, -1);
  } catch {
    return null;
  }

  const halves = normalized.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return null;

  const parts = halves.length === 2
    ? [...left, ...Array(missing).fill("0"), ...right]
    : left;
  if (parts.length !== 8 || parts.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return null;
  return parts.map((part) => Number.parseInt(part, 16));
}

function wordsToIpv4(words) {
  const value = ((words[6] << 16) | words[7]) >>> 0;
  return `${value >>> 24}.${(value >>> 16) & 255}.${(value >>> 8) & 255}.${value & 255}`;
}

function isBlockedIpv6(host) {
  const words = ipv6ToWords(host);
  if (!words) return true;

  // IPv4-mapped IPv6 (including hexadecimal forms such as ::ffff:7f00:1).
  if (words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff) {
    return isBlockedIpv4(wordsToIpv4(words));
  }

  // Unspecified, loopback and deprecated IPv4-compatible IPv6 (::/96).
  if (words.slice(0, 6).every((word) => word === 0)) return true;

  const first = words[0];
  if ((first & 0xfe00) === 0xfc00) return true; // Unique local fc00::/7
  if ((first & 0xffc0) === 0xfe80) return true; // Link-local fe80::/10
  if ((first & 0xffc0) === 0xfec0) return true; // Deprecated site-local fec0::/10
  if ((first & 0xff00) === 0xff00) return true; // Multicast ff00::/8
  if (first === 0x2001 && words[1] === 0x0db8) return true; // Documentation 2001:db8::/32
  return false;
}

function blockedError(message) {
  const error = new Error(message);
  error.code = SSRF_BLOCKED_ERROR_CODE;
  return error;
}

export function assertPublicAddress(address) {
  const family = isIP(address);
  if (family === 4 && !isBlockedIpv4(address)) return;
  if (family === 6 && !isBlockedIpv6(address)) return;
  if (family === 4 || family === 6) throw blockedError("Blocked URL: private IP");
  throw blockedError("Blocked URL: invalid DNS address");
}

// Throw if URL targets a non-public host. Caller should map to 400.
export function assertPublicHostname(rawHost) {
  const host = String(rawHost || "").toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!host) throw blockedError("Blocked URL: missing host");
  if (BLOCKED_HOSTNAMES.has(host)) throw blockedError("Blocked URL: internal host");
  if (BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) throw blockedError("Blocked URL: internal host");
  if (isIP(host)) assertPublicAddress(host);
}

export function assertPublicUrl(rawUrl) {
  const parsed = new URL(rawUrl);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw blockedError("Blocked URL: unsupported protocol");
  }
  assertPublicHostname(parsed.hostname);
}

/**
 * DNS lookup hook for undici. Every address returned to the socket is checked,
 * so DNS rebinding and redirect targets cannot bypass a pre-fetch string check.
 */
export function createPublicOnlyLookup(lookup = dnsLookup) {
  return (hostname, options, callback) => {
    const requestedAll = options?.all === true;
    lookup(hostname, { ...options, all: true, verbatim: true }, (error, records, family) => {
      if (error) return callback(error);

      const addresses = Array.isArray(records)
        ? records
        : [{ address: records, family }];

      try {
        if (addresses.length === 0) throw blockedError("Blocked URL: DNS returned no addresses");
        for (const record of addresses) assertPublicAddress(record.address);
      } catch (validationError) {
        return callback(validationError);
      }

      if (requestedAll) return callback(null, addresses);
      return callback(null, addresses[0].address, addresses[0].family);
    });
  };
}

export function createPublicOnlyFetch(lookup = dnsLookup) {
  const dispatcher = new Agent({ connect: createPublicOnlyConnector(lookup) });
  return (rawUrl, options = {}) => {
    assertPublicUrl(rawUrl);
    return fetch(rawUrl, { ...options, dispatcher });
  };
}

export function createPublicOnlyConnector(lookup = dnsLookup) {
  const connect = buildConnector({ lookup: createPublicOnlyLookup(lookup) });
  return (options, callback) => {
    try {
      // net.connect skips DNS for IP literals. Checking here ensures direct and
      // redirected literal IPs cannot bypass the DNS lookup hook.
      assertPublicHostname(options.hostname);
    } catch (error) {
      queueMicrotask(() => callback(error));
      return;
    }
    return connect(options, callback);
  };
}

export const fetchPublicUrl = createPublicOnlyFetch();
