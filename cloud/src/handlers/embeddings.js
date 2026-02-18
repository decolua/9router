import { getModelInfoCore } from "open-sse/services/model.js";
import { handleEmbeddingsCore } from "open-sse/handlers/embeddingsCore.js";
import { errorResponse } from "open-sse/utils/error.js";
import {
  checkFallbackError,
  isAccountUnavailable,
  getEarliestRateLimitedUntil,
  getUnavailableUntil,
  formatRetryAfter
} from "open-sse/services/accountFallback.js";
import { HTTP_STATUS } from "open-sse/config/constants.js";
import * as log from "../utils/logger.js";
import { parseApiKey, extractBearerToken } from "../utils/apiKey.js";
import { getMachineData, saveMachineData } from "../services/storage.js";

/**
 * Handle POST /v1/embeddings and /{machineId}/v1/embeddings requests.
 *
 * Follows the same auth + fallback pattern as handleChat:
 *  1. Resolve machineId (from URL or API key)
 *  2. Validate API key
 *  3. Parse model → provider/model
 *  4. Get provider credentials with fallback loop
 *  5. Delegate to handleEmbeddingsCore (open-sse)
 *
 * @param {Request} request
 * @param {object} env - Cloudflare env bindings
 * @param {object} ctx - Execution context
 * @param {string|null} machineIdOverride - From URL path (old format), or null (new format)
 */
export async function handleEmbeddings(request, env, ctx, machineIdOverride = null) {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "*"
      }
    });
  }

  // Resolve machineId
  let machineId = machineIdOverride;

  if (!machineId) {
    const apiKey = extractBearerToken(request);
    if (!apiKey) return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Missing API key");

    const parsed = await parseApiKey(apiKey);
    if (!parsed) return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Invalid API key format");

    if (!parsed.isNewFormat || !parsed.machineId) {
      return errorResponse(
        HTTP_STATUS.BAD_REQUEST,
        "API key does not contain machineId. Use /{machineId}/v1/... endpoint for old format keys."
      );
    }
    machineId = parsed.machineId;
  }

  // Validate API key
  if (!await validateApiKey(request, machineId, env)) {
    return errorResponse(HTTP_STATUS.UNAUTHORIZED, "Invalid API key");
  }

  // Parse body
  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid JSON body");
  }

  const modelStr = body.model;
  if (!modelStr) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing model");

  if (!body.input) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing required field: input");

  log.info("EMBEDDINGS", `${machineId} | ${modelStr}`);

  // Resolve model info
  const data = await getMachineData(machineId, env);
  const modelInfo = await getModelInfoCore(modelStr, data?.modelAliases || {});
  if (!modelInfo.provider) return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid model format");

  const { provider, model } = modelInfo;
  log.info("EMBEDDINGS_MODEL", `${provider.toUpperCase()} | ${model}`);

  // Provider credential + fallback loop (mirrors handleChat)
  let excludeConnectionId = null;
  let lastError = null;
  let lastStatus = null;

  while (true) {
    const credentials = await getProviderCredentials(machineId, provider, env, excludeConnectionId);

    if (!credentials || credentials.allRateLimited) {
      if (credentials?.allRateLimited) {
        const retryAfterSec = Math.ceil(
          (new Date(credentials.retryAfter).getTime() - Date.now()) / 1000
        );
        const errorMsg = lastError || credentials.lastError || "Unavailable";
        const msg = `[${provider}/${model}] ${errorMsg} (${credentials.retryAfterHuman})`;
        const status = lastStatus || Number(credentials.lastErrorCode) || HTTP_STATUS.SERVICE_UNAVAILABLE;
        log.warn("EMBEDDINGS", `${provider.toUpperCase()} | ${msg}`);
        return new Response(
          JSON.stringify({ error: { message: msg } }),
          {
            status,
            headers: {
              "Content-Type": "application/json",
              "Retry-After": String(Math.max(retryAfterSec, 1))
            }
          }
        );
      }
      if (!excludeConnectionId) {
        return errorResponse(HTTP_STATUS.BAD_REQUEST, `No credentials for provider: ${provider}`);
      }
      log.warn("EMBEDDINGS", `${provider.toUpperCase()} | no more accounts`);
      return new Response(
        JSON.stringify({ error: lastError || "All accounts unavailable" }),
        {
          status: lastStatus || HTTP_STATUS.SERVICE_UNAVAILABLE,
          headers: { "Content-Type": "application/json" }
        }
      );
    }

    log.debug("EMBEDDINGS", `account=${credentials.id}`, { provider });

    const result = await handleEmbeddingsCore({
      body,
      modelInfo: { provider, model },
      credentials,
      log,
      onCredentialsRefreshed: async (newCreds) => {
        await updateCredentials(machineId, credentials.id, newCreds, env);
      },
      onRequestSuccess: async () => {
        await clearAccountError(machineId, credentials.id, credentials, env);
      }
    });

    if (result.success) return result.response;

    const { shouldFallback } = checkFallbackError(result.status, result.error);

    if (shouldFallback) {
      log.warn("EMBEDDINGS_FALLBACK", `${provider.toUpperCase()} | ${credentials.id} | ${result.status}`);
      await markAccountUnavailable(machineId, credentials.id, result.status, result.error, env);
      excludeConnectionId = credentials.id;
      lastError = result.error;
      lastStatus = result.status;
      continue;
    }

    return result.response;
  }
}

// ─── Helpers (same as chat.js) ───────────────────────────────────────────────

async function validateApiKey(request, machineId, env) {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return false;

  const apiKey = authHeader.slice(7);
  const data = await getMachineData(machineId, env);
  return data?.apiKeys?.some(k => k.key === apiKey) || false;
}

async function getProviderCredentials(machineId, provider, env, excludeConnectionId = null) {
  const data = await getMachineData(machineId, env);
  if (!data?.providers) return null;

  const providerConnections = Object.entries(data.providers)
    .filter(([connId, conn]) => {
      if (conn.provider !== provider || !conn.isActive) return false;
      if (excludeConnectionId && connId === excludeConnectionId) return false;
      if (isAccountUnavailable(conn.rateLimitedUntil)) return false;
      return true;
    })
    .sort((a, b) => (a[1].priority || 999) - (b[1].priority || 999));

  if (providerConnections.length === 0) {
    const allConnections = Object.entries(data.providers)
      .filter(([, conn]) => conn.provider === provider && conn.isActive)
      .map(([, conn]) => conn);
    const earliest = getEarliestRateLimitedUntil(allConnections);
    if (earliest) {
      const rateLimitedConns = allConnections.filter(
        c => c.rateLimitedUntil && new Date(c.rateLimitedUntil).getTime() > Date.now()
      );
      const earliestConn = rateLimitedConns.sort(
        (a, b) => new Date(a.rateLimitedUntil) - new Date(b.rateLimitedUntil)
      )[0];
      return {
        allRateLimited: true,
        retryAfter: earliest,
        retryAfterHuman: formatRetryAfter(earliest),
        lastError: earliestConn?.lastError || null,
        lastErrorCode: earliestConn?.errorCode || null
      };
    }
    return null;
  }

  const [connectionId, connection] = providerConnections[0];
  return {
    id: connectionId,
    apiKey: connection.apiKey,
    accessToken: connection.accessToken,
    refreshToken: connection.refreshToken,
    expiresAt: connection.expiresAt,
    projectId: connection.projectId,
    providerSpecificData: connection.providerSpecificData,
    status: connection.status,
    lastError: connection.lastError,
    rateLimitedUntil: connection.rateLimitedUntil
  };
}

async function markAccountUnavailable(machineId, connectionId, status, errorText, env) {
  const data = await getMachineData(machineId, env);
  if (!data?.providers?.[connectionId]) return;

  const conn = data.providers[connectionId];
  const backoffLevel = conn.backoffLevel || 0;
  const { cooldownMs, newBackoffLevel } = checkFallbackError(status, errorText, backoffLevel);
  const rateLimitedUntil = getUnavailableUntil(cooldownMs);
  const reason = typeof errorText === "string" ? errorText.slice(0, 100) : "Provider error";

  data.providers[connectionId].rateLimitedUntil = rateLimitedUntil;
  data.providers[connectionId].status = "unavailable";
  data.providers[connectionId].lastError = reason;
  data.providers[connectionId].errorCode = status || null;
  data.providers[connectionId].lastErrorAt = new Date().toISOString();
  data.providers[connectionId].backoffLevel = newBackoffLevel ?? backoffLevel;
  data.providers[connectionId].updatedAt = new Date().toISOString();

  await saveMachineData(machineId, data, env);
  log.warn("EMBEDDINGS_ACCOUNT", `${connectionId} | unavailable until ${rateLimitedUntil}`);
}

async function clearAccountError(machineId, connectionId, currentCredentials, env) {
  const hasError =
    currentCredentials.status === "unavailable" ||
    currentCredentials.lastError ||
    currentCredentials.rateLimitedUntil;

  if (!hasError) return;

  const data = await getMachineData(machineId, env);
  if (!data?.providers?.[connectionId]) return;

  data.providers[connectionId].status = "active";
  data.providers[connectionId].lastError = null;
  data.providers[connectionId].lastErrorAt = null;
  data.providers[connectionId].rateLimitedUntil = null;
  data.providers[connectionId].backoffLevel = 0;
  data.providers[connectionId].updatedAt = new Date().toISOString();

  await saveMachineData(machineId, data, env);
  log.info("EMBEDDINGS_ACCOUNT", `${connectionId} | error cleared`);
}

async function updateCredentials(machineId, connectionId, newCredentials, env) {
  const data = await getMachineData(machineId, env);
  if (!data?.providers?.[connectionId]) return;

  data.providers[connectionId].accessToken = newCredentials.accessToken;
  if (newCredentials.refreshToken)
    data.providers[connectionId].refreshToken = newCredentials.refreshToken;
  if (newCredentials.expiresIn) {
    data.providers[connectionId].expiresAt = new Date(
      Date.now() + newCredentials.expiresIn * 1000
    ).toISOString();
    data.providers[connectionId].expiresIn = newCredentials.expiresIn;
  }
  data.providers[connectionId].updatedAt = new Date().toISOString();

  await saveMachineData(machineId, data, env);
  log.debug("EMBEDDINGS_TOKEN", `credentials updated | ${connectionId}`);
}
