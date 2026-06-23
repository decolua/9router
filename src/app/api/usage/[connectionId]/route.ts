// Ensure proxyFetch is loaded to patch globalThis.fetch
import "open-sse/index.js";

import type { NextRequest } from "next/server";
import type { ProviderConnection } from "@/lib/db/repos/connectionsRepo";
import { getProviderConnectionById } from "@/lib/localDb";
import { refreshAndUpdateCredentials } from "@/lib/providers/refreshCredentials.js";
import { getUsageForProvider } from "open-sse/services/usage.js";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";
import { checkUsageEligibility } from "@/lib/usage/authCheck.js";
import { persistQuotaSnapshot, applyQuotaLockIfNeeded, getUnavailableUntil } from "@/lib/usage/quotaPersist.js";

// Detect auth-expired messages returned by usage providers instead of throwing
const AUTH_EXPIRED_PATTERNS = ["expired", "authentication", "unauthorized", "401", "re-authorize"];
function isAuthExpiredMessage(usage: { message?: string } | null | undefined) {
  if (!usage?.message) return false;
  const msg = usage.message.toLowerCase();
  return AUTH_EXPIRED_PATTERNS.some((p) => msg.includes(p));
}

/**
 * GET /api/usage/[connectionId] - Get usage data for a specific connection
 */
export async function GET(request: NextRequest, context: { params: Promise<{ connectionId: string }> }) {
  let connection;
  try {
    const { connectionId } = await context.params;
    connection = await getProviderConnectionById(connectionId);
    if (!connection) {
      return Response.json({ error: "Connection not found" }, { status: 404 });
    }

    const { isOAuth, isEligible } = checkUsageEligibility(connection);
    if (!isEligible) {
      return Response.json({ message: "Usage not available for this connection" });
    }

    const psd = connection["providerSpecificData"] as Record<string, string> | undefined;
    const proxyConfig = await resolveConnectionProxyConfig(psd);
    const proxyOptions = {
      connectionProxyEnabled: proxyConfig.connectionProxyEnabled === true,
      connectionProxyUrl: proxyConfig.connectionProxyUrl || "",
      connectionNoProxy: proxyConfig.connectionNoProxy || "",
      vercelRelayUrl: proxyConfig.vercelRelayUrl || "",
      strictProxy: false,
    };

    if (isOAuth) {
      try {
        const { connection: updated } = await refreshAndUpdateCredentials(connection, false, proxyOptions as never);
        connection = updated as ProviderConnection;
      } catch (e) {
        // Non-fatal — try with existing creds
      }
    }

    let usage = await getUsageForProvider(connection, proxyOptions as never);

    if (isOAuth && isAuthExpiredMessage(usage) && connection["refreshToken"]) {
      try {
        const { connection: updated } = await refreshAndUpdateCredentials(connection, true, proxyOptions as never);
        connection = updated as ProviderConnection;
        usage = await getUsageForProvider(connection, proxyOptions as never);
      } catch (e) {
        // Return the auth-expired usage as-is
      }
    }

    connection = await persistQuotaSnapshot(connection, usage);
    connection = await applyQuotaLockIfNeeded(connection, usage);

    return Response.json({ ...usage, unavailableUntil: getUnavailableUntil(connection) });
  } catch (error) {
    console.log("Error fetching usage:", error);
    const msg = error instanceof Error ? error.message : String(error);
    return Response.json({ error: msg }, { status: 500 });
  }
}
