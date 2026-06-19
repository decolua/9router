// OAuth 2.0 discovery helpers for upstream MCP servers (RFC 9728 + 8414).
//
// MCP servers advertise OAuth via a 401 response carrying a
// `WWW-Authenticate: Bearer resource_metadata="<url>"` header pointing
// at an RFC 9728 protected-resource manifest. That manifest lists one
// or more authorization servers, each of which publishes RFC 8414
// metadata at `/.well-known/oauth-authorization-server`.
//
// On any 401/403 from a gateway upstream, the HTTP client surfaces the
// `WWW-Authenticate` header; we hand that here, walk the chain, and
// return endpoints the operator can use to drive the browser flow.

const META_PATHS = [
  "/.well-known/oauth-protected-resource",
  "/.well-known/oauth-authorization-server",
];

function safeParse(s) {
  if (!s) return null;
  try { return JSON.parse(s); } catch { return null; }
}

function tryFetchJson(url, timeoutMs = 8000) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  return fetch(url, {
    method: "GET",
    headers: { Accept: "application/json" },
    signal: ac.signal,
  })
    .then((r) => (r.ok ? r.json().catch(() => null) : null))
    .catch(() => null)
    .finally(() => clearTimeout(timer));
}

/**
 * Parse a `WWW-Authenticate` Bearer challenge for the
 * `resource_metadata="<url>"` parameter. Returns the URL or null.
 */
export function parseResourceMetadataFromChallenge(wwwAuth) {
  if (!wwwAuth || typeof wwwAuth !== "string") return null;
  // Tolerate "Bearer" with arbitrary ordering of params.
  const m = wwwAuth.match(/resource_metadata\s*=\s*"([^"]+)"/i);
  if (m) return m[1];
  // Also handle unquoted form (rare but valid per the grammar).
  const m2 = wwwAuth.match(/resource_metadata\s*=\s*([^\s,]+)/i);
  return m2 ? m2[1] : null;
}

/**
 * Walk the discovery chain. Returns:
 *   { authorization_servers, authorization_endpoint, token_endpoint,
 *     registration_endpoint, resource }
 * or null on total failure (caller decides what to do).
 */
export async function discoverAuth(instanceUrl, opts = {}) {
  const challengeUrl = opts.wwwAuthenticate ? parseResourceMetadataFromChallenge(opts.wwwAuthenticate) : null;
  const candidates = [];
  if (challengeUrl) candidates.push(challengeUrl);
  for (const p of META_PATHS) {
    try { candidates.push(new URL(p, instanceUrl).toString()); } catch { /* bad base */ }
  }

  // Step 1: protected-resource metadata
  let resourceDoc = null;
  for (const url of candidates) {
    const j = await tryFetchJson(url);
    if (j && (Array.isArray(j.authorization_servers) || j.authorization_endpoint)) {
      resourceDoc = { ...j, _source: url };
      break;
    }
  }
  if (!resourceDoc) return null;

  const asList = Array.isArray(resourceDoc.authorization_servers) && resourceDoc.authorization_servers.length > 0
    ? resourceDoc.authorization_servers
    : [new URL("/.well-known/oauth-authorization-server", instanceUrl).toString()];

  // Step 2: per-AS metadata
  for (const asUrl of asList) {
    // AS metadata may live at either <as>/.well-known/oauth-authorization-server
    // or directly at <as> if it has no path. Try the well-known form first.
    const wellKnown = (() => {
      try {
        const u = new URL(asUrl);
        // If the path is just "/" or empty, the metadata is AT the AS URL.
        if (!u.pathname || u.pathname === "/") return asUrl;
        return new URL("/.well-known/oauth-authorization-server", asUrl).toString();
      } catch { return null; }
    })();
    if (!wellKnown) continue;
    const meta = await tryFetchJson(wellKnown);
    if (meta && (meta.authorization_endpoint || meta.token_endpoint)) {
      return {
        ...meta,
        resource: resourceDoc.resource || instanceUrl,
        authorization_servers: asList,
        _discovery: { protectedResource: resourceDoc._source, as: wellKnown },
      };
    }
  }
  return null;
}

export { safeParse };
