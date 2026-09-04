// Relay header sanitization — single source of truth for every relay target
// (Vercel Edge, Cloudflare Workers, Deno Deploy).
//
// Root cause this fixes: the relay must be an anonymous forwarder. It used to
// copy every inbound header — including the platform edge's `x-forwarded-for`,
// `cf-connecting-ip`, `x-real-ip`, `cdn-loop`, `x-vercel-*`, … — to the
// upstream. Upstreams behind Cloudflare (e.g. opencode.ai) can recover the
// origin IP from `X-Forwarded-For` and keep rate-limiting it, so the relay is
// defeated and the free tier keeps returning HTTP 429 FreeUsageLimitError.
// Vercel's edge strips `X-Forwarded-For`/`X-Real-IP` on outbound fetch by
// default, which is why only Vercel relays bypassed the per-IP limiter.
// Stripping these headers explicitly in the relay makes every platform behave
// like Vercel.
//
// The same lists feed both sides:
// - `sanitizeRelayHeaders` runs in this process (tests, contract checks).
// - `buildRelaySanitizeSnippet()` emits equivalent JS source that is embedded
//   into the remotely-deployed relay code (which cannot import this module).

// Exact header names to drop (lowercased).
export const RELAY_STRIP_EXACT = [
  // Relay control headers (never forward upstream).
  "x-relay-target",
  "x-relay-path",
  "host",
  // Client-IP revealing headers — forwarding these defeats IP rotation.
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-forwarded-port",
  "x-forwarded-server",
  "forwarded",
  "via",
  "x-real-ip",
  "real-ip",
  "true-client-ip",
  "x-client-ip",
  "x-cluster-client-ip",
  "fastly-client-ip",
  "cf-connecting-ip",
  "cf-ipcountry",
  "cf-ray",
  "cf-visitor",
  "cf-warp-tag",
  "cf-request-id",
  "cdn-loop",
  // Hop-by-hop headers (RFC 2616 §13.5.1) — must not be forwarded by proxies.
  "connection",
  "keep-alive",
  "transfer-encoding",
  "te",
  "trailer",
  "upgrade",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "expect",
];

// Prefixes (lowercased) for platform/proxy header families.
export const RELAY_STRIP_PREFIXES = [
  "cf-",
  "x-vercel-",
  "x-deno-",
  "x-forwarded-",
  "x-amz-cf-",
  "x-amzn-",
  "fastly-",
  "akamai-",
  "cloudfront-",
];

export function shouldStripRelayHeader(name) {
  const lower = String(name || "").toLowerCase();
  if (!lower) return false;
  if (RELAY_STRIP_EXACT.includes(lower)) return true;
  return RELAY_STRIP_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

// Mutate `headers` in place (accepts a `Headers` instance or a plain object)
// and return it. Preserves everything else: authorization, content-type,
// user-agent, x-opencode-*, accept, …
export function sanitizeRelayHeaders(headers) {
  if (!headers) return headers;
  if (typeof headers.delete === "function" && typeof headers.forEach === "function") {
    const names = [];
    headers.forEach((_value, name) => names.push(name));
    for (const name of names) {
      if (shouldStripRelayHeader(name)) headers.delete(name);
    }
    return headers;
  }
  for (const name of Object.keys(headers)) {
    if (shouldStripRelayHeader(name)) delete headers[name];
  }
  return headers;
}

// JS source embedded into the remotely-deployed relay functions. Kept
// forEach-based (no iterator spread) for max runtime compat.
export function buildRelaySanitizeSnippet() {
  return [
    `const RELAY_STRIP_EXACT = new Set(${JSON.stringify(RELAY_STRIP_EXACT)});`,
    `const RELAY_STRIP_PREFIXES = ${JSON.stringify(RELAY_STRIP_PREFIXES)};`,
    "function sanitizeRelayHeaders(headers) {",
    "  const names = [];",
    "  headers.forEach(function (_v, name) { names.push(name); });",
    "  for (const name of names) {",
    "    const lower = name.toLowerCase();",
    "    if (RELAY_STRIP_EXACT.has(lower)) { headers.delete(name); continue; }",
    "    for (const prefix of RELAY_STRIP_PREFIXES) {",
    "      if (lower.indexOf(prefix) === 0) { headers.delete(name); break; }",
    "    }",
    "  }",
    "}",
  ].join("\n");
}
