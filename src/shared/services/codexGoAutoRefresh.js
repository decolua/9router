import "open-sse/index.js";

import { getProviderConnections, updateProviderConnection } from "@/lib/localDb";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";
import { refreshAndUpdateCredentials } from "@/app/api/usage/[connectionId]/route.js";
import { buildCodexGoCredentialUpdate } from "@/lib/oauth/codexgoConnection";
import {
  canUseCodexGoRefresh,
  getCodexGoQuotaSnapshot,
  normalizeCodexGoRefreshConfig,
  recordCodexGoQuotaSnapshot,
  recordCodexGoRefresh,
  recordCodexGoRefreshError,
  shouldAutoRefreshCodexGoFromSnapshot,
} from "@/lib/oauth/services/codexGoRefreshPolicy";
import { refreshCodexGoSession } from "open-sse/services/codexGo.js";
import { getCodexUsage } from "open-sse/services/usage/codex.js";

const TICK_INTERVAL_MS = 60 * 1000;

const g = global.__codexGoAutoRefresh ??= { interval: null, running: false };

function buildProxyOptions(cfg = {}) {
  return {
    connectionProxyEnabled: cfg.connectionProxyEnabled === true,
    connectionProxyUrl: cfg.connectionProxyUrl || "",
    connectionNoProxy: cfg.connectionNoProxy || "",
    vercelRelayUrl: cfg.vercelRelayUrl || "",
    strictProxy: false,
  };
}

function isCodexGoAutoRefreshTarget(connection) {
  if (connection?.provider !== "codex") return false;
  if (connection?.isActive === false) return false;
  if (connection?.providerSpecificData?.authMethod !== "codexgo") return false;
  if (!connection?.refreshToken) return false;
  return normalizeCodexGoRefreshConfig(connection.providerSpecificData).autoEnabled === true;
}

async function updateQuotaSnapshot(connection, snapshot, nowIso) {
  const providerSpecificData = recordCodexGoQuotaSnapshot(
    connection.providerSpecificData,
    snapshot,
    nowIso,
  );
  await updateProviderConnection(connection.id, { providerSpecificData });
  return { ...connection, providerSpecificData };
}

function mergeCodexGoRefreshData(connection, syncedCredentials, snapshot, nowIso) {
  const providerSpecificData = {
    ...(connection.providerSpecificData || {}),
    ...(syncedCredentials.providerSpecificData || {}),
  };
  return recordCodexGoRefresh(providerSpecificData, "auto_threshold", nowIso, snapshot);
}

export async function refreshCodexGoConnectionForThreshold(connection, snapshot, proxyOptions, nowMs = Date.now()) {
  const nowIso = new Date(nowMs).toISOString();
  const capacity = canUseCodexGoRefresh(connection.providerSpecificData, nowMs);
  if (!capacity.ok) {
    await updateQuotaSnapshot(connection, snapshot, nowIso);
    return { refreshed: false, reason: "limit_exhausted", capacity };
  }

  try {
    const syncedCredentials = await refreshCodexGoSession(connection.refreshToken, console, {
      proxyOptions,
      nowMs,
    });
    const updates = buildCodexGoCredentialUpdate(connection, syncedCredentials);
    updates.providerSpecificData = mergeCodexGoRefreshData(connection, syncedCredentials, snapshot, nowIso);
    const updated = await updateProviderConnection(connection.id, updates);
    console.log(`[CodexGoAutoRefresh] ${connection.id}: refreshed (session/weekly threshold)`);
    return { refreshed: true, connection: updated || { ...connection, ...updates } };
  } catch (error) {
    const providerSpecificData = recordCodexGoRefreshError(
      connection.providerSpecificData,
      error,
      nowIso,
      snapshot,
    );
    await updateProviderConnection(connection.id, { providerSpecificData }).catch(() => null);
    console.warn(`[CodexGoAutoRefresh] ${connection.id}: refresh failed: ${error.message || error}`);
    return { refreshed: false, reason: "refresh_failed", error: error.message || String(error) };
  }
}

async function processConnection(connection, nowMs) {
  const proxyCfg = await resolveConnectionProxyConfig(connection.providerSpecificData || {});
  const proxyOptions = buildProxyOptions(proxyCfg);

  let usableConnection = connection;
  try {
    const result = await refreshAndUpdateCredentials(connection, false, proxyOptions);
    usableConnection = result.connection || connection;
  } catch (error) {
    const providerSpecificData = recordCodexGoRefreshError(
      connection.providerSpecificData,
      error,
      new Date(nowMs).toISOString(),
    );
    await updateProviderConnection(connection.id, { providerSpecificData }).catch(() => null);
    console.warn(`[CodexGoAutoRefresh] ${connection.id}: token sync failed: ${error.message || error}`);
    return { refreshed: false, reason: "token_sync_failed" };
  }

  const usage = await getCodexUsage(usableConnection.accessToken, proxyOptions);
  const snapshot = getCodexGoQuotaSnapshot(usage, new Date(nowMs).toISOString());
  const config = normalizeCodexGoRefreshConfig(usableConnection.providerSpecificData);

  if (!shouldAutoRefreshCodexGoFromSnapshot(snapshot, config.thresholdRemainingPercent)) {
    await updateQuotaSnapshot(usableConnection, snapshot, new Date(nowMs).toISOString());
    return { refreshed: false, reason: "quota_above_threshold" };
  }

  return refreshCodexGoConnectionForThreshold(usableConnection, snapshot, proxyOptions, nowMs);
}

export async function tickCodexGoAutoRefresh(options = {}) {
  if (g.running && !options.force) return;
  g.running = true;
  const nowMs = options.nowMs || Date.now();
  try {
    const connections = await getProviderConnections({ provider: "codex", isActive: true });
    const targets = connections.filter(isCodexGoAutoRefreshTarget);
    for (const connection of targets) {
      try {
        await processConnection(connection, nowMs);
      } catch (error) {
        console.warn(`[CodexGoAutoRefresh] ${connection.id}: ${error.message || error}`);
      }
    }
  } finally {
    g.running = false;
  }
}

export function startCodexGoAutoRefresh() {
  if (g.interval) return;
  g.interval = setInterval(() => { tickCodexGoAutoRefresh().catch(() => {}); }, TICK_INTERVAL_MS);
  if (g.interval.unref) g.interval.unref();
}
