import { getSettings, updateSettings } from "@/lib/localDb.js";
import {
  getProxyPoolsBySource,
  upsertProxyPoolBySource,
  updateProxyPool,
} from "@/lib/db/repos/proxyPoolsRepo.js";
import {
  listProxiesAll,
  WebshareAuthError,
  WebshareRateLimitError,
} from "./webshareClient.js";

global.__webshareSync ??= { inFlight: null };

function createManagedFields(proxy) {
  return {
    name: `Webshare · ${proxy.countryCode ?? "??"} · ${proxy.proxyAddress}`,
    proxyUrl: proxy.proxyUrl,
    noProxy: "",
    type: "http",
    isActive: true,
    strictProxy: false,
    webshareUsername: proxy.username,
    webshareCountryCode: proxy.countryCode,
    webshareCityName: proxy.cityName,
    webshareValid: proxy.valid,
    webshareLastImportedAt: new Date().toISOString(),
    webshareOrphanedAt: null,
  };
}

function getErrorMessage(error) {
  if (error instanceof WebshareAuthError || error instanceof WebshareRateLimitError) {
    return error.message;
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Unknown Webshare sync error";
}

async function executeWebshareSync({ trigger }) {
  const settings = await getSettings();
  const apiKey = settings.webshareApiKey?.trim();

  if (!apiKey) {
    throw new Error("No Webshare API key configured");
  }

  const remoteProxies = await listProxiesAll(apiKey);
  const localPools = await getProxyPoolsBySource("webshare");

  // Guard: empty list likely means API outage or lapsed subscription — refuse to mass-deactivate.
  if (remoteProxies.length === 0 && localPools.length > 0) {
    throw new Error("Refusing to deactivate all: Webshare returned empty list");
  }

  const stats = {
    created: 0,
    updated: 0,
    deactivated: 0,
    skipped: 0,
    total: remoteProxies.length,
    trigger,
  };

  const localByWebshareId = new Map(
    localPools
      .filter((pool) => pool.webshareId)
      .map((pool) => [String(pool.webshareId), pool])
  );
  const deletedWebshareIds = new Set(
    Array.isArray(settings.webshareDeletedProxyIds)
      ? settings.webshareDeletedProxyIds.map((id) => String(id))
      : []
  );
  const remoteIds = new Set();

  for (const proxy of remoteProxies) {
    if (!proxy?.webshareId) {
      stats.skipped += 1;
      continue;
    }

    const sourceId = String(proxy.webshareId);
    remoteIds.add(sourceId);

    if (deletedWebshareIds.has(sourceId)) {
      stats.skipped += 1;
      continue;
    }

    await upsertProxyPoolBySource({
      source: "webshare",
      sourceId,
      fields: createManagedFields(proxy),
    });

    if (localByWebshareId.has(sourceId)) {
      stats.updated += 1;
    } else {
      stats.created += 1;
    }
  }

  const orphanedAt = new Date().toISOString();

  for (const pool of localPools) {
    const webshareId = pool?.webshareId ? String(pool.webshareId) : null;
    if (!webshareId || remoteIds.has(webshareId)) {
      continue;
    }

    // Never delete — mark inactive only to preserve provider connection bindings
    await updateProxyPool(pool.id, {
      isActive: false,
      webshareValid: false,
      webshareOrphanedAt: orphanedAt,
    });
    stats.deactivated += 1;
  }

  await updateSettings({
    webshareLastSyncAt: new Date().toISOString(),
    webshareLastSyncStats: {
      created: stats.created,
      updated: stats.updated,
      deactivated: stats.deactivated,
      skipped: stats.skipped,
      total: stats.total,
    },
    webshareLastSyncError: null,
    webshareSyncIntervalMinutes: settings.webshareSyncIntervalMinutes,
  });

  return stats;
}

export function runWebshareSync({ trigger }) {
  if (global.__webshareSync.inFlight) {
    return global.__webshareSync.inFlight;
  }

  global.__webshareSync.inFlight = (async () => {
    try {
      return await executeWebshareSync({ trigger });
    } catch (error) {
      await updateSettings({
        webshareLastSyncError: getErrorMessage(error),
      });
      throw error;
    } finally {
      global.__webshareSync.inFlight = null;
    }
  })();

  return global.__webshareSync.inFlight;
}
