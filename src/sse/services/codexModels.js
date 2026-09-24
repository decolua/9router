/** Live Codex model discovery shared by the dashboard and model APIs. */
import { createHash } from "node:crypto";
import { CODEX_CLI_VERSION } from "open-sse/config/appConstants.js";
import { refreshCodexToken } from "open-sse/services/tokenRefresh.js";
import { updateProviderCredentials } from "./tokenRefresh.js";

const MODELS_URL = `https://chatgpt.com/backend-api/codex/models?client_version=${CODEX_CLI_VERSION}`;
const FETCH_TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 5 * 60_000;
const MAX_CACHE_ENTRIES = 100;
const catalogCache = new Map();

function accountIdFor(connection) {
  const data = connection?.providerSpecificData || {};
  return data.workspaceId || data.chatgptAccountId || data.accountId || "";
}

function cacheKeyFor(connection) {
  // A row ID alone is insufficient: tokens can be rotated or a row can be
  // reconnected to a different ChatGPT account. Never store plaintext tokens.
  if (!connection?.id || !connection?.accessToken) return null;
  const identity = JSON.stringify([
    connection.id,
    accountIdFor(connection),
    connection.accessToken,
  ]);
  return createHash("sha256").update(identity).digest("hex");
}

function parseModels(payload) {
  const entries = Array.isArray(payload)
    ? payload
    : payload?.models || payload?.data || payload?.results;
  if (!Array.isArray(entries)) return [];

  const models = [];
  const seen = new Set();
  const add = (model) => {
    if (!seen.has(model.id)) {
      seen.add(model.id);
      models.push(model);
    }
  };

  for (const item of entries) {
    if (!item || typeof item !== "object") continue;
    const id = item.id || item.slug || item.model || item.name;
    if (typeof id !== "string" || !id.trim()) continue;
    const cleanId = id.trim();
    const name = item.display_name || item.displayName || item.name || cleanId;
    const model = { ...item, id: cleanId, name: typeof name === "string" ? name : cleanId };
    add(model);

    // Codex's virtual review route is available for language models. Preserve
    // upstream metadata so new models have the same shape as registry entries.
    const isNonChat = [item.kind, item.type].some((value) =>
      ["image", "embedding", "embed"].includes(value)
    ) || /(?:^|[-_])(?:image|embed)/i.test(cleanId);
    if (!isNonChat && !cleanId.endsWith("-review")) {
      add({
        ...model,
        id: `${cleanId}-review`,
        name: `${model.name} Review`,
        upstreamModelId: cleanId,
        quotaFamily: "review",
      });
    }
  }
  return models;
}

async function fetchCatalog(connection, token) {
  const accountId = accountIdFor(connection);
  const headers = {
    Accept: "application/json",
    Authorization: `Bearer ${token}`,
    originator: "codex_cli_rs",
  };
  if (typeof accountId === "string" && accountId) {
    headers["ChatGPT-Account-ID"] = accountId;
  }
  return fetch(MODELS_URL, {
    method: "GET",
    headers,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
}

function cacheResult(connection, result) {
  const key = cacheKeyFor(connection);
  if (!key) return;
  const now = Date.now();
  for (const [existingKey, entry] of catalogCache) {
    if (entry.expiresAt <= now) catalogCache.delete(existingKey);
  }
  catalogCache.set(key, { models: result.models, expiresAt: now + CACHE_TTL_MS });
  if (catalogCache.size > MAX_CACHE_ENTRIES) {
    catalogCache.delete(catalogCache.keys().next().value);
  }
}

/**
 * Resolve account-specific Codex models. Failures produce an empty result so
 * callers can retain their own static fallback policy.
 */
export async function resolveCodexModels(connection, { forceRefresh = false } = {}) {
  if (!connection?.accessToken) {
    return { models: [], error: "No valid token found", status: 401 };
  }

  const key = cacheKeyFor(connection);
  if (!forceRefresh && key) {
    const cached = catalogCache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return { models: cached.models };
    }
  }

  try {
    let response = await fetchCatalog(connection, connection.accessToken);
    if (!response.ok && (response.status === 401 || response.status === 403) && connection.refreshToken) {
      // The local logging wrapper includes upstream OAuth response bodies on
      // refresh failure. Use the same refresh implementation without a logger.
      const refreshed = await refreshCodexToken(connection.refreshToken, null);
      if (refreshed?.accessToken) {
        await updateProviderCredentials(connection.id, {
          accessToken: refreshed.accessToken,
          refreshToken: refreshed.refreshToken || connection.refreshToken,
          idToken: refreshed.idToken,
          expiresIn: refreshed.expiresIn,
          lastRefreshAt: refreshed.lastRefreshAt || new Date().toISOString(),
        });
        connection.accessToken = refreshed.accessToken;
        if (refreshed.refreshToken) connection.refreshToken = refreshed.refreshToken;
        if (refreshed.idToken) connection.idToken = refreshed.idToken;
        response = await fetchCatalog(connection, refreshed.accessToken);
      }
    }

    if (!response.ok) {
      return { models: [], warning: `Failed to fetch Codex models: HTTP ${response.status}`, status: response.status };
    }

    const models = parseModels(await response.json());
    if (!models.length) {
      return { models: [], warning: "Codex returned no models." };
    }
    const result = { models };
    cacheResult(connection, result);
    return result;
  } catch (error) {
    const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError";
    return { models: [], warning: timedOut ? "Codex model fetch timed out." : "Failed to fetch Codex models." };
  }
}
