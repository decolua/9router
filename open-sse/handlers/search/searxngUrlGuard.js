// SearXNG base URL validation guard.
//
// Design intent: SearXNG is a self-hosted search engine deployed on any host —
// including localhost, LAN IPs, and public servers.  Unlike the headroom probe
// guard (which is loopback-only), this guard permits private IP ranges because
// self-hosting on a LAN or local Docker network is the primary use case.
//
// What IS blocked:
//   - Non-http/https schemes (file://, javascript://, gopher://, etc.)
//   - Cloud-provider instance-metadata endpoints (169.254.169.254, etc.)
//   - IPv6-mapped IPv4 addresses that resolve to blocked hosts (::ffff:a9fe:a9fe etc.)
//   - IPv6 link-local addresses (fe80::)
//   - Unparseable / empty input
//
// Known limitation — DNS rebinding / hostname aliases:
//   This guard performs static URL validation with no DNS resolution. Hostnames
//   that resolve to metadata IPs at runtime (e.g. metadata.google.internal →
//   169.254.169.254 on GCP, instance-data on Ubuntu EC2) are NOT blocked here.
//   The risk is accepted because (a) an attacker must already hold an authenticated
//   SearXNG admin connection to supply this URL, and (b) full DNS-time blocking
//   would require an egress proxy layer outside this guard's scope. Future
//   maintainers should not assume this guard provides stronger guarantees than
//   static URL string analysis.
//
// What IS allowed:
//   - http:// and https://
//   - localhost / 127.x.x.x / ::1 (loopback)
//   - 10.x, 172.16-31.x, 192.168.x  (RFC-1918 private, intentional self-hosting)
//   - Any public hostname/IP

export const ALLOWED_SCHEMES = new Set(["http:", "https:"]);

// Instance-metadata and link-local addresses that must always be blocked —
// these are never valid SearXNG deployment targets.
const BLOCKED_HOSTNAMES = new Set([
  "169.254.169.254",  // AWS / GCP / Azure IMDS (IPv4 link-local)
  "100.100.100.200",  // Alibaba Cloud metadata
]);

/**
 * Validate a user-supplied SearXNG base URL.
 *
 * Allows private/loopback hosts intentionally (self-hosted use case).
 * Blocks only dangerous schemes and known metadata endpoints.
 *
 * @param {string|undefined|null} input - Raw URL string from user input.
 * @returns {{ ok: true, url: URL } | { ok: false, error: string }}
 */
export function validateSearxngBaseUrl(input) {
  if (!input || typeof input !== "string") {
    return { ok: false, error: "URL required" };
  }
  const trimmed = input.trim();
  if (!trimmed) {
    return { ok: false, error: "URL required" };
  }

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: "Invalid URL — must be a valid absolute URL (e.g. http://localhost:8080)" };
  }

  if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
    return {
      ok: false,
      error: `Scheme "${parsed.protocol}" not allowed — use http:// or https://`,
    };
  }

  const hostname = parsed.hostname.toLowerCase();

  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return { ok: false, error: `Host "${hostname}" is a blocked metadata endpoint` };
  }

  // IPv6 link-local (fe80::) is not a valid deployment target
  const bare = hostname.replace(/^\[|\]$/g, "");
  if (bare.startsWith("fe80:") || bare.includes("%")) {
    return { ok: false, error: `Host "${hostname}" is a link-local IPv6 address — not allowed` };
  }

  // IPv6-mapped IPv4 (::ffff:<v4>) bypasses the BLOCKED_HOSTNAMES set because
  // the Node.js URL API normalises e.g. ::ffff:169.254.169.254 → ::ffff:a9fe:a9fe
  // (hex groups), so the raw string never matches BLOCKED_HOSTNAMES. On dual-stack
  // sockets the mapped address routes through IPv4 and reaches the metadata service.
  if (bare.startsWith("::ffff:")) {
    const v4part = bare.slice(7); // everything after "::ffff:"
    let v4addr = null;
    if (v4part.includes(":")) {
      // Hex-group form normalised by URL API: e.g. "a9fe:a9fe" or "6464:64c8"
      const parts = v4part.split(":");
      if (parts.length === 2) {
        const hi = parseInt(parts[0], 16);
        const lo = parseInt(parts[1], 16);
        if (!isNaN(hi) && !isNaN(lo)) {
          v4addr = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
        }
      }
    } else if (v4part.includes(".")) {
      // Dotted-decimal form (less common but valid): e.g. "169.254.169.254"
      v4addr = v4part;
    }
    if (v4addr && BLOCKED_HOSTNAMES.has(v4addr)) {
      return {
        ok: false,
        error: `Host "${hostname}" is an IPv6-mapped address that routes to blocked IPv4 host "${v4addr}"`,
      };
    }
  }

  return { ok: true, url: parsed };
}
