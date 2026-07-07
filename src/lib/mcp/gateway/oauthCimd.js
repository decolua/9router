// Client ID Metadata Documents (draft-ietf-oauth-client-id-metadata-document).
//
// When an upstream authorization server advertises
// `client_id_metadata_document_supported` but offers no Dynamic Client
// Registration endpoint, the OAuth client_id may itself be an HTTPS URL that
// resolves to a JSON client-metadata document. This lets us authenticate
// without pre-registering a client. We serve one document PER INSTANCE so its
// `redirect_uris` exactly match that instance's callback, and so the client_id
// URL is stable and self-describing.
//
// The AS fetches the client_id URL server-to-server, so it MUST be a publicly
// reachable https origin (a tunnel / public hostname, not localhost).

const LOOPBACK_HOST = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[?::1\]?)$/i;

/** The per-instance client_id URL (also the metadata document's own URL). */
export function cimdClientId(base, instanceId) {
  return `${base}/api/mcp-gateway/oauth/${instanceId}/client-metadata`;
}

/** The per-instance OAuth redirect URI. */
export function cimdRedirectUri(base, instanceId) {
  return `${base}/api/mcp-gateway/oauth/${instanceId}/callback`;
}

/**
 * Build the client-metadata document served at the client_id URL.
 * `client_id` MUST equal the document's own URL per the spec.
 */
export function buildClientMetadataDocument({ base, instanceId, slug, scope }) {
  const doc = {
    client_id: cimdClientId(base, instanceId),
    client_name: `9router MCP Gateway${slug ? ` (${slug})` : ""}`,
    client_uri: base,
    redirect_uris: [cimdRedirectUri(base, instanceId)],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  };
  if (scope) doc.scope = scope;
  return doc;
}

/** True when `base` is an origin the upstream AS can fetch (not loopback). */
export function isPubliclyFetchableBase(base) {
  try {
    const u = new URL(base);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    const host = u.hostname.replace(/^\[|\]$/g, "");
    return !LOOPBACK_HOST.test(host);
  } catch {
    return false;
  }
}
