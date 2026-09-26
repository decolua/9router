import { createHash } from "node:crypto";
import { getCapabilitiesForModel } from "open-sse/providers/capabilities.js";
import { refreshCodexToken, updateProviderCredentials } from "@/sse/services/tokenRefresh";

// The upstream Codex catalog is version-gated, including successful HTTP 200
// responses. Older client versions can silently omit models, so do not fall back
// to a known-incomplete catalog when discovery with this gate fails.
// 99.0.0 is a catalog compatibility gate, not a claimed installed CLI version.
const CODEX_CATALOG_URL = "https://chatgpt.com/backend-api/codex/models?client_version=99.0.0";
const CATALOG_TTL_MS = 5 * 60_000;
const MAX_STALE_MS = 30 * 60_000;
const RETRY_BACKOFF_MS = 30_000;
const MAX_CACHED_CATALOGS = 256;
const catalogCache = new Map();
const inFlight = new Map();

function cacheKey(connection) {
  const tokenHash = createHash("sha256").update(connection.accessToken).digest("hex").slice(0, 16);
  return `${connection.id}:${accountHeader(connection) || ""}:${tokenHash}`;
}

function accountHeader(connection) {
  return connection.providerSpecificData?.workspaceId
    || connection.providerSpecificData?.chatgptAccountId
    || connection.providerSpecificData?.accountId;
}

function normalizeCatalog(entries) {
  return entries.flatMap((entry) => {
    const id = entry?.slug;
    if (typeof id !== "string" || !id.trim() || (id !== "codex-auto-review" && ["hide", "hidden"].includes(entry.visibility?.toLowerCase()))) return [];
    const name = entry.display_name || entry.name || id;
    const caps = { ...getCapabilitiesForModel("codex", id) };
    if (!Number.isSafeInteger(entry.context_window) || entry.context_window <= 0) return [];
    caps.contextWindow = entry.context_window;
    const maxContextWindow = Number.isSafeInteger(entry.max_context_window) && entry.max_context_window > 0
      ? entry.max_context_window : undefined;
    const model = { id, name, capabilities: caps, ...(maxContextWindow ? { maxContextWindow } : {}) };
    if (id.endsWith("-review")) return [model];
    return [model, { ...model, id: `${id}-review`, name: `${name} Review`, upstreamModelId: id, quotaFamily: "review" }];
  });
}

async function requestCatalog(token, connection) {
  const accountId = accountHeader(connection);
  const headers = {
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
    originator: "codex_cli_rs",
    ...(accountId ? { "ChatGPT-Account-ID": accountId } : {}),
  };
  const response = await fetch(CODEX_CATALOG_URL, { headers, signal: AbortSignal.timeout(8000), cache: "no-store" });
  if (!response.ok) return { status: response.status };
  const data = await response.json();
  if (Array.isArray(data?.models)) {
    // A valid empty account-scoped catalog is not permission to advertise static models.
    return { models: normalizeCatalog(data.models) };
  }
  return { status: response.status };
}

export async function resolveCodexCatalog(connection) {
  if (!connection?.accessToken) return null;
  const scope = `${connection.id}:${accountHeader(connection) || ""}`;
  if (inFlight.has(scope)) return inFlight.get(scope);
  const promise = discoverCatalog(connection).finally(() => inFlight.delete(scope));
  inFlight.set(scope, promise);
  return promise;
}

async function discoverCatalog(connection) {
  if (!connection?.accessToken) return null;
  let key = cacheKey(connection);
  const scope = `${connection.id}:${accountHeader(connection) || ""}:`;
  for (const existing of catalogCache.keys()) {
    if (existing.startsWith(scope) && existing !== key) catalogCache.delete(existing);
  }
  const cached = catalogCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.models;
  let staleModels = cached?.staleUntil > Date.now() ? cached.models : [];
  if (cached?.retryAt > Date.now()) return staleModels;
  try {
    let result = await requestCatalog(connection.accessToken, connection);
    if (result.status === 401 || result.status === 403) staleModels = [];
    if ((result.status === 401 || result.status === 403) && connection.refreshToken) {
      const refreshed = await refreshCodexToken(connection.refreshToken);
      if (refreshed?.accessToken) {
        await updateProviderCredentials(connection.id, {
          accessToken: refreshed.accessToken,
          refreshToken: refreshed.refreshToken || connection.refreshToken,
          expiresIn: refreshed.expiresIn,
        });
        catalogCache.delete(key);
        key = cacheKey({ ...connection, accessToken: refreshed.accessToken });
        result = await requestCatalog(refreshed.accessToken, connection);
      }
    }
    if (result.status === 401 || result.status === 403) staleModels = [];
    if (Array.isArray(result.models)) {
      catalogCache.delete(key);
      catalogCache.set(key, { models: result.models, expiresAt: Date.now() + CATALOG_TTL_MS, staleUntil: Date.now() + MAX_STALE_MS });
      while (catalogCache.size > MAX_CACHED_CATALOGS) catalogCache.delete(catalogCache.keys().next().value);
      return result.models;
    }
  } catch {
    // Never log upstream error bodies or credentials.
  }
  console.warn("Codex model discovery unavailable; retaining bounded last-known catalog or no models");
  catalogCache.set(key, {
    models: staleModels, expiresAt: 0, staleUntil: cached?.staleUntil || 0,
    retryAt: Date.now() + RETRY_BACKOFF_MS,
  });
  while (catalogCache.size > MAX_CACHED_CATALOGS) catalogCache.delete(catalogCache.keys().next().value);
  return staleModels;
}
