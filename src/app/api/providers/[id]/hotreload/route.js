// Ensure proxyFetch is loaded to patch globalThis.fetch
import "open-sse/index.js";

import { getProviderConnectionById } from "@/lib/db/index.js";
import { getExecutor } from "open-sse/executors/index.js";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";
import { refreshAndUpdateCredentials } from "@/app/api/usage/[connectionId]/route";
import { getUsageForProvider } from "open-sse/services/usage.js";
import { proxyAwareFetch } from "open-sse/utils/proxyFetch.js";
import { getHotReloadConfig } from "@/shared/constants/config";

const HOTRELOAD_TIMEOUT_MS = 10000;
const HOTRELOAD_RETRIES = 3; // connect failures retry up to 3x with backoff
const RETRY_BACKOFF_MS = 1200;
const USAGE_SETTLE_MS = 2500; // quota count moves after the poke lands
const USAGE_VERIFY_ATTEMPTS = 3; // quota updates are delayed; retry the probe before declaring failure
const USAGE_VERIFY_INTERVAL_MS = 4000;

/**
 * Poke one model. A poke's goal is that the request REACHES the upstream and
 * consumes a token — not a clean 2xx. Google's transport commonly answers 5xx
 * or drops the stream AFTER processing ("operation was aborted due to timeout"
 * then it works). Any server response (2xx/429/5xx) and any in-flight abort
 * count as landed; only connect failures retry, auth failures never retry.
 */
async function pokeModel(executor, model, connection, proxyOptions) {
  const request = {
    contents: [{ role: "user", parts: [{ text: "hi" }] }],
    generationConfig: { maxOutputTokens: 1, temperature: 0 },
  };
  // Method calls, not destructured — transformRequest writes this._lastSessionId.
  const transformed = executor.transformRequest(model, { request }, true, {
    accessToken: connection.accessToken,
    projectId: connection.projectId,
    email: connection.email || connection.name,
    connectionId: connection.id,
  });
  const url = executor.buildUrl(model, true);
  const headers = executor.buildHeaders({ accessToken: connection.accessToken });
  const body = JSON.stringify({ ...transformed, model, userAgent: "antigravity", requestType: "agent", request });

  let attempt = 0;
  while (attempt <= HOTRELOAD_RETRIES) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HOTRELOAD_TIMEOUT_MS);
    let res = null;
    let error = null;
    try {
      res = await proxyAwareFetch(url, { method: "POST", headers, body, signal: controller.signal }, proxyOptions);
    } catch (e) {
      error = e;
    } finally {
      clearTimeout(timer);
    }

    if (res) {
      await res.body?.cancel?.().catch?.(() => {});
      return res.status !== 401 && res.status !== 403;
    }
    const msg = `${error?.message || ""} ${error?.cause?.message || ""}`.toLowerCase();
    if (error?.name === "AbortError" || msg.includes("aborted") || msg.includes("timeout")) return true;
    if (attempt >= HOTRELOAD_RETRIES) return false;
    attempt += 1;
    await new Promise((resolve) => setTimeout(resolve, RETRY_BACKOFF_MS));
  }
  return false;
}

/**
 * Verify the count actually moved: when a poke succeeds it consumes a token,
 * so every poke target's remaining count must move off 0. Quota updates lag
 * (the "in 7d 0h 0m" text takes ~1 min to tick to 6d 59m), so probe /api
 * usage a few times before declaring failure. Returns { moved, remainingByModel }.
 */
async function verifyQuotaMoved(connection, proxyOptions, models) {
  const remainingByModel = {};
  let moved = false;
  for (let attempt = 0; attempt < USAGE_VERIFY_ATTEMPTS; attempt += 1) {
    try {
      const usage = await getUsageForProvider(connection, proxyOptions);
      const quotas = usage?.quotas || {};
      moved = true;
      for (const model of models) {
        const quota = quotas[model];
        remainingByModel[model] = quota
          ? Number(quota.remaining ?? (quota.total - quota.used ?? 0))
          : null;
        const zero = !quota || (!quota.unlimited && (quota.remaining != null ? Number(quota.remaining) <= 0 : Number(quota.used || 0) <= 0));
        if (zero) moved = false;
      }
      if (moved) return { moved: true, remainingByModel };
    } catch {
      // upstream usage probe may be flaky too — retry
    }
    if (attempt < USAGE_VERIFY_ATTEMPTS - 1) {
      await new Promise((resolve) => setTimeout(resolve, USAGE_VERIFY_INTERVAL_MS));
    }
  }
  return { moved, remainingByModel };
}

/**
 * POST /api/providers/[id]/hotreload
 * Poke one connection with a tiny upstream request so the provider rolls its
 * quota window forward immediately. Target models driven by HOT_RELOAD_CONFIG.
 */
export async function POST(_request, { params }) {
  const { id } = await params;
  const connection = await getProviderConnectionById(id);
  if (!connection) {
    return Response.json({ ok: false, error: "Connection not found", connectionId: id }, { status: 404 });
  }

  const cfg = getHotReloadConfig(connection.provider, connection.authType);
  if (!cfg || !cfg.models?.length) {
    return Response.json({ ok: false, error: `Hot reload is not configured for ${connection.provider} (${connection.authType}).`, connectionId: id }, { status: 400 });
  }

  try {
    const proxyCfg = await resolveConnectionProxyConfig(connection.providerSpecificData || {});
    const proxyOptions = {
      connectionProxyEnabled: proxyCfg.connectionProxyEnabled === true,
      connectionProxyUrl: proxyCfg.connectionProxyUrl || "",
      connectionNoProxy: proxyCfg.connectionNoProxy || "",
      vercelRelayUrl: proxyCfg.vercelRelayUrl || "",
      strictProxy: false,
    };

    const refreshed = await refreshAndUpdateCredentials(connection, false, proxyOptions);
    const executor = getExecutor(connection.provider);
    const pokedModels = {};
    for (const model of cfg.models) {
      pokedModels[model] = await pokeModel(executor, model, refreshed.connection, proxyOptions);
    }
    const failedModels = Object.entries(pokedModels).filter(([, ok]) => !ok).map(([m]) => m);

    await new Promise((resolve) => setTimeout(resolve, USAGE_SETTLE_MS));
    const { moved, remainingByModel } = await verifyQuotaMoved(refreshed.connection, proxyOptions, cfg.models);

    const reloaded = failedModels.length === 0 && moved;
    return Response.json({
      ok: true,
      reloaded,
      poked: failedModels.length === 0,
      pokedModels,
      failedModels,
      quotaMoved: moved,
      remainingByModel,
      connectionId: id,
      error: reloaded
        ? null
        : (failedModels.length > 0
            ? `Poke failed after retries for: ${failedModels.join(", ")}.`
            : "Quota still 0/1000 — hot reload did not move the count."),
    });
  } catch (error) {
    console.warn(`[HotReload] ${connection.provider}:${connection.id}: ${error.message}`);
    return Response.json({ ok: false, error: error.message, connectionId: connection.id }, { status: 500 });
  }
}