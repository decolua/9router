import { updateProviderConnection } from "@/lib/localDb";
import { getExecutor } from "open-sse/executors/index.js";

/**
 * Refresh credentials using executor and update database.
 * Shared between the usage API route and the background quota monitor.
 *
 * @param {Object} connection - Provider connection object from DB
 * @param {boolean} force - Skip needsRefresh check and always attempt refresh
 * @returns {Promise<{ connection: Object, refreshed: boolean }>}
 */
export async function refreshAndUpdateCredentials(connection, force = false) {
  const executor = getExecutor(connection.provider);

  const credentials = {
    accessToken: connection.accessToken,
    refreshToken: connection.refreshToken,
    expiresAt: connection.expiresAt || connection.tokenExpiresAt,
    providerSpecificData: connection.providerSpecificData,
    copilotToken: connection.providerSpecificData?.copilotToken,
    copilotTokenExpiresAt: connection.providerSpecificData?.copilotTokenExpiresAt,
  };

  const needsRefresh = force || executor.needsRefresh(credentials);

  if (!needsRefresh) {
    return { connection, refreshed: false };
  }

  const refreshResult = await executor.refreshCredentials(credentials, console);

  if (!refreshResult) {
    if (connection.accessToken) {
      return { connection, refreshed: false };
    }
    throw new Error("Failed to refresh credentials. Please re-authorize the connection.");
  }

  const now = new Date().toISOString();
  const updateData = { updatedAt: now };

  if (refreshResult.accessToken) {
    updateData.accessToken = refreshResult.accessToken;
  }

  if (refreshResult.refreshToken) {
    updateData.refreshToken = refreshResult.refreshToken;
  }

  if (refreshResult.expiresIn) {
    updateData.expiresAt = new Date(Date.now() + refreshResult.expiresIn * 1000).toISOString();
  } else if (refreshResult.expiresAt) {
    updateData.expiresAt = refreshResult.expiresAt;
  }

  if (refreshResult.copilotToken || refreshResult.copilotTokenExpiresAt) {
    updateData.providerSpecificData = {
      ...connection.providerSpecificData,
      copilotToken: refreshResult.copilotToken,
      copilotTokenExpiresAt: refreshResult.copilotTokenExpiresAt,
    };
  }

  await updateProviderConnection(connection.id, updateData);

  const updatedConnection = { ...connection, ...updateData };

  return { connection: updatedConnection, refreshed: true };
}
