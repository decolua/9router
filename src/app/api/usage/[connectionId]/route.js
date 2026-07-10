// Ensure proxyFetch is loaded to patch globalThis.fetch
import "open-sse/index.js";

import { getProviderConnectionById, updateProviderConnection } from "@/lib/localDb";
import { getUsageHistory } from "@/lib/db/repos/usageRepo.js";
import { getUsageForProvider } from "open-sse/services/usage.js";
import { getExecutor } from "open-sse/executors/index.js";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";
import { USAGE_APIKEY_PROVIDERS } from "@/shared/constants/providers";

// Detect auth-expired messages returned by usage providers instead of throwing
const AUTH_EXPIRED_PATTERNS = ["expired", "authentication", "unauthorized", "401", "re-authorize"];
function isAuthExpiredMessage(usage) {
  if (!usage?.message) return false;
  const msg = usage.message.toLowerCase();
  return AUTH_EXPIRED_PATTERNS.some((p) => msg.includes(p));
}

/**
 * Refresh credentials using executor and update database
 * @param {boolean} force - Skip needsRefresh check and always attempt refresh
 * @returns Promise<{ connection, refreshed: boolean }>
 */
export async function refreshAndUpdateCredentials(connection, force = false, proxyOptions = null) {
  const executor = getExecutor(connection.provider);

  // Build credentials object from connection
  const credentials = {
    accessToken: connection.accessToken,
    refreshToken: connection.refreshToken,
    idToken: connection.idToken,
    expiresAt: connection.expiresAt || connection.tokenExpiresAt,
    lastRefreshAt: connection.lastRefreshAt,
    connectionId: connection.id,
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

  // Use executor's refreshCredentials method (with optional proxy)
  const refreshResult = await executor.refreshCredentials(credentials, console, proxyOptions);

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

  if (refreshResult.idToken) {
    updateData.idToken = refreshResult.idToken;
  }

  if (refreshResult.lastRefreshAt) {
    updateData.lastRefreshAt = refreshResult.lastRefreshAt;
  }

  // Update token expiry
  if (refreshResult.expiresIn) {
    updateData.expiresAt = new Date(Date.now() + refreshResult.expiresIn * 1000).toISOString();
    updateData.expiresIn = refreshResult.expiresIn;
  } else if (refreshResult.expiresAt) {
    updateData.expiresAt = refreshResult.expiresAt;
  }

  // Handle provider-specific data (copilotToken for GitHub, etc.)
  const providerSpecificUpdates = {
    ...(refreshResult.providerSpecificData || {}),
    ...(refreshResult.copilotToken ? { copilotToken: refreshResult.copilotToken } : {}),
    ...(refreshResult.copilotTokenExpiresAt ? { copilotTokenExpiresAt: refreshResult.copilotTokenExpiresAt } : {}),
  };
  if (Object.keys(providerSpecificUpdates).length > 0) {
    updateData.providerSpecificData = {
      ...(connection.providerSpecificData || {}),
      ...providerSpecificUpdates,
    };
  }

  // Update database
  await updateProviderConnection(connection.id, updateData);

  // Return updated connection
  const updatedConnection = {
    ...connection,
    ...updateData,
    providerSpecificData: updateData.providerSpecificData || connection.providerSpecificData,
  };

  return {
    connection: updatedConnection,
    refreshed: true,
  };
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

    // xAI has no public quota API; aggregate from local usageHistory
    if (connection.provider === 'xai') {
      return Response.json(await aggregateXaiUsage(connection));
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

    return Response.json(usage);
  } catch (error) {
    const provider = connection?.provider ?? "unknown";
    console.warn(`[Usage] ${provider}: ${error.message}`);
    return Response.json({ error: error.message }, { status: 500 });
  }
}

/**
 * Aggregate xAI usage from local usageHistory.
 * xAI does not expose a public per-account quota endpoint (the
 * billing console at console.x.ai requires a session cookie, not an
 * API key), so we surface real spend and token usage from 9router's
 * own request log over the last 30 days, grouped per model.
 */
async function aggregateXaiUsage(connection) {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const rows = await getUsageHistory({ provider: 'xai', startDate: since });
  const filtered = rows.filter((r) => !connection.id || r.connectionId === connection.id);

  if (!filtered.length) {
    return {
      message: 'xAI connected. No requests recorded in the last 30 days.',
      quotas: {},
      displayMessage: 'xAI connected. No usage yet.',
    };
  }

  const totals = filtered.reduce(
    (acc, r) => {
      const t = r.tokens || {};
      acc.prompt += Number(t.prompt_tokens || t.promptTokens || 0);
      acc.completion += Number(t.completion_tokens || t.completionTokens || 0);
      acc.cost += Number(r.cost) || 0;
      acc.requests += 1;
      return acc;
    },
    { prompt: 0, completion: 0, cost: 0, requests: 0 }
  );

  const byModel = {};
  for (const r of filtered) {
    const t = r.tokens || {};
    const used = (Number(t.prompt_tokens || t.promptTokens || 0)) + (Number(t.completion_tokens || t.completionTokens || 0));
    if (!byModel[r.model]) byModel[r.model] = 0;
    byModel[r.model] += used;
  }

  // Cumulative aggregates have no cap, so the progress bar is meaningless.
  // Mark them as unlimited + remaining: 100 so the dashboard renders the
  // green "🟢 100%" badge and hides the bar instead of "🔴 0%".
  const unlimited = { remaining: 100, resetAt: null, unlimited: true };

  const quotas = {
    'Total spend (30d)': {
      used: Number(totals.cost.toFixed(4)),
      total: 0,
      unit: 'usd',
      ...unlimited,
    },
    'Total tokens (30d)': {
      used: totals.prompt + totals.completion,
      total: 0,
      ...unlimited,
    },
  };

  for (const [model, used] of Object.entries(byModel)) {
    quotas[model + ' (30d)'] = {
      used,
      total: 0,
      unit: 'tokens',
      ...unlimited,
    };
  }

  return {
    plan: 'xAI / Grok Build',
    displayMessage: 'xAI connected. ' + totals.requests + ' requests in the last 30 days.',
    quotas,
  };
}

