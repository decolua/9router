import { getProviderConnectionById, updateProviderConnection } from "@/lib/localDb";
import { buildCodexGoCredentialUpdate } from "@/lib/oauth/codexgoConnection";
import {
  normalizeCodexGoRefreshConfig,
  recordCodexGoRefresh,
  recordCodexGoRefreshError,
} from "@/lib/oauth/services/codexGoRefreshPolicy";
import { refreshCodexGoSession } from "open-sse/services/codexGo.js";

function isCodexGoConnection(connection) {
  return connection?.provider === "codex" && connection?.providerSpecificData?.authMethod === "codexgo";
}

function mergeUpdatedConnection(connection, updates, updated) {
  return {
    ...connection,
    ...(updates || {}),
    ...(updated || {}),
    providerSpecificData: {
      ...(connection?.providerSpecificData || {}),
      ...(updates?.providerSpecificData || {}),
      ...(updated?.providerSpecificData || {}),
    },
  };
}

export function buildCodexGoProxyOptions(providerSpecificData = {}) {
  return {
    connectionProxyEnabled: providerSpecificData.connectionProxyEnabled === true,
    connectionProxyUrl: providerSpecificData.connectionProxyUrl || "",
    connectionNoProxy: providerSpecificData.connectionNoProxy || "",
    vercelRelayUrl: providerSpecificData.vercelRelayUrl || "",
    strictProxy: false,
  };
}

export async function tryRefreshCodexGoFor429({
  provider,
  connectionId,
  status,
  error = null,
  proxyOptions = null,
  nowMs = Date.now(),
  log = console,
} = {}) {
  if (provider !== "codex" || Number(status) !== 429 || !connectionId) {
    return { refreshed: false, reason: "not_applicable" };
  }

  const connection = await getProviderConnectionById(connectionId);
  if (!isCodexGoConnection(connection)) {
    return { refreshed: false, reason: "not_codexgo" };
  }

  const config = normalizeCodexGoRefreshConfig(connection.providerSpecificData);
  if (!config.autoEnabled) {
    return { refreshed: false, reason: "auto_disabled" };
  }
  if (!connection.refreshToken) {
    return { refreshed: false, reason: "missing_refresh_token" };
  }

  const atIso = new Date(nowMs).toISOString();
  try {
    const syncedCredentials = await refreshCodexGoSession(connection.refreshToken, console, {
      proxyOptions: proxyOptions || null,
      nowMs,
    });
    const updates = buildCodexGoCredentialUpdate(connection, syncedCredentials);
    updates.providerSpecificData = recordCodexGoRefresh(
      updates.providerSpecificData,
      "upstream_429",
      atIso,
    );
    const updated = await updateProviderConnection(connection.id, updates);
    const updatedConnection = mergeUpdatedConnection(connection, updates, updated);

    log?.warn?.("CODEXGO", `Auto-refreshed CodexGo session after upstream 429 for ${connection.id}`);
    return {
      refreshed: true,
      reason: "upstream_429",
      connection: updatedConnection,
      credentials: {
        accessToken: updatedConnection.accessToken,
        refreshToken: updatedConnection.refreshToken,
        idToken: updatedConnection.idToken,
        expiresAt: updatedConnection.expiresAt,
        expiresIn: updatedConnection.expiresIn,
        lastRefreshAt: updatedConnection.lastRefreshAt,
        providerSpecificData: updatedConnection.providerSpecificData,
      },
    };
  } catch (refreshError) {
    const providerSpecificData = recordCodexGoRefreshError(
      connection.providerSpecificData,
      refreshError,
      atIso,
    );
    await updateProviderConnection(connection.id, { providerSpecificData }).catch(() => null);
    log?.warn?.("CODEXGO", `Auto-refresh after upstream 429 failed for ${connection.id}: ${refreshError.message || refreshError}`);
    return {
      refreshed: false,
      reason: "refresh_failed",
      error: refreshError.message || String(refreshError),
    };
  }
}
