// Ensure proxyFetch is loaded to patch globalThis.fetch
import "open-sse/index.js";

import { getProviderConnectionById, updateProviderConnection } from "@/lib/localDb";
import { projectLegacyConnectionState, writeConnectionHotState } from "@/lib/providerHotState";
import { getUsageForProvider } from "open-sse/services/usage.js";
import { getExecutor } from "open-sse/executors/index.js";
import { runUsageRefreshJob } from "../../../../lib/usageRefreshQueue.js";

const usageRequestCache = new Map();

// Detect auth-expired messages returned by usage providers instead of throwing
const AUTH_EXPIRED_PATTERNS = ["expired", "authentication", "unauthorized", "401", "re-authorize"];
function isAuthExpiredMessage(usage) {
  if (!usage?.message) return false;
  const msg = usage.message.toLowerCase();
  return AUTH_EXPIRED_PATTERNS.some((p) => msg.includes(p));
}

async function syncUsageStatus(connection, updates = {}) {
  if (!connection?.id) return;

  const lastCheckedAt = updates.lastCheckedAt || updates.lastTested || new Date().toISOString();
  const hotPatch = {
    ...updates,
    lastCheckedAt,
    version: updates.version || Date.now(),
  };
  const snapshot = await writeConnectionHotState({
    connectionId: connection.id,
    provider: connection.provider,
    patch: hotPatch,
  });
  const legacy = projectLegacyConnectionState(snapshot || hotPatch);

  await updateProviderConnection(connection.id, {
    testStatus: legacy.testStatus,
    lastTested: legacy.lastTested || lastCheckedAt,
    lastError: legacy.lastError ?? null,
    lastErrorType: legacy.lastErrorType ?? null,
    lastErrorAt: legacy.lastErrorAt ?? null,
    rateLimitedUntil: legacy.rateLimitedUntil ?? null,
    errorCode: legacy.errorCode ?? null,
  });
}

function getUsageStatusUpdates(connection, usage) {
  const lastCheckedAt = new Date().toISOString();
  const serializedUsage = JSON.stringify(usage || {});
  const base = {
    routingStatus: "eligible",
    healthStatus: "healthy",
    quotaState: "ok",
    authState: "ok",
    reasonCode: "unknown",
    reasonDetail: null,
    lastError: null,
    lastErrorType: null,
    lastErrorAt: null,
    rateLimitedUntil: null,
    errorCode: null,
    lastCheckedAt,
    usageSnapshot: serializedUsage,
  };

  if (connection?.provider !== "codex") {
    return base;
  }

  const sessionQuota = usage?.quotas?.session;
  const weeklyQuota = usage?.quotas?.weekly;
  const isWeeklyOnly = !sessionQuota && !!weeklyQuota;

  if (!isWeeklyOnly) {
    return base;
  }

  if ((weeklyQuota.remaining ?? 0) <= 0) {
    return {
      ...base,
      routingStatus: "blocked_quota",
      healthStatus: "degraded",
      quotaState: "exhausted",
      lastError: "Codex weekly quota exhausted",
      lastErrorType: "quota_exhausted",
      lastErrorAt: new Date().toISOString(),
      rateLimitedUntil: weeklyQuota.resetAt || null,
      errorCode: "weekly_quota_exhausted",
      reasonCode: "quota_exhausted",
      reasonDetail: "Codex weekly quota exhausted",
      resetAt: weeklyQuota.resetAt || null,
      nextRetryAt: weeklyQuota.resetAt || null,
    };
  }

  return base;
}

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
      await syncUsageStatus(connection, {
        testStatus: "error",
        lastError: refreshError.message,
        lastErrorType: "refresh_failed",
      });
      return Response.json({
        error: `Credential refresh failed: ${refreshError.message}`
      }, { status: 401 });
    }

    // Fetch usage from provider API
    let usage = await getUsageForProvider(connection);
    let shouldMarkActive = true;

    // If provider returned an auth-expired message instead of throwing,
    // force-refresh token and retry once
    if (isAuthExpiredMessage(usage) && connection.refreshToken) {
      try {
        const retryResult = await refreshAndUpdateCredentials(connection, true);
        connection = retryResult.connection;
        usage = await getUsageForProvider(connection);
      } catch (retryError) {
        console.warn(`[Usage] ${connection.provider}: force refresh failed: ${retryError.message}`);
        await syncUsageStatus(connection, {
          testStatus: "error",
          lastError: retryError.message,
          lastErrorType: "auth_expired",
        });
        shouldMarkActive = false;
      }
    }

    if (shouldMarkActive) {
      await syncUsageStatus(connection, getUsageStatusUpdates(connection, usage));
    }

    return Response.json(usage);
    });
  } catch (error) {
    const status = Number.isInteger(error?.status) ? error.status : 500;
    const provider = connection?.provider ?? "unknown";
    console.warn(`[Usage] ${provider}: ${error.message}`);
    if (connection?.id) {
      await syncUsageStatus(connection, {
        testStatus: "error",
        lastError: error.message,
        lastErrorType: "usage_request_failed",
      });
    }
    return Response.json({ error: error.message }, { status });
  }
}
