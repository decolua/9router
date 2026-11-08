// Live per-provider model catalogs, refreshed in the background.
//
// Some providers answer /v1/models from the account itself (Kiro, Qoder,
// Kimchi, Copilot, Cline, Clinepass, Grok CLI, Cursor, Zed) or from an
// OpenAI-compatible upstream's own /models. Those calls are slow and their
// resolvers are capped only by their own timeouts (kiro 30s, kimchi 20s, qoder
// 15s, copilot/cursor 10s), and eight of those providers have no static
// PROVIDER_MODELS entry to fall back on.
//
// Resolving them while a client waits made /v1/models take 10-20s with a few
// slow accounts, so clients timed out. Here the work is moved off the request
// path: a background pass refreshes every catalog in parallel, keeps the result
// in memory and in the kv table, and /v1/models only reads it. The endpoint is
// then fast no matter how many providers are connected, and still lists all of
// them.

import { getProviderConnections } from "@/lib/db/repos/connectionsRepo.js";
import { makeKv } from "@/lib/db/helpers/kvStore.js";
import {
  isAnthropicCompatibleProvider,
  isOpenAICompatibleProvider,
} from "@/shared/constants/providers";
import { PROVIDER_ID_TO_ALIAS } from "@/shared/constants/models";
import { PROVIDER_MODELS } from "open-sse/config/providerModels.js";
import { resolveKiroModels } from "open-sse/services/kiroModels.js";
import { resolveKimchiModels } from "open-sse/services/kimchiModels.js";
import { resolveQoderModels, routableQoderModels } from "open-sse/services/qoderModels.js";
import { resolveCopilotModels } from "open-sse/services/copilotModels.js";
import { resolveClinepassModels, resolveClineModels } from "open-sse/services/clinepassModels.js";
import { resolveGrokCliModels } from "open-sse/services/grokCliModels.js";
import { resolveCursorModels } from "open-sse/services/cursorModels.js";
import { resolveZedModels } from "open-sse/shared/zedAuth.js";
import { updateProviderCredentials } from "@/sse/services/tokenRefresh";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";

const CATALOG_SCOPE = "modelCatalog";
const catalogStore = makeKv(CATALOG_SCOPE);

export const REFRESH_INTERVAL_MS = Number(process.env.LIVE_CATALOG_REFRESH_MS || 10 * 60 * 1000);
const STARTUP_DELAY_MS = 1500;
const ON_DEMAND_THROTTLE_MS = 15 * 1000;
const COMPATIBLE_FETCH_TIMEOUT_MS = 8000;

export const INTERNAL_MODELS_FETCH_HEADER = "x-9r-internal-models-fetch";

const catalogCache = new Map();
let lastRefreshAt = 0;
let lastOnDemandAt = 0;
let timer = null;

function resolveQoderLiveModels(conn, provider) {
  return resolveQoderModels({
    provider,
    accessToken: conn.accessToken,
    apiKey: conn.apiKey,
    refreshToken: conn.refreshToken,
    email: conn.email,
    displayName: conn.displayName,
    providerSpecificData: conn.providerSpecificData || {}
  }).then((result) => {
    const models = routableQoderModels(result);
    if (!models.length) return null;
    return { models: models.map((m) => ({ id: m.id, name: m.name })) };
  });
}

const LIVE_MODEL_RESOLVERS = {
  kiro: async (conn) => {
    const result = await resolveKiroModels({
      accessToken: conn.accessToken,
      refreshToken: conn.refreshToken,
      providerSpecificData: conn.providerSpecificData || {}
    }, { log: console });
    return result?.models?.length ? { models: result.models } : null;
  },
  qoder: async (conn) => resolveQoderLiveModels(conn, "qoder"),
  "qoder-cn": async (conn) => resolveQoderLiveModels(conn, "qoder-cn"),
  kimchi: async (conn) => {
    const result = await resolveKimchiModels({
      accessToken: conn.accessToken,
      apiKey: conn.apiKey,
      providerSpecificData: conn.providerSpecificData || {}
    }, { log: console });
    return result?.models?.length ? { models: result.models } : null;
  },
  github: async (conn) => {
    const result = await resolveCopilotModels({
      accessToken: conn.accessToken,
      refreshToken: conn.refreshToken,
      providerSpecificData: conn.providerSpecificData || {}
    }, {
      log: console,
      onCredentialsRefreshed: async (refreshed) => {
        await updateProviderCredentials(conn.id, {
          copilotToken: refreshed.copilotToken,
          copilotTokenExpiresAt: refreshed.copilotTokenExpiresAt,
          existingProviderSpecificData: conn.providerSpecificData || {},
        });
      },
    });
    return result?.models?.length ? { models: result.models } : null;
  },
  clinepass: async (conn) => {
    const result = await resolveClinepassModels({
      accessToken: conn.accessToken,
      apiKey: conn.apiKey,
    });
    return result?.models?.length ? { models: result.models } : null;
  },
  cline: async (conn) => {
    const result = await resolveClineModels({
      accessToken: conn.accessToken,
      apiKey: conn.apiKey,
    });
    return result?.models?.length ? { models: result.models } : null;
  },
  "grok-cli": async (conn) => {
    const proxy = await resolveConnectionProxyConfig(conn.providerSpecificData || {});
    const result = await resolveGrokCliModels({
      ...conn,
      connectionId: conn.id,
    }, {
      log: console,
      proxyOptions: {
        connectionProxyEnabled: proxy.connectionProxyEnabled === true,
        connectionProxyUrl: proxy.connectionProxyUrl || "",
        connectionNoProxy: proxy.connectionNoProxy || "",
        vercelRelayUrl: proxy.vercelRelayUrl || "",
        strictProxy: proxy.strictProxy === true,
      },
      onCredentialsRefreshed: async (refreshed) => {
        await updateProviderCredentials(conn.id, {
          ...refreshed,
          existingProviderSpecificData: conn.providerSpecificData || {},
        });
      },
    });
    return result?.models?.length ? { models: result.models } : null;
  },
  cursor: async (conn) => {
    const result = await resolveCursorModels({
      accessToken: conn.accessToken,
      providerSpecificData: conn.providerSpecificData || {},
    }, { log: console });
    return result?.models?.length ? { models: result.models } : null;
  },
  zed: async (conn) => {
    const result = await resolveZedModels({
      accessToken: conn.accessToken,
      providerSpecificData: conn.providerSpecificData || {},
    });
    if (!result?.models?.length) return null;
    return {
      models: result.models
        .filter((m) => !m.isDisabled)
        .map((m) => ({
          id: m.id,
          name: m.name,
          capabilities: m.supportsTools ? { tools: true } : undefined,
        })),
    };
  },
};

const parseOpenAIStyleModels = (data) => {
  if (Array.isArray(data)) return data;
  return data?.data || data?.models || data?.results || [];
};

function catalogKey(providerId, conn) {
  return `${providerId}:${conn?.id ?? "noauth"}`;
}

async function fetchCompatibleModelIds(connection) {
  if (!connection?.apiKey) return [];

  const baseUrl = typeof connection?.providerSpecificData?.baseUrl === "string"
    ? connection.providerSpecificData.baseUrl.trim().replace(/\/$/, "")
    : "";

  if (!baseUrl) return [];

  let url = `${baseUrl}/models`;
  const headers = {
    "Content-Type": "application/json",
  };

  if (isOpenAICompatibleProvider(connection.provider)) {
    headers.Authorization = `Bearer ${connection.apiKey}`;
  } else if (isAnthropicCompatibleProvider(connection.provider)) {
    if (url.endsWith("/messages/models")) {
      url = url.slice(0, -9);
    } else if (url.endsWith("/messages")) {
      url = `${url.slice(0, -9)}/models`;
    }
    headers["x-api-key"] = connection.apiKey;
    headers["anthropic-version"] = "2023-06-01";
    headers.Authorization = `Bearer ${connection.apiKey}`;
  } else {
    return [];
  }

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { ...headers, [INTERNAL_MODELS_FETCH_HEADER]: "1" },
      cache: "no-store",
      signal: AbortSignal.timeout(COMPATIBLE_FETCH_TIMEOUT_MS),
    });

    if (!response.ok) return [];

    const rawModels = parseOpenAIStyleModels(await response.json());

    return Array.from(
      new Set(
        rawModels
          .map((model) => model?.id || model?.name || model?.model)
          .filter((modelId) => typeof modelId === "string" && modelId.trim() !== "")
      )
    );
  } catch {
    return [];
  }
}

function liveResolverFor(providerId, conn) {
  if (!LIVE_MODEL_RESOLVERS[providerId]) return null;
  const enabledModels = conn?.providerSpecificData?.enabledModels;
  if (Array.isArray(enabledModels) && enabledModels.length > 0) return null;
  return LIVE_MODEL_RESOLVERS[providerId];
}

function needsCompatibleCatalog(providerId, conn) {
  if (!isOpenAICompatibleProvider(providerId) && !isAnthropicCompatibleProvider(providerId)) return false;
  const enabledModels = conn?.providerSpecificData?.enabledModels;
  if (Array.isArray(enabledModels) && enabledModels.length > 0) return false;
  const staticAlias = PROVIDER_ID_TO_ALIAS[providerId] || providerId;
  return (PROVIDER_MODELS[staticAlias] || []).length === 0;
}

async function readPersisted(key) {
  try {
    return await catalogStore.get(key);
  } catch {
    return null;
  }
}

function persist(key, payload) {
  Promise.resolve()
    .then(() => catalogStore.set(key, { ...payload, savedAt: Date.now() }))
    .catch(() => {});
}

async function resolveCatalog(conn, providerId) {
  const entry = { providerId, connId: conn?.id ?? "noauth" };
  const key = catalogKey(providerId, conn);
  const resolver = liveResolverFor(providerId, conn);

  if (resolver) {
    try {
      const live = await resolver(conn);
      if (live?.models?.length) {
        entry.models = live.models;
        persist(`live:${key}`, { models: live.models });
        return entry;
      }
    } catch (err) {
      console.log(`Live model fetch failed for ${providerId}: ${err?.message || err}`);
    }
  }

  if (needsCompatibleCatalog(providerId, conn)) {
    const ids = await fetchCompatibleModelIds(conn);
    if (ids.length > 0) {
      entry.ids = ids;
      persist(`compat:${key}`, { ids });
    }
  }

  return entry;
}

// Fill the in-memory cache from the kv table, so a restart serves the previous
// pass immediately instead of an empty list until the first refresh lands.
async function hydrate(connections) {
  const pending = [];
  for (const conn of connections) {
    const providerId = conn?.provider;
    if (!providerId) continue;
    const key = catalogKey(providerId, conn);
    if (catalogCache.has(key)) continue;
    if (!liveResolverFor(providerId, conn) && !needsCompatibleCatalog(providerId, conn)) continue;

    pending.push(
      Promise.all([readPersisted(`live:${key}`), readPersisted(`compat:${key}`)]).then(([live, compat]) => {
        if (catalogCache.has(key)) return;
        catalogCache.set(key, {
          providerId,
          connId: conn?.id ?? "noauth",
          models: live?.models?.length ? live.models : undefined,
          ids: compat?.ids?.length ? compat.ids : undefined,
        });
      }),
    );
  }
  if (pending.length > 0) await Promise.all(pending);
}

export function getConnectionCatalog(conn) {
  return catalogCache.get(catalogKey(conn?.provider, conn)) || null;
}

// Providers that ask for a live catalog and have nothing cached yet. The
// request path uses this to kick a refresh for exactly those.
export async function getLiveCatalogSnapshot(connections) {
  await hydrate(connections);
  const catalogs = new Map();
  const missing = [];

  for (const conn of connections) {
    const providerId = conn?.provider;
    if (!providerId) continue;
    if (!liveResolverFor(providerId, conn) && !needsCompatibleCatalog(providerId, conn)) continue;

    const entry = getConnectionCatalog(conn);
    if (entry?.models?.length) {
      catalogs.set(providerId, entry.models);
    } else if (entry?.ids?.length) {
      catalogs.set(providerId, entry.ids.map((id) => ({ id })));
    } else {
      missing.push(providerId);
    }
  }

  return { catalogs, missing, lastRefreshAt };
}

// One full pass over every active connection, all providers in parallel. No
// per-request deadline: nothing is waiting on it.
export async function refreshLiveCatalogs({ reason = "scheduled" } = {}) {
  let connections;
  try {
    connections = (await getProviderConnections()).filter((c) => c?.isActive !== false);
  } catch {
    return null;
  }

  const seen = new Set();
  const tasks = [];
  for (const conn of connections) {
    const providerId = conn?.provider;
    if (!providerId) continue;
    if (!liveResolverFor(providerId, conn) && !needsCompatibleCatalog(providerId, conn)) continue;
    seen.add(catalogKey(providerId, conn));
    tasks.push(
      resolveCatalog(conn, providerId).then((entry) => {
        catalogCache.set(catalogKey(providerId, conn), entry);
      }),
    );
  }

  for (const key of [...catalogCache.keys()]) {
    if (!seen.has(key)) catalogCache.delete(key);
  }

  if (tasks.length === 0) {
    lastRefreshAt = Date.now();
    return { providers: 0, resolved: 0 };
  }

  await Promise.all(tasks);
  lastRefreshAt = Date.now();
  const resolved = tasks.length - [...catalogCache.values()].filter((e) => !e.models?.length && !e.ids?.length).length;
  console.log(`[liveCatalog] ${reason}: ${resolved}/${tasks.length} provider catalogs resolved`);
  return { providers: tasks.length, resolved };
}

export function invalidateLiveCatalog(providerId) {
  for (const [key, entry] of catalogCache) {
    if (!providerId || entry.providerId === providerId) catalogCache.delete(key);
  }
}

// Called from the request path when a provider has nothing cached. Throttled so
// a provider that never answers cannot turn every request into a full pass.
export function requestLiveCatalogRefresh(missing) {
  if (!missing?.length) return;
  const now = Date.now();
  if (now - lastOnDemandAt < ON_DEMAND_THROTTLE_MS) return;
  lastOnDemandAt = now;
  refreshLiveCatalogs({ reason: `on-demand (${missing.join(",")})` }).catch(() => {});
}

// Schedule the recurring pass. Disable with LIVE_CATALOG_REFRESH=off.
export function startLiveCatalogRefresh() {
  if (timer) return;
  if (String(process.env.LIVE_CATALOG_REFRESH || "").toLowerCase() === "off") return;

  const schedule = (delay) => {
    timer = setTimeout(async () => {
      await refreshLiveCatalogs({ reason: "scheduled" }).catch(() => {});
      schedule(REFRESH_INTERVAL_MS);
    }, delay);
    timer.unref?.();
  };

  schedule(STARTUP_DELAY_MS);
}
