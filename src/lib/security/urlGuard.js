import { lookup as defaultLookup } from "node:dns/promises";
import { isIP } from "node:net";

const DEFAULT_PROTOCOLS = new Set(["https:"]);
const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_MAX_REDIRECTS = 3;

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "ip6-localhost",
  "metadata",
  "metadata.google.internal",
]);

export class UrlGuardError extends Error {
  constructor(message, code = "URL_BLOCKED") {
    super(message);
    this.name = "UrlGuardError";
    this.code = code;
  }
}

function normalizeHostname(hostname) {
  return String(hostname || "").trim().replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
}

function parseIpv4(ip) {
  const parts = String(ip).split(".");
  if (parts.length !== 4) return null;
  const bytes = parts.map((part) => {
    if (!/^\d+$/.test(part)) return null;
    const n = Number(part);
    return Number.isInteger(n) && n >= 0 && n <= 255 ? n : null;
  });
  return bytes.every((n) => n !== null) ? bytes : null;
}

function parseIpv6(ip) {
  let value = normalizeHostname(ip).split("%")[0];
  if (!value.includes(":")) return null;

  const embeddedIpv4 = value.match(/^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (embeddedIpv4) {
    const bytes = parseIpv4(embeddedIpv4[2]);
    if (!bytes) return null;
    value = `${embeddedIpv4[1]}${((bytes[0] << 8) | bytes[1]).toString(16)}:${((bytes[2] << 8) | bytes[3]).toString(16)}`;
  }

  const pieces = value.split("::");
  if (pieces.length > 2) return null;

  const left = pieces[0] ? pieces[0].split(":") : [];
  const right = pieces.length === 2 && pieces[1] ? pieces[1].split(":") : [];
  const parseGroup = (group) => {
    if (!/^[0-9a-f]{1,4}$/i.test(group)) return null;
    return Number.parseInt(group, 16);
  };

  const leftGroups = left.map(parseGroup);
  const rightGroups = right.map(parseGroup);
  if ([...leftGroups, ...rightGroups].some((n) => n === null || n < 0 || n > 0xffff)) return null;

  const zeroCount = pieces.length === 2 ? 8 - leftGroups.length - rightGroups.length : 0;
  if (zeroCount < 0) return null;
  const groups = pieces.length === 2
    ? [...leftGroups, ...Array(zeroCount).fill(0), ...rightGroups]
    : leftGroups;
  if (groups.length !== 8) return null;

  const bytes = [];
  for (const group of groups) {
    bytes.push((group >> 8) & 0xff, group & 0xff);
  }
  return bytes;
}

function bytesMatchPrefix(bytes, prefix, bits) {
  const whole = Math.floor(bits / 8);
  const rem = bits % 8;
  for (let i = 0; i < whole; i++) {
    if (bytes[i] !== prefix[i]) return false;
  }
  if (rem === 0) return true;
  const mask = (0xff << (8 - rem)) & 0xff;
  return (bytes[whole] & mask) === (prefix[whole] & mask);
}

function ipv4InRange(bytes, first, second = null, mask = null) {
  if (mask !== null) {
    const value = ((bytes[0] << 24) >>> 0) + (bytes[1] << 16) + (bytes[2] << 8) + bytes[3];
    return (value & mask) === first;
  }
  if (second !== null) return bytes[0] === first && bytes[1] >= second[0] && bytes[1] <= second[1];
  return bytes[0] === first;
}

export function isPrivateIpAddress(address) {
  const host = normalizeHostname(address);
  if (!host) return true;

  const v4 = parseIpv4(host);
  if (v4) {
    if (ipv4InRange(v4, 0)) return true;
    if (ipv4InRange(v4, 10)) return true;
    if (ipv4InRange(v4, 127)) return true;
    if (v4[0] === 100 && v4[1] >= 64 && v4[1] <= 127) return true;
    if (v4[0] === 169 && v4[1] === 254) return true;
    if (v4[0] === 172 && v4[1] >= 16 && v4[1] <= 31) return true;
    if (v4[0] === 192 && v4[1] === 168) return true;
    if (v4[0] === 192 && v4[1] === 0 && v4[2] === 0) return true;
    if (v4[0] === 192 && v4[1] === 0 && v4[2] === 2) return true;
    if (v4[0] === 192 && v4[1] === 88 && v4[2] === 99) return true;
    if (v4[0] === 198 && (v4[1] === 18 || v4[1] === 19)) return true;
    if (v4[0] === 198 && v4[1] === 51 && v4[2] === 100) return true;
    if (v4[0] === 203 && v4[1] === 0 && v4[2] === 113) return true;
    if (v4[0] >= 224) return true;
    return false;
  }

  const v6 = parseIpv6(host);
  if (!v6) return true;

  const ranges = [
    [[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 128],
    [[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1], 128],
    [[0, 100, 255, 155, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 48],
    [[1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 64],
    [[32, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 23],
    [[32, 1, 13, 184, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 32],
    [[32, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 16],
    [[252, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 7],
    [[254, 128, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 10],
    [[255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 8],
  ];

  if (ranges.some(([prefix, bits]) => bytesMatchPrefix(v6, prefix, bits))) return true;

  if (bytesMatchPrefix(v6, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 255, 255, 0, 0, 0, 0], 96)) {
    return isPrivateIpAddress(`${v6[12]}.${v6[13]}.${v6[14]}.${v6[15]}`);
  }

  return false;
}

export function isAllowedHostname(hostname, allowedHosts = []) {
  const host = normalizeHostname(hostname);
  return allowedHosts.some((entry) => {
    const allowed = normalizeHostname(entry);
    return host === allowed || host.endsWith(`.${allowed}`);
  });
}

export async function validatePublicUrl(input, options = {}) {
  const protocols = new Set(options.protocols || DEFAULT_PROTOCOLS);
  const allowPrivate = options.allowPrivate === true;
  const lookup = options.lookup || defaultLookup;
  let parsed;

  try {
    parsed = new URL(input);
  } catch {
    throw new UrlGuardError("Invalid URL", "INVALID_URL");
  }

  if (!protocols.has(parsed.protocol)) {
    throw new UrlGuardError("URL scheme is not allowed", "INVALID_SCHEME");
  }

  const hostname = normalizeHostname(parsed.hostname);
  if (!hostname) {
    throw new UrlGuardError("URL hostname is required", "INVALID_HOST");
  }

  if (!allowPrivate && BLOCKED_HOSTNAMES.has(hostname)) {
    throw new UrlGuardError("Private or local hosts are not allowed", "PRIVATE_HOST");
  }

  if (options.allowedHosts && !isAllowedHostname(hostname, options.allowedHosts)) {
    throw new UrlGuardError("URL host is not allowed", "HOST_NOT_ALLOWED");
  }

  if (!allowPrivate && isIP(hostname) && isPrivateIpAddress(hostname)) {
    throw new UrlGuardError("Private or reserved IPs are not allowed", "PRIVATE_IP");
  }

  if (!allowPrivate && !isIP(hostname)) {
    let records;
    try {
      records = await lookup(hostname, { all: true, verbatim: true });
    } catch {
      throw new UrlGuardError("DNS lookup failed", "DNS_LOOKUP_FAILED");
    }
    if (!Array.isArray(records) || records.length === 0) {
      throw new UrlGuardError("DNS lookup returned no addresses", "DNS_EMPTY");
    }
    for (const record of records) {
      if (!record?.address || isPrivateIpAddress(record.address)) {
        throw new UrlGuardError("DNS resolved to a private or reserved IP", "DNS_PRIVATE_IP");
      }
    }
  }

  return parsed;
}

export async function guardedFetch(input, fetchOptions = {}, guardOptions = {}) {
  const maxRedirects = guardOptions.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const timeoutMs = guardOptions.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let currentUrl = String(input);

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount++) {
    await validatePublicUrl(currentUrl, guardOptions);

    const controller = new AbortController();
    const upstreamSignal = fetchOptions.signal;
    const abortFromUpstream = () => controller.abort(upstreamSignal.reason);
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    if (upstreamSignal) {
      if (upstreamSignal.aborted) {
        controller.abort(upstreamSignal.reason);
      } else {
        upstreamSignal.addEventListener("abort", abortFromUpstream, { once: true });
      }
    }
    let response;
    try {
      response = await fetch(currentUrl, {
        ...fetchOptions,
        redirect: "manual",
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
      upstreamSignal?.removeEventListener?.("abort", abortFromUpstream);
    }

    if (![301, 302, 303, 307, 308].includes(response.status)) return response;

    const location = response.headers.get("location");
    if (!location) return response;
    if (redirectCount === maxRedirects) {
      throw new UrlGuardError("Too many redirects", "TOO_MANY_REDIRECTS");
    }

    currentUrl = new URL(location, currentUrl).toString();
    if (response.status === 303) {
      fetchOptions = { ...fetchOptions, method: "GET", body: undefined };
    }
  }

  throw new UrlGuardError("Too many redirects", "TOO_MANY_REDIRECTS");
}

export function toUrlGuardResponse(error) {
  if (error instanceof UrlGuardError) {
    return { error: error.message, code: error.code };
  }
  return { error: "URL validation failed", code: "URL_BLOCKED" };
}
