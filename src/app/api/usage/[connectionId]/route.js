// Ensure proxyFetch is loaded to patch globalThis.fetch
import "open-sse/index.js";

import { getProviderConnectionById } from "@/lib/localDb";
import { refreshAndUpdateCredentials } from "@/lib/providers/refreshCredentials.js";
import { getUsageForProvider } from "open-sse/services/usage.js";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";
import { checkUsageEligibility } from "@/lib/usage/authCheck.js";
import { persistQuotaSnapshot, applyQuotaLockIfNeeded, getUnavailableUntil } from "@/lib/usage/quotaPersist.js";

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
    connection = await getProviderConnectionById(connectionId);
    if (!connection) {
      return Response.json({ error: "Connection not found" }, { status: 404 });
    }

    const { isOAuth, isEligible } = checkUsageEligibility(connection);
    if (!isEligible) {
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
        const { connection: updated } = await refreshAndUpdateCredentials(connection, false, proxyOptions);
        connection = updated;
      } catch (e) {
        // Non-fatal — try with existing creds
      }
    }

    // Fetch usage from provider API
    let usage = await getUsageForProvider(connection, proxyOptions);

    // If provider returned an auth-expired message instead of throwing,
    // force-refresh token and retry once (OAuth only)
    if (isOAuth && isAuthExpiredMessage(usage) && connection.refreshToken) {
      try {
        const { connection: updated } = await refreshAndUpdateCredentials(connection, true, proxyOptions);
        connection = updated;
        usage = await getUsageForProvider(connection, proxyOptions);
      } catch (e) {
        // Return the auth-expired usage as-is
      }
    }

    // Persist quota snapshot
    connection = await persistQuotaSnapshot(connection, usage?.quotas);

    // Apply account-level lock if depleted
    connection = await applyQuotaLockIfNeeded(connection);

    return Response.json({ ...usage, unavailableUntil: getUnavailableUntil(connection) });
  } catch (error) {
    console.log("Error fetching usage:", error);
    return Response.json({ error: error.message }, { status: 500 });
  }
}
