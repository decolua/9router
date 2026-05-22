import { getProviderCredentials } from "@/sse/services/auth.js";
import {
  checkAndRefreshToken,
  updateProviderCredentials,
} from "@/sse/services/tokenRefresh.js";

function accountFromConnection(connection) {
  if (!connection || connection.allRateLimited) return null;
  return {
    authType: connection.authType || (connection.apiKey ? "apikey" : "oauth"),
    apiKey: connection.apiKey,
    accessToken: connection.accessToken,
    refreshToken: connection.refreshToken,
    expiresAt: connection.expiresAt,
    connectionId: connection.connectionId,
    providerSpecificData: connection.providerSpecificData,
  };
}

function expiresInFromExpiresAt(expiresAt) {
  if (!expiresAt) return undefined;
  const expiresAtMs = new Date(expiresAt).getTime();
  if (!Number.isFinite(expiresAtMs)) return undefined;
  return Math.max(1, Math.floor((expiresAtMs - Date.now()) / 1000));
}

export async function resolveXaiAccount(request) {
  const preferred = request.headers.get("x-connection-id") || null;
  const connection = await getProviderCredentials("xai", null, null, {
    preferredConnectionId: preferred,
  });
  if (!connection || connection.allRateLimited) return null;

  const refreshed = await checkAndRefreshToken("xai", connection).catch(() => connection);
  return accountFromConnection(refreshed);
}

export async function persistXaiAccount(account) {
  if (!account?.connectionId) return;

  const updates = {};
  if (account.accessToken) updates.accessToken = account.accessToken;
  if (account.refreshToken) updates.refreshToken = account.refreshToken;
  if (account.providerSpecificData) updates.providerSpecificData = account.providerSpecificData;

  const expiresIn = account.expiresIn ?? expiresInFromExpiresAt(account.expiresAt);
  if (expiresIn) updates.expiresIn = expiresIn;

  if (Object.keys(updates).length === 0) return;
  await updateProviderCredentials(account.connectionId, updates);
}
