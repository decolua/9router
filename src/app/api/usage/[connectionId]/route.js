// Ensure proxyFetch is loaded to patch globalThis.fetch
import "open-sse/index.js";

import { getProviderConnectionById, updateProviderConnection } from "@/lib/localDb";
import { refreshAndUpdateCredentials } from "@/lib/providers/refreshCredentials.js";
import { getUsageForProvider } from "open-sse/services/usage.js";
import { getExecutor } from "open-sse/executors/index.js";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";
import { USAGE_APIKEY_PROVIDERS } from "@/shared/constants/providers";
import { getQuotaResetUntil, buildModelLockUpdate, getEarliestModelLockUntil } from "open-sse/services/accountFallback.js";

// Detect auth-expired messages returned by usage providers instead of throwing
const AUTH_EXPIRED_PATTERNS = ["expired", "authentication", "unauthorized", "401", "re-authorize"];
function isAuthExpiredMessage(usage) {
  if (!usage?.message) return false;
  const msg = usage.message.toLowerCase();
  return AUTH_EXPIRED_PATTERNS.some((p) => msg.includes(p));
}


/**
 * GET /api/usage/[connectionId] - Get usage data for a specific connection
 */
export async function GET(request, { params }) {
  let connection;
  try {
    const { connectionId } = await params;


    // Get connection from database
    connection = await getProviderConnectionById(connectionId);
    if (!connection) {
      return Response.json({ error: "Connection not found" }, { status: 404 });
    }

    // Allow OAuth connections, plus whitelisted apikey providers (glm/minimax/kiro/...)
    // Kiro's headless api-key flow persists authType "api_key" (underscore) while
    // generic apikey providers persist "apikey" — accept both spellings here.
    const isOAuth = connection.authType === "oauth";
    const isApikeyAuth =
      connection.authType === "apikey" || connection.authType === "api_key";
    const isApikeyEligible =
      isApikeyAuth && USAGE_APIKEY_PROVIDERS.includes(connection.provider);

    if (!isOAuth && !isApikeyEligible) {
      return Response.json({ message: "Usage not available for this connection" });
    }

    // Resolve connection proxy config; force strictProxy=false so quota/refresh fall back to direct on failure
    const proxyConfig = await resolveConnectionProxyConfig(connection.providerSpecificData);
    const proxyOptions = {
      connectionProxyEnabled: proxyConfig.connectionProxyEnabled === true,
      connectionProxyUrl: proxyConfig.connectionProxyUrl || "",
      connectionNoProxy: proxyConfig.connectionNoProxy || "",
      vercelRelayUrl: proxyConfig.vercelRelayUrl || "",
      strictProxy: false,
    };

    // Refresh credentials only for OAuth connections (apikey has no token refresh)
    if (isOAuth) {
      try {
        const result = await refreshAndUpdateCredentials(connection, false, proxyOptions);
        connection = result.connection;
      } catch (refreshError) {
        console.error("[Usage API] Credential refresh failed:", refreshError);
        return Response.json({
          error: `Credential refresh failed: ${refreshError.message}`
        }, { status: 401 });
      }
    }

    // Fetch usage from provider API
    let usage = await getUsageForProvider(connection, proxyOptions);

    // If provider returned an auth-expired message instead of throwing,
    // force-refresh token and retry once (OAuth only)
    if (isOAuth && isAuthExpiredMessage(usage) && connection.refreshToken) {
      try {
        const retryResult = await refreshAndUpdateCredentials(connection, true, proxyOptions);
        connection = retryResult.connection;
        usage = await getUsageForProvider(connection, proxyOptions);
      } catch (retryError) {
        console.warn(`[Usage] ${connection.provider}: force refresh failed: ${retryError.message}`);
      }
    }

    // Persist last-known quota onto the connection so the connection list can
    // ship it to the UI without waiting for a live refetch. Only overwrite
    // quotaInfos when we actually got buckets back — keeps the last good
    // snapshot when a provider transiently returns an auth/empty response.
    try {
      const quotaInfos = parseQuotaData(connection.provider, usage);
      const quotaUpdate = {
        quotaUpdatedAt: new Date().toISOString(),
        quotaPlan: usage?.plan ?? null,
        quotaMessage: usage?.message ?? null,
      };
      if (quotaInfos.length > 0) {
        quotaUpdate.quotaInfos = quotaInfos;
      }
      await updateProviderConnection(connection.id, quotaUpdate);
    } catch (persistError) {
      console.warn(`[Usage] ${connection.provider}: failed to persist quota: ${persistError.message}`);
    }

    // Apply account-level model lock when the account is fully depleted.
    try {
      const quotaInfos = parseQuotaData(connection.provider, usage);
      const connectionWithQuota = { ...connection, quotaInfos };
      const resetUntil = getQuotaResetUntil(connectionWithQuota);
      if (resetUntil) {
        const cooldownMs = new Date(resetUntil).getTime() - Date.now();
        await updateProviderConnection(connection.id, buildModelLockUpdate(null, cooldownMs));
      }
      const updatedConnection = await getProviderConnectionById(connection.id);
      return Response.json({
        ...usage,
        unavailableUntil: getEarliestModelLockUntil(updatedConnection) || null,
      });
    } catch (lockError) {
      console.warn(`[Usage] ${connection.provider}: failed to apply quota lock: ${lockError.message}`);
      return Response.json(usage);
    }
  } catch (error) {
    const provider = connection?.provider ?? "unknown";
    console.warn(`[Usage] ${provider}: ${error.message}`);
    return Response.json({ error: error.message }, { status: 500 });
  }
}
