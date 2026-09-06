// Merge manually-entered OAuth client credentials (client_id / client_secret /
// scope) from an instance create/update payload into the instance's oauthTokens
// bundle, WITHOUT clobbering any live token material already stored there.
//
// This is the path for Authorization Servers that don't support Dynamic Client
// Registration (no registration_endpoint) — the operator pre-registers a client
// (or uses a client-id-metadata-document URL) and pastes the client_id into the
// instance form. ensureClient() in the oauth authorize route then reads
// oauthTokens.client.clientId instead of trying to auto-register.
//
// Mutates `body`: strips the transient clientId/clientSecret/scope form fields
// so they are never spread onto the instance row as stray columns.
// Returns the merged oauthTokens object, or undefined when nothing was supplied
// (so callers can leave the stored tokens untouched).

export function mergeOauthClientConfig(existingTokens, body) {
  const pick = (k) => (typeof body[k] === "string" ? body[k].trim() : "");
  const clientId = pick("clientId");
  const clientSecret = pick("clientSecret");
  const scope = pick("scope");

  // Transient form-only fields — never persisted as instance columns.
  delete body.clientId;
  delete body.clientSecret;
  delete body.scope;

  if (!clientId && !clientSecret && !scope) return undefined;

  const base =
    existingTokens && typeof existingTokens === "object" && !Array.isArray(existingTokens)
      ? { ...existingTokens }
      : {};

  if (clientId || clientSecret) {
    const client = { ...(base.client || {}) };
    // Only a change of an *existing* client_id invalidates prior tokens; the
    // first-time set on a fresh instance has nothing to invalidate.
    const changingId = clientId && client.clientId && clientId !== client.clientId;
    if (clientId) client.clientId = clientId;
    if (clientSecret) client.clientSecret = clientSecret;
    base.client = client;
    // A new client_id invalidates any previously issued tokens → force re-login.
    if (changingId) {
      delete base.access_token;
      delete base.refresh_token;
      delete base.expires_at;
      base.needsReauth = false;
    }
  }

  if (scope) base.scope = scope;

  return base;
}
