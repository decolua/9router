// Per-instance token store + refresh-rotation helpers.
//
// The HTTP client (httpClient.mcpRequest) checks `oauthTokens.expires_at`
// before each call and refreshes if within 60s of expiry. To prevent
// concurrent calls from racing on the same instance, we serialize
// refresh attempts in a per-instance promise map on globalThis.

import { updateInstance, getInstanceById } from "@/lib/localDb";
import { isRecord } from "../../../../open-sse/types/guards.js";

const REFRESH_LEEWAY_MS = 60_000;
const KEY = "__9routerGatewayRefresh";

// exactOptionalPropertyTypes: use `T | undefined` (not `?:`) so runtime object
// literals that include undefined-valued keys remain well-typed.
interface OAuthTokens {
  access_token: string | undefined;
  accessToken: string | undefined;
  refresh_token: string | undefined;
  token_endpoint: string | undefined;
  client_id: string | undefined;
  client_secret: string | undefined;
  clientId: string | undefined;
  clientSecret: string | undefined;
  client: { clientId: string | undefined; clientSecret: string | undefined } | undefined;
  as: { token_endpoint: string | undefined } | undefined;
  resource: string | undefined;
  token_type: string | undefined;
  scope: string | undefined;
  expires_at: number | undefined;
  expires_in: number | undefined;
  needsReauth: boolean | undefined;
  fetched_at: number | undefined;
}

interface OAuthMeta {
  tokenEndpoint: string;
  clientId: string;
  clientSecret: string | null;
  resource: string | null;
}

interface McpInstance {
  id: string;
  slug: string | undefined;
  oauth: boolean | undefined;
  oauthTokens: OAuthTokens | undefined;
  headers: Record<string, string> | undefined;
  url: string | undefined;
  [key: string]: unknown;
}

const inflightKey = KEY as string;

function inflightStore(): Map<string, Promise<McpInstance>> {
  if (!(inflightKey in globalThis) || !(globalThis as Record<string, unknown>)[inflightKey]) {
    (globalThis as Record<string, unknown>)[inflightKey] = new Map<string, Promise<McpInstance>>();
  }
  return (globalThis as Record<string, unknown>)[inflightKey] as Map<string, Promise<McpInstance>>;
}

function hasUsableToken(oauthTokens: OAuthTokens | undefined | null): boolean {
  if (!oauthTokens?.access_token) return false;
  if (oauthTokens.needsReauth) return false;
  if (oauthTokens.expires_at === undefined) return true; // no expiry info — try as-is
  return Date.now() < (oauthTokens.expires_at - REFRESH_LEEWAY_MS);
}

/**
 * Extract refresh-handle metadata from a stored token bundle. Returns
 * `null` if the bundle lacks the required fields (no clientId or no
 * tokenEndpoint). Safe to pass to `ensureFreshToken`.
 */
export function oauthMetaFromTokens(oauthTokens: OAuthTokens | null | undefined): OAuthMeta | null {
  if (!oauthTokens) return null;
  const tokenEndpoint = oauthTokens.token_endpoint ?? oauthTokens.as?.token_endpoint ?? null;
  const clientId = oauthTokens.client?.clientId ?? oauthTokens.client_id ?? null;
  const clientSecret = oauthTokens.client?.clientSecret ?? oauthTokens.client_secret ?? null;
  const resource = oauthTokens.resource ?? null;
  if (!tokenEndpoint || !clientId) return null;
  return { tokenEndpoint, clientId, clientSecret: clientSecret ?? null, resource };
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
 * @param instance
 * @param meta  { tokenEndpoint, clientId, clientSecret?, resource? }
 * @returns the (possibly refreshed) instance
 */
export async function ensureFreshToken(instance: McpInstance, meta: OAuthMeta | null): Promise<McpInstance> {
  if (hasUsableToken(instance.oauthTokens)) return instance;
  if (!meta?.tokenEndpoint || !meta?.clientId) {
    return {
      ...instance,
      oauthTokens: { ...(instance.oauthTokens ?? {} as OAuthTokens), needsReauth: true },
    };
  }

  // Serialize per instance.
  const store = inflightStore();
  const existing = store.get(instance.id);
  if (existing) return existing;

  const p = doRefresh(instance, meta)
    .then((newTokens) => ({ ...instance, oauthTokens: newTokens }))
    .catch((e: unknown) => {
      // Refresh failed — mark needsReauth but do not throw.
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[mcp-gw] refresh failed for ${instance.slug}: ${msg}`);
      return {
        ...instance,
        oauthTokens: { ...(instance.oauthTokens ?? {} as OAuthTokens), needsReauth: true },
      };
    })
    .finally(() => {
      store.delete(instance.id);
    });
  store.set(instance.id, p);
  return p;
}

async function doRefresh(
  instance: McpInstance,
  { tokenEndpoint, clientId, clientSecret, resource }: OAuthMeta,
): Promise<OAuthTokens> {
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
  const raw: unknown = await res.json().catch(() => null);
  if (!isRecord(raw) || typeof raw["access_token"] !== "string") {
    throw new Error("refresh response missing access_token");
  }

  const newTokens: OAuthTokens = {
    ...(instance.oauthTokens ?? {} as OAuthTokens),
    access_token: raw["access_token"],
    refresh_token: typeof raw["refresh_token"] === "string" ? raw["refresh_token"] : refresh, // RFC 6749 §6
    token_type: typeof raw["token_type"] === "string" ? raw["token_type"] : (instance.oauthTokens?.token_type ?? "Bearer"),
    scope: typeof raw["scope"] === "string" ? raw["scope"] : instance.oauthTokens?.scope,
    expires_at: typeof raw["expires_in"] === "number"
      ? Date.now() + raw["expires_in"] * 1000
      : instance.oauthTokens?.expires_at,
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
export async function storeTokens(instanceId: string, partial: Partial<OAuthTokens>): Promise<OAuthTokens> {
  const merged: OAuthTokens = {
    needsReauth: false,
    fetched_at: Date.now(),
    ...partial,
  } as OAuthTokens;
  await updateInstance(instanceId, { oauthTokens: merged });
  return merged;
}

/**
 * Helper for callers that may have a stale instance row: load the
 * latest from DB and return its tokens.
 */
export async function readFreshTokens(instanceId: string): Promise<OAuthTokens | null> {
  const inst = await getInstanceById(instanceId) as McpInstance | null;
  return inst?.oauthTokens ?? null;
}
