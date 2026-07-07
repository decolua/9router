// Per-instance token store + refresh-rotation helpers.

import { updateInstance, getInstanceById } from "@/lib/localDb";
import { isRecord } from "./guards";

const REFRESH_LEEWAY_MS = 60_000;
const KEY = "__9routerGatewayRefresh";

function inflightStore() {
  if (!globalThis[KEY]) {
    globalThis[KEY] = new Map();
  }
  return globalThis[KEY];
}

function hasUsableToken(oauthTokens) {
  if (!oauthTokens?.access_token) return false;
  if (oauthTokens.needsReauth) return false;
  if (oauthTokens.expires_at === undefined) return true;
  return Date.now() < (oauthTokens.expires_at - REFRESH_LEEWAY_MS);
}

/**
 * Extract refresh-handle metadata from a stored token bundle.
 * @param {object | null | undefined} oauthTokens
 * @returns {object | null}
 */
export function oauthMetaFromTokens(oauthTokens) {
  if (!oauthTokens) return null;
  const tokenEndpoint = oauthTokens.token_endpoint ?? oauthTokens.as?.token_endpoint ?? null;
  const clientId = oauthTokens.client?.clientId ?? oauthTokens.client_id ?? null;
  const clientSecret = oauthTokens.client?.clientSecret ?? oauthTokens.client_secret ?? null;
  const resource = oauthTokens.resource ?? null;
  if (!tokenEndpoint || !clientId) return null;
  return { tokenEndpoint, clientId, clientSecret: clientSecret ?? null, resource };
}

/**
 * Ensure the instance's `oauthTokens` is fresh.
 * @param {object} instance
 * @param {object | null} meta
 * @returns {Promise<object>} the (possibly refreshed) instance
 */
export async function ensureFreshToken(instance, meta) {
  if (hasUsableToken(instance.oauthTokens)) return instance;
  if (!meta?.tokenEndpoint || !meta?.clientId) {
    return {
      ...instance,
      oauthTokens: { ...(instance.oauthTokens ?? {}), needsReauth: true },
    };
  }

  const store = inflightStore();
  const existing = store.get(instance.id);
  if (existing) return existing;

  const p = doRefresh(instance, meta)
    .then((newTokens) => ({ ...instance, oauthTokens: newTokens }))
    .catch((e) => {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[mcp-gw] refresh failed for ${instance.slug}: ${msg}`);
      return {
        ...instance,
        oauthTokens: { ...(instance.oauthTokens ?? {}), needsReauth: true },
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
    throw new Error(`refresh ${res.status}: ${text.slice(0, 200)}`);
  }
  const raw = await res.json().catch(() => null);
  if (!isRecord(raw) || typeof raw.access_token !== "string") {
    throw new Error("refresh response missing access_token");
  }

  const newTokens = {
    ...(instance.oauthTokens ?? {}),
    access_token: raw.access_token,
    refresh_token: typeof raw.refresh_token === "string" ? raw.refresh_token : refresh,
    token_type: typeof raw.token_type === "string" ? raw.token_type : (instance.oauthTokens?.token_type ?? "Bearer"),
    scope: typeof raw.scope === "string" ? raw.scope : instance.oauthTokens?.scope,
    expires_at: typeof raw.expires_in === "number"
      ? Date.now() + raw.expires_in * 1000
      : instance.oauthTokens?.expires_at,
    needsReauth: false,
    fetched_at: Date.now(),
  };
  await updateInstance(instance.id, { oauthTokens: newTokens });
  return newTokens;
}

/**
 * Persist a fresh token bundle after authorize-code exchange or dynamic registration.
 * @param {string} instanceId
 * @param {object} partial
 * @returns {Promise<object>}
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
 * Load the latest tokens for an instance directly from the DB.
 * @param {string} instanceId
 * @returns {Promise<object | null>}
 */
export async function readFreshTokens(instanceId) {
  const inst = await getInstanceById(instanceId);
  return inst?.oauthTokens ?? null;
}
