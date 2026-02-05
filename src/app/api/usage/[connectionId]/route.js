import { getProviderConnectionById, updateProviderConnection } from "@/lib/localDb";
import { getUsageForProvider } from "open-sse/services/usage.js";
import { refreshTokenByProvider } from "open-sse/services/tokenRefresh.js";

/**
 * GET /api/usage/[connectionId] - Get usage data for a specific connection
 */
export async function GET(request, { params }) {
  try {
    const { connectionId } = await params;

    // Get connection from database
    let connection = await getProviderConnectionById(connectionId);
    if (!connection) {
      return Response.json({ error: "Connection not found" }, { status: 404 });
    }

    // Only OAuth connections have usage APIs
    if (connection.authType !== "oauth") {
      return Response.json({ message: "Usage not available for API key connections" });
    }

    // Check if token is expired and refresh if needed
    const now = Date.now();
    const expiresAt = connection.expiresAt ? new Date(connection.expiresAt).getTime() : 0;
    const bufferMs = 5 * 60 * 1000; // 5 minute buffer

    if (expiresAt < now + bufferMs && connection.refreshToken) {
      console.log(`[Usage API] Token expired for ${connection.provider}, refreshing...`);

      try {
        const newTokenData = await refreshTokenByProvider(
          connection.provider,
          {
            refreshToken: connection.refreshToken,
            providerSpecificData: connection.providerSpecificData
          },
          console
        );

        if (newTokenData && newTokenData.accessToken) {
          // Update connection with new token
          connection.accessToken = newTokenData.accessToken;
          connection.expiresAt = new Date(Date.now() + (newTokenData.expiresIn || 3600) * 1000).toISOString();

          if (newTokenData.refreshToken) {
            connection.refreshToken = newTokenData.refreshToken;
          }

          // Save updated connection to database
          await updateProviderConnection(connectionId, {
            accessToken: connection.accessToken,
            expiresAt: connection.expiresAt,
            refreshToken: connection.refreshToken,
          });

          console.log(`[Usage API] Token refreshed for ${connection.provider}`);
        }
      } catch (refreshError) {
        console.error(`[Usage API] Failed to refresh token:`, refreshError);
        return Response.json({
          message: `Token expired and refresh failed: ${refreshError.message}`
        });
      }
    }

    // Fetch usage from provider API
    const usage = await getUsageForProvider(connection);
    return Response.json(usage);
  } catch (error) {
    console.log("Error fetching usage:", error);
    return Response.json({ error: error.message }, { status: 500 });
  }
}
