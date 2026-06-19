// Per-instance token store + refresh-rotation helpers.
//
// The HTTP client (httpClient.mcpRequest) checks `oauthTokens.expires_at`
// before each call and refreshes if within 60s of expiry. To prevent
// concurrent calls from racing on the same instance, we serialize
// refresh attempts in a per-instance promise map on globalThis.

import { updateInstance, getInstanceById } from "@/lib/localDb";

const REFRESH_LEEWAY_MS = 60_000;
const KEY = "__9routerGatewayRefresh";

function inflightStore() {
  if (!globalThis[KEY]) globalThis[KEY] = new Map();
  return globalThis[KEY];
}

function hasUsableToken(oauthTokens) {
  if (!oauthTokens?.access_token) return false;
  if (oauthTokens.needsReauth) return false;
  if (!oauthTokens.expires_at) return true; // no expiry info — try as-is
  return Date.now() < (oauthTokens.expires_at - REFRESH_LEEWAY_MS);
}

/**
 * Extract refresh-handle metadata from a stored token bundle. Returns
 * `null` if the bundle lacks the required fields (no clientId or no
 * tokenEndpoint). Safe to pass to `ensureFreshToken`.
 */
export function oauthMetaFromTokens(oauthTokens) {
  if (!oauthTokens) return null;
  const tokenEndpoint = oauthTokens.token_endpoint || oauthTokens.as?.token_endpoint || null;
  const clientId = oauthTokens.client?.clientId || oauthTokens.client_id || null;
  const clientSecret = oauthTokens.client?.clientSecret || oauthTokens.client_secret || null;
  const resource = oauthTokens.resource || null;
  if (!tokenEndpoint || !clientId) return null;
  return { tokenEndpoint, clientId, clientSecret, resource };
}

/**
 * Ensure the instance's `oauthTokens` is fresh. If not, refresh (or
 * mark needsReauth). NEVER throws on refresh failure — instead, sets
 * `needsReauth=true` so the caller surfaces a friendly "re-login".
 *
 * Always returns a full instance object: `{...instance, oauthTokens: ...}`.
 * Callers MUST use the returned object downstream so the refreshed
 * access token is honored on this call.
 *
 * @param {object} instance
 * @param {object} meta  { tokenEndpoint, clientId, clientSecret?, resource? }
 * @returns {Promise<object>} the (possibly refreshed) instance
 */
export async function ensureFreshToken(instance, meta) {
  if (hasUsableToken(instance.oauthTokens)) return instance;
  if (!meta?.tokenEndpoint || !meta?.clientId) {
    return {
      ...instance,
      oauthTokens: { ...(instance.oauthTokens || {}), needsReauth: true },
    };
  }

  // Serialize per instance.
  const store = inflightStore();
  const existing = store.get(instance.id);
  if (existing) return existing;

  const p = doRefresh(instance, meta)
    .then((newTokens) => ({ ...instance, oauthTokens: newTokens }))
    .catch((e) => {
      // Refresh failed — mark needsReauth but do not throw.
      console.warn(`[mcp-gw] refresh failed for ${instance.slug}: ${e?.message}`);
      return {
        ...instance,
        oauthTokens: { ...(instance.oauthTokens || {}), needsReauth: true },
      };
    })
    .finally(() => {
      store.delete(instance.id);
    });
  store.set(instance.id, p);
  return p;
}

async function doRefresh(instance, { tokenEndpoint, clientId, clientSecret, resource }) {
  const refresh = instance.oauthTokens?.refresh_token;
  if (!refresh) {
    throw new Error("no refresh_token — re-login required");
  }
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refresh,
    client_id: clientId,
  });
  if (clientSecret) body.set("client_secret", clientSecret);
  if (resource) body.set("resource", resource);

  const res = await fetch(tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`refresh ${res.status}: ${text?.slice(0, 200)}`);
  }
  const doc = await res.json().catch(() => null);
  if (!doc?.access_token) throw new Error("refresh response missing access_token");

  const newTokens = {
    ...(instance.oauthTokens || {}),
    access_token: doc.access_token,
    refresh_token: doc.refresh_token || refresh, // RFC 6749 §6: returned refresh_token replaces the old one
    token_type: doc.token_type || instance.oauthTokens?.token_type || "Bearer",
    scope: doc.scope || instance.oauthTokens?.scope,
    expires_at: doc.expires_in ? Date.now() + Number(doc.expires_in) * 1000 : instance.oauthTokens?.expires_at,
    needsReauth: false,
    fetched_at: Date.now(),
  };
  await updateInstance(instance.id, { oauthTokens: newTokens });
  return newTokens;
}

/**
 * Persist a fresh token bundle after authorize-code exchange or
 * dynamic registration. Standard shape so all callers converge.
 */
export async function storeTokens(instanceId, partial) {
  const merged = {
    needsReauth: false,
    fetched_at: Date.now(),
    ...partial,
  };
  await updateInstance(instanceId, { oauthTokens: merged });
  return merged;
}

/**
 * Helper for callers that may have a stale instance row: load the
 * latest from DB and return its tokens.
 */
export async function readFreshTokens(instanceId) {
  const inst = await getInstanceById(instanceId);
  return inst?.oauthTokens || null;
}
