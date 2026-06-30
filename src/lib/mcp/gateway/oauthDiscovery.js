// OAuth 2.0 discovery helpers for upstream MCP servers (RFC 9728 + 8414).

import { isRecord } from "./guards";

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
 * `resource_metadata="<url>"` parameter.
 * @param {unknown} wwwAuth
 * @returns {string | null}
 */
export function parseResourceMetadataFromChallenge(wwwAuth) {
  if (!wwwAuth || typeof wwwAuth !== "string") return null;
  const m = wwwAuth.match(/resource_metadata\s*=\s*"([^"]+)"/i);
  if (m) return m[1];
  const m2 = wwwAuth.match(/resource_metadata\s*=\s*([^\s,]+)/i);
  return m2 ? m2[1] : null;
}

/**
 * Walk the OAuth discovery chain.
 * @param {string | undefined} instanceUrl
 * @param {object} [opts]
 * @returns {Promise<object | null>}
 */
export async function discoverAuth(instanceUrl, opts = {}) {
  const challengeUrl = opts.wwwAuthenticate ? parseResourceMetadataFromChallenge(opts.wwwAuthenticate) : null;
  const candidates = [];
  if (challengeUrl) candidates.push(challengeUrl);
  for (const p of META_PATHS) {
    try { candidates.push(new URL(p, instanceUrl).toString()); } catch { /* bad base */ }
  }

  let resourceDoc = null;
  for (const url of candidates) {
    const j = await tryFetchJson(url);
    if (isRecord(j) && (Array.isArray(j.authorization_servers) || j.authorization_endpoint)) {
      resourceDoc = { ...j, _source: url };
      break;
    }
  }
  if (!resourceDoc) return null;

  const authServers = resourceDoc.authorization_servers;
  const asList = Array.isArray(authServers) && authServers.length > 0
    ? authServers
    : [new URL("/.well-known/oauth-authorization-server", instanceUrl).toString()];

  for (const asUrl of asList) {
    const wellKnown = (() => {
      try {
        const u = new URL(asUrl);
        if (!u.pathname || u.pathname === "/") return asUrl;
        return new URL("/.well-known/oauth-authorization-server", asUrl).toString();
      } catch { return null; }
    })();
    if (!wellKnown) continue;
    const meta = await tryFetchJson(wellKnown);
    if (isRecord(meta) && (meta.authorization_endpoint || meta.token_endpoint)) {
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
