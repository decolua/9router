// SSRF guard: block internal/private/metadata targets for server-side fetch.
//
// Three layers, each closing a distinct bypass class documented in #3714:
//   1. assertPublicUrl        - synchronous literal-IP/hostname checks (cheap, for
//                                immediate rejection of obviously-bad input at request-build time).
//   2. assertPublicUrlResolved - adds DNS resolution so a hostname that merely
//                                *resolves* to a private/loopback address (e.g. a
//                                nip.io/sslip.io wildcard-DNS domain, or an attacker's
//                                own domain pointed at 127.0.0.1) is also rejected.
//   3. fetchPublic             - wraps fetch() with manual redirect handling so a
//                                validated public URL can't 30x its way to an
//                                internal target without the redirect target being
//                                re-validated through layer 2 first.
//
// Layer 1 alone previously had matching bugs, not just missing coverage: hostname
// checks ran on the raw string without normalizing a trailing dot ("localhost."),
// and the IPv6 check only recognized one textual representation of an IPv4-mapped
// address (dotted "::ffff:a.b.c.d") while Node/WHATWG URL parsing can normalize the
// same address to hex form ("::ffff:7f00:1") — a mismatch, not an oversight.

import dns from "node:dns";

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
  [ipv4ToInt("100.64.0.0"), 10], // CGNAT — also used by some cloud metadata proxies
  [ipv4ToInt("127.0.0.0"), 8],
  [ipv4ToInt("169.254.0.0"), 16], // includes 169.254.169.254 cloud metadata
  [ipv4ToInt("172.16.0.0"), 12],
  [ipv4ToInt("192.168.0.0"), 16],
];

function isBlockedIpv4Int(ip) {
  return BLOCKED_V4_RANGES.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (ip & mask) === (base & mask);
  });
}

function isBlockedIpv4(host) {
  const ip = ipv4ToInt(host);
  if (ip === null) return false;
  return isBlockedIpv4Int(ip);
}

function parseHextets(s) {
  if (s === "") return [];
  const segs = s.split(":");
  const out = [];
  for (const seg of segs) {
    if (!/^[0-9a-f]{1,4}$/.test(seg)) return null;
    out.push(parseInt(seg, 16));
  }
  return out;
}

// Parse any textual IPv6 representation (including an embedded dotted-IPv4 tail,
// "::" compression in any position, and full/partial forms) into 8 16-bit groups.
// Returns null if the string isn't a valid IPv6 literal. Parsing into groups once
// and reasoning about the numeric value — rather than pattern-matching the source
// string — is what makes this immune to "which textual form did the URL parser
// pick" bugs: "::ffff:127.0.0.1" and "::ffff:7f00:1" produce identical groups.
function parseIPv6ToGroups(rawHost) {
  let host = rawHost.toLowerCase();

  const v4TailMatch = host.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  let v4Groups = null;
  if (v4TailMatch) {
    const v4Int = ipv4ToInt(v4TailMatch[1]);
    if (v4Int === null) return null;
    v4Groups = [(v4Int >>> 16) & 0xffff, v4Int & 0xffff];
    host = host.slice(0, host.length - v4TailMatch[1].length);
    if (host.endsWith("::")) {
      // "::" compression marker itself — leave both colons, the removed IPv4
      // fills the gap it represents.
    } else if (host.endsWith(":")) {
      host = host.slice(0, -1); // was just the "prevgroup:ipv4" separator
    }
  }

  const doubleColonParts = host.split("::");
  if (doubleColonParts.length > 2) return null;

  let groups;
  if (doubleColonParts.length === 2) {
    const head = parseHextets(doubleColonParts[0]);
    const tail = parseHextets(doubleColonParts[1]);
    if (head === null || tail === null) return null;
    const v4Len = v4Groups ? v4Groups.length : 0;
    const missing = 8 - head.length - tail.length - v4Len;
    if (missing < 0) return null;
    groups = [...head, ...new Array(missing).fill(0), ...tail, ...(v4Groups || [])];
  } else {
    const all = parseHextets(host);
    if (all === null) return null;
    groups = [...all, ...(v4Groups || [])];
  }
  return groups.length === 8 ? groups : null;
}

function isBlockedIpv6Groups(g) {
  const isZero = (n) => g[n] === 0;
  // loopback ::1
  if ([0, 1, 2, 3, 4, 5, 6].every(isZero) && g[7] === 1) return true;
  // unspecified ::
  if (g.every((x) => x === 0)) return true;
  // link-local fe80::/10
  if ((g[0] & 0xffc0) === 0xfe80) return true;
  // unique local fc00::/7
  if ((g[0] & 0xfe00) === 0xfc00) return true;
  // IPv4-mapped ::ffff:0:0/96 (0:0:0:0:0:ffff:a.b.c.d — the 0xffff marker is
  // group index 5) and NAT64 well-known prefix 64:ff9b::/96 — both embed a
  // real IPv4 address in the low 32 bits; check it against the same IPv4
  // blocklist regardless of which prefix wraps it.
  const low32 = ((g[6] << 16) | g[7]) >>> 0;
  if ([0, 1, 2, 3, 4].every(isZero) && g[5] === 0xffff) return isBlockedIpv4Int(low32);
  if (g[0] === 0x0064 && g[1] === 0xff9b && [2, 3, 4, 5].every(isZero)) return isBlockedIpv4Int(low32);
  // IPv4-compatible ::a.b.c.d/96 (deprecated, still parseable) — excludes :: and ::1
  // which already matched above.
  if ([0, 1, 2, 3, 4, 5].every(isZero) && low32 !== 0 && low32 !== 1) return isBlockedIpv4Int(low32);
  return false;
}

function normalizeHost(hostname) {
  // A trailing dot marks an FQDN and is semantically insignificant
  // ("localhost." and "localhost" are the same host) but was being compared
  // as a literal character, letting it slip past every string-based check.
  return hostname.toLowerCase().replace(/\.+$/, "");
}

function isBlockedHost(host) {
  if (BLOCKED_HOSTNAMES.has(host)) return true;
  if (BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) return true;
  if (isBlockedIpv4(host)) return true;
  if (host.includes(":")) {
    const groups = parseIPv6ToGroups(host.replace(/^\[|\]$/g, ""));
    if (groups && isBlockedIpv6Groups(groups)) return true;
  }
  return false;
}

// Throw if URL targets a non-public host by literal hostname/IP alone (no DNS
// resolution — see assertPublicUrlResolved for that). Caller should map to 400.
export function assertPublicUrl(rawUrl) {
  const parsed = new URL(rawUrl);
  const host = normalizeHost(parsed.hostname);
  if (isBlockedHost(host)) throw new Error("Blocked URL: internal host");
}

// Async: assertPublicUrl plus DNS resolution of non-literal hostnames, so a
// domain that merely *resolves* to a private/loopback/metadata address (wildcard-DNS
// services like nip.io/sslip.io, or an attacker-controlled domain with an A record
// pointed at 127.0.0.1) is rejected too, not just IPs typed directly into the URL.
export async function assertPublicUrlResolved(rawUrl) {
  const parsed = new URL(rawUrl);
  const host = normalizeHost(parsed.hostname);
  if (isBlockedHost(host)) throw new Error("Blocked URL: internal host");

  // Already a literal IPv4/IPv6 address — isBlockedHost above already covered it,
  // no DNS lookup applies (and dns.lookup would just echo it back anyway).
  const bracketless = host.replace(/^\[|\]$/g, "");
  if (ipv4ToInt(bracketless) !== null || bracketless.includes(":")) return;

  let addresses;
  try {
    addresses = await dns.promises.lookup(host, { all: true, verbatim: true });
  } catch {
    // Resolution failure isn't an SSRF signal by itself — let the subsequent
    // fetch() fail with its own (clearer) network error.
    return;
  }
  for (const { address, family } of addresses) {
    if (family === 4 ? isBlockedIpv4(address) : isBlockedIpv6Groups(parseIPv6ToGroups(address) || [])) {
      throw new Error("Blocked URL: hostname resolves to an internal host");
    }
  }
}

// fetch() with SSRF-safe manual redirect handling: each hop's target is
// re-validated through assertPublicUrlResolved before being followed, so a
// validated public URL can't 30x its way to an internal target. Bounded to
// maxRedirects hops (fetch's own default following behavior has no bound
// relevant here since we never let it auto-follow).
export async function fetchPublic(url, init = {}, { maxRedirects = 5 } = {}) {
  await assertPublicUrlResolved(url);
  let currentUrl = url;
  for (let hop = 0; ; hop++) {
    const res = await fetch(currentUrl, { ...init, redirect: "manual" });
    const isRedirect = res.status >= 300 && res.status < 400;
    const location = isRedirect ? res.headers.get("location") : null;
    if (!location) return res;
    if (hop >= maxRedirects) throw new Error("Blocked URL: too many redirects");
    const nextUrl = new URL(location, currentUrl).toString();
    await assertPublicUrlResolved(nextUrl);
    currentUrl = nextUrl;
  }
}
