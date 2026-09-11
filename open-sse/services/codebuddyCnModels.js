/**
 * CodeBuddy CN live model catalog fetcher.
 *
 * Calls GET https://copilot.tencent.com/console/enterprises/personal/models
 * using official CodeBuddy CLI headers. Filters models by `agents` (cli only)
 * and excludes `disabled: true` models.
 *
 * Supports token auto-refresh on 401/403 and connection-aware proxying.
 */

import crypto from "crypto";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { refreshCodebuddyToken } from "./tokenRefresh/providers.js";

const CODEBUDDY_CN_MODELS_URL = "https://copilot.tencent.com/console/enterprises/personal/models";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/** @type {Map<string, { expiresAt: number, models: Array<{ id: string, name: string, description?: string }> }>} */
const catalogCache = new Map();

/** @type {Map<string, Promise<{ models: Array<{ id: string, name: string, description?: string }>, error?: string }>>} */
const inflight = new Map();

export function clearCodebuddyCnModelCache() {
  catalogCache.clear();
  inflight.clear();
}

function getCacheKey(credentials) {
  const seed = [credentials?.accessToken, credentials?.apiKey, credentials?.refreshToken].filter(Boolean).join(":");
  return crypto.createHash("sha256").update(`cbcn-models:${seed}`).digest("hex");
}

export function parseCodebuddyCnModels(data) {
  if (!data || data.code !== 0 || !data.data) {
    return [];
  }

  const { agents = [], models = [] } = data.data;

  // Find cli agent
  const cliAgent = agents.find(
    (a) => (a?.name && a.name.toLowerCase() === "cli") || (a?.id && String(a.id).toLowerCase() === "cli")
  );

  let allowedModelIds = null;
  if (cliAgent && Array.isArray(cliAgent.models) && cliAgent.models.length > 0) {
    allowedModelIds = new Set(
      cliAgent.models.map((m) => (typeof m === "string" ? m : m?.id)).filter(Boolean)
    );
  }

  if (!Array.isArray(models)) {
    return [];
  }

  const result = [];
  const seenIds = new Set();

  for (const m of models) {
    if (!m || !m.id) continue;
    // Filter out disabled models
    if (m.disabled === true) continue;

    // If cli agent models list exists, only allow models in that list
    if (allowedModelIds && !allowedModelIds.has(m.id)) continue;

    if (seenIds.has(m.id)) continue;
    seenIds.add(m.id);

    result.push({
      id: m.id,
      name: m.name || m.id,
      ...(m.description ? { description: m.description } : {}),
    });
  }

  return result;
}

export async function resolveCodebuddyCnModels(credentials, options = {}) {
  const {
    forceRefresh = false,
    proxyOptions = null,
    log = null,
    onCredentialsRefreshed = null,
  } = options;

  let token = credentials?.accessToken || credentials?.apiKey;
  if (!token) {
    return { models: [], error: "No CodeBuddy CN token provided" };
  }

  const key = getCacheKey(credentials);
  if (!forceRefresh) {
    const cached = catalogCache.get(key);
    if (cached && Date.now() < cached.expiresAt) {
      return { models: cached.models };
    }
  }

  if (inflight.has(key)) {
    return inflight.get(key);
  }

  const fetchPromise = (async () => {
    const buildHeaders = (authToken) => ({
      Authorization: `Bearer ${authToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      Origin: "https://www.codebuddy.cn",
      Referer: "https://www.codebuddy.cn/",
      "User-Agent": "CLI/2.63.2 CodeBuddy/2.63.2",
      ...(credentials?.providerSpecificData?.uid ? { "X-User-Id": String(credentials.providerSpecificData.uid) } : {}),
      ...(credentials?.providerSpecificData?.enterpriseId
        ? {
            "X-Enterprise-Id": String(credentials.providerSpecificData.enterpriseId),
            "X-Tenant-Id": String(credentials.providerSpecificData.enterpriseId),
          }
        : {}),
      ...(credentials?.providerSpecificData?.domain
        ? { "X-Domain": String(credentials.providerSpecificData.domain) }
        : {}),
    });

    try {
      let res = await proxyAwareFetch(
        CODEBUDDY_CN_MODELS_URL,
        {
          method: "GET",
          headers: buildHeaders(token),
        },
        proxyOptions
      );

      // Handle 401 / 403: attempt token refresh if refreshToken is available
      if ((res.status === 401 || res.status === 403) && credentials?.refreshToken) {
        log?.info?.("CODEBUDDY_MODELS", "Token expired (401/403), attempting refresh");
        const refreshed = await refreshCodebuddyToken(credentials.refreshToken, log);
        if (refreshed?.accessToken) {
          token = refreshed.accessToken;
          credentials.accessToken = refreshed.accessToken;
          if (refreshed.refreshToken) credentials.refreshToken = refreshed.refreshToken;
          if (typeof onCredentialsRefreshed === "function") {
            await onCredentialsRefreshed(refreshed);
          }

          res = await proxyAwareFetch(
            CODEBUDDY_CN_MODELS_URL,
            {
              method: "GET",
              headers: buildHeaders(token),
            },
            proxyOptions
          );
        }
      }

      if (!res.ok) {
        const errorText = await res.text().catch(() => "");
        log?.warn?.("CODEBUDDY_MODELS", `Upstream fetch failed: ${res.status}`, { errorText });
        return { models: [], error: `HTTP ${res.status}: ${errorText}` };
      }

      const json = await res.json();
      const models = parseCodebuddyCnModels(json);

      if (models.length > 0) {
        catalogCache.set(key, {
          expiresAt: Date.now() + CACHE_TTL_MS,
          models,
        });
      }

      return { models };
    } catch (err) {
      log?.error?.("CODEBUDDY_MODELS", "Error fetching CodeBuddy models", { message: err.message });
      return { models: [], error: err.message };
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, fetchPromise);
  return fetchPromise;
}
