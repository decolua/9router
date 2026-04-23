// Ensure proxyFetch is loaded to patch globalThis.fetch
import "open-sse/index.js";

import { getProviderConnectionById, updateProviderConnection } from "@/lib/localDb";
import { getUsageForProvider } from "open-sse/services/usage.js";
import { getExecutor } from "open-sse/executors/index.js";
import { runUsageRefreshJob } from "../../../../lib/usageRefreshQueue.js";
import {
  applyCanonicalUsageRefresh,
  applyLiveQuotaUpdate,
  getCodexLiveQuotaSignal,
  getConnectionAuthBlockedPatch,
  isConfirmedAuthBlockedError,
  isAuthExpiredMessage,
  syncUsageStatus,
} from "../../../../lib/usageStatus.js";

const usageRequestCache = new Map();

/**
 * Refresh credentials using executor and update database
 * @param {boolean} force - Skip needsRefresh check and always attempt refresh
 * @returns Promise<{ connection, refreshed: boolean }>
 */
async function refreshAndUpdateCredentials(connection, force = false) {
  const executor = getExecutor(connection.provider);

  // Build credentials object from connection
  const credentials = {
    accessToken: connection.accessToken,
    refreshToken: connection.refreshToken,
    expiresAt: connection.expiresAt || connection.tokenExpiresAt,
    providerSpecificData: connection.providerSpecificData,
    // For GitHub
    copilotToken: connection.providerSpecificData?.copilotToken,
    copilotTokenExpiresAt: connection.providerSpecificData?.copilotTokenExpiresAt,
  };

  // Check if refresh is needed (skip when force=true)
  const needsRefresh = force || executor.needsRefresh(credentials);

  if (!needsRefresh) {
    return { connection, refreshed: false };
  }

  // Use executor's refreshCredentials method
  const refreshResult = await executor.refreshCredentials(credentials, console);

  if (!refreshResult) {
    // Refresh failed but we still have an accessToken — try with existing token
    if (connection.accessToken) {
      return { connection, refreshed: false };
    }
    throw new Error("Failed to refresh credentials. Please re-authorize the connection.");
  }

  // Build update object
  const now = new Date().toISOString();
  const updateData = {
    updatedAt: now,
  };

  // Update accessToken if present
  if (refreshResult.accessToken) {
    updateData.accessToken = refreshResult.accessToken;
  }

  // Update refreshToken if present
  if (refreshResult.refreshToken) {
    updateData.refreshToken = refreshResult.refreshToken;
  }

  // Update token expiry
  if (refreshResult.expiresIn) {
    updateData.expiresAt = new Date(Date.now() + refreshResult.expiresIn * 1000).toISOString();
  } else if (refreshResult.expiresAt) {
    updateData.expiresAt = refreshResult.expiresAt;
  }

  // Handle provider-specific data (copilotToken for GitHub, etc.)
  if (refreshResult.copilotToken || refreshResult.copilotTokenExpiresAt) {
    updateData.providerSpecificData = {
      ...connection.providerSpecificData,
      copilotToken: refreshResult.copilotToken,
      copilotTokenExpiresAt: refreshResult.copilotTokenExpiresAt,
    };
  }

  // Update database
  await updateProviderConnection(connection.id, updateData);

  // Return updated connection
  const updatedConnection = {
    ...connection,
    ...updateData,
  };

  return {
    connection: updatedConnection,
    refreshed: true,
  };
}

async function getQueuedUsageResult(connectionId, handler) {
  const cached = usageRequestCache.get(connectionId);
  if (cached) {
    return cached.promise;
  }

  const promise = runUsageRefreshJob(connectionId, async () => handler());

  usageRequestCache.set(connectionId, { promise });

  promise.then(() => {
    const entry = usageRequestCache.get(connectionId);
    if (entry?.promise === promise) {
      usageRequestCache.delete(connectionId);
    }
  }, () => {
    const entry = usageRequestCache.get(connectionId);
    if (entry?.promise === promise) {
      usageRequestCache.delete(connectionId);
    }
  });

  return promise;
}

/**
 * GET /api/usage/[connectionId] - Get usage data for a specific connection
 */
export async function GET(request, { params }) {
  let connection;
  try {
    const { connectionId } = await params;

    return await getQueuedUsageResult(connectionId, async () => {


    // Get connection from database
    connection = await getProviderConnectionById(connectionId);
    if (!connection) {
      return Response.json({ error: "Connection not found" }, { status: 404 });
    }

    // Only OAuth connections have usage APIs
    if (connection.authType !== "oauth") {
      return Response.json({ message: "Usage not available for API key connections" });
    }

    // Refresh credentials if needed using executor
    try {
      const result = await refreshAndUpdateCredentials(connection);
      connection = result.connection;
    } catch (refreshError) {
      console.error("[Usage API] Credential refresh failed:", refreshError);
      const lastCheckedAt = new Date().toISOString();
      await syncUsageStatus(
        connection,
        getConnectionAuthBlockedPatch(refreshError.message, { lastCheckedAt }) || {
          routingStatus: "eligible",
          healthStatus: "degraded",
          quotaState: "ok",
          authState: "ok",
          reasonCode: "refresh_failed",
          reasonDetail: refreshError.message,
          lastCheckedAt,
        }
      );
      return Response.json({
        error: `Credential refresh failed: ${refreshError.message}`
      }, { status: 401 });
    }

    // Fetch usage from provider API
    let usage = await getUsageForProvider(connection);

    // If provider returned an auth-expired message instead of throwing,
    // force-refresh token and retry once
    if (isAuthExpiredMessage(usage) && connection.refreshToken) {
      try {
        const retryResult = await refreshAndUpdateCredentials(connection, true);
        connection = retryResult.connection;
        usage = await getUsageForProvider(connection);
      } catch (retryError) {
        console.warn(`[Usage] ${connection.provider}: force refresh failed: ${retryError.message}`);
        const lastCheckedAt = new Date().toISOString();
        await syncUsageStatus(
          connection,
          getConnectionAuthBlockedPatch(retryError.message, { lastCheckedAt }) || {
            routingStatus: "eligible",
            healthStatus: "degraded",
            quotaState: "ok",
            authState: "ok",
            reasonCode: "auth_expired",
            reasonDetail: retryError.message,
            lastCheckedAt,
          }
        );
        return Response.json({
          error: `Credential refresh failed: ${retryError.message}`,
        }, { status: 401 });
      }
    }

    await applyCanonicalUsageRefresh(connection, usage);

    return Response.json(usage);
    });
  } catch (error) {
    const status = Number.isInteger(error?.status) ? error.status : 500;
    const provider = connection?.provider ?? "unknown";
    console.warn(`[Usage] ${provider}: ${error.message}`);
    if (connection?.id) {
      const lastCheckedAt = new Date().toISOString();
      const quotaSignal = getCodexLiveQuotaSignal(connection, {
        statusCode: status,
        errorText: error?.message || error?.error,
        errorCode: error?.code || error?.errorCode,
      });

      if (quotaSignal) {
        await applyLiveQuotaUpdate(connection, quotaSignal, { observedAt: lastCheckedAt });
      } else {
        await syncUsageStatus(
          connection,
          getConnectionAuthBlockedPatch(error, { lastCheckedAt, statusCode: status }) || {
            routingStatus: "eligible",
            healthStatus: "degraded",
            quotaState: "ok",
            authState: "ok",
            reasonCode: isConfirmedAuthBlockedError(error, { statusCode: status }) ? "auth_invalid" : "usage_request_failed",
            reasonDetail: error.message,
            lastCheckedAt,
          }
        );
      }
    }
    return Response.json({ error: error.message }, { status });
  }
}
