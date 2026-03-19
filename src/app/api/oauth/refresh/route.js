import { getProviderConnectionById, updateProviderConnection } from "@/lib/localDb";
import { getExecutor } from "open-sse/executors/index.js";
import { isCloudEnabled } from "@/models";
import { getConsistentMachineId } from "@/shared/utils/machineId";

async function syncToCloudIfEnabled() {
  try {
    const cloudEnabled = await isCloudEnabled();
    if (!cloudEnabled) return;
    const machineId = await getConsistentMachineId();
    await fetch(`${process.env.INTERNAL_BASE_URL || "http://localhost:20130"}/api/sync/cloud`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ machineId, action: "sync" }),
    });
  } catch (error) {
    console.error("[OAuth Refresh API] Error syncing to cloud:", error);
  }
}

/**
 * Refresh credentials using executor and update database
 * @returns {{ connection, refreshed: boolean }}
 */
async function refreshAndUpdateCredentials(connection) {
  const executor = getExecutor(connection.provider);

  // Build credentials object from connection
  const credentials = {
    accessToken: connection.accessToken,
    refreshToken: connection.refreshToken,
    expiresAt: connection.tokenExpiresAt,
    providerSpecificData: connection.providerSpecificData,
    // For GitHub
    copilotToken: connection.providerSpecificData?.copilotToken,
    copilotTokenExpiresAt: connection.providerSpecificData?.copilotTokenExpiresAt,
  };

  // Use executor's refreshCredentials method (force refresh)
  const refreshResult = await executor.refreshCredentials(credentials, console);

  if (!refreshResult) {
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
    updateData.tokenExpiresAt = new Date(Date.now() + refreshResult.expiresIn * 1000).toISOString();
  } else if (refreshResult.expiresAt) {
    updateData.tokenExpiresAt = refreshResult.expiresAt;
  }

  // Handle provider-specific data
  // Always preserve existing providerSpecificData and merge with new data
  updateData.providerSpecificData = {
    ...connection.providerSpecificData,
    // GitHub: copilotToken
    ...(refreshResult.copilotToken && { copilotToken: refreshResult.copilotToken }),
    ...(refreshResult.copilotTokenExpiresAt && { copilotTokenExpiresAt: refreshResult.copilotTokenExpiresAt }),
    // Kiro: profileArn (preserve existing if not in refresh result)
    ...(refreshResult.profileArn && { profileArn: refreshResult.profileArn }),
  };

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

/**
 * POST /api/oauth/refresh - Manually refresh OAuth token for a connection
 */
export async function POST(request) {
  try {
    const body = await request.json();
    const { connectionId } = body;

    if (!connectionId) {
      return Response.json({ error: "connectionId is required" }, { status: 400 });
    }

    // Get connection from database
    const connection = await getProviderConnectionById(connectionId);
    if (!connection) {
      return Response.json({ error: "Connection not found" }, { status: 404 });
    }

    // Only OAuth connections can be refreshed
    if (connection.authType !== "oauth") {
      return Response.json({ error: "Only OAuth connections can be refreshed" }, { status: 400 });
    }

    // Refresh credentials
    try {
      const result = await refreshAndUpdateCredentials(connection);

      // Sync to cloud if enabled
      await syncToCloudIfEnabled();

      return Response.json({
        success: true,
        message: "Token refreshed successfully",
        expiresAt: result.connection.tokenExpiresAt,
      });
    } catch (refreshError) {
      console.error("[OAuth Refresh API] Credential refresh failed:", refreshError);
      return Response.json({
        error: `Credential refresh failed: ${refreshError.message}`
      }, { status: 401 });
    }
  } catch (error) {
    console.error("[OAuth Refresh API] Error:", error);
    return Response.json({ error: error.message }, { status: 500 });
  }
}
