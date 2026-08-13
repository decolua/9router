/**
 * Pooled Codex rate limits.
 *
 * The Codex CLI does not fetch its usage bar from an endpoint — it reads
 * `x-codex-{window}-used-percent` (plus window-minutes / reset-at) off the
 * response headers of each `/responses` call. When several Codex accounts are
 * connected, 10router is spending from all of them, so reporting a single
 * account's percentage would be wrong in both directions.
 *
 * Windows are pooled by capacity, not averaged: each account contributes its
 * plan's credit allowance, so a Pro account counts ~6.7x a Plus one.
 *
 *   used% = Σ(capacity × used%) / Σ(capacity)
 *
 * Two Plus accounts at 60% and 20% report 40% — the share of the whole pool
 * that is gone. The pooled reset is the earliest of the accounts', which is
 * when capacity next comes back.
 *
 * Fetching usage means one upstream call per account, so results are cached and
 * refreshed in the background: a request never blocks on it and a cold cache
 * simply emits no headers (Codex then shows no bar, same as today).
 */

import { getProviderConnections } from "@/lib/localDb";
import { getCodexUsage } from "open-sse/services/usage/codex.js";
import { refreshCodexToken, updateProviderCredentials } from "@/sse/services/tokenRefresh";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";
import { buildRateLimitHeaders } from "./codexUsagePool.js";

const CACHE_TTL_MS = 60_000;

let cache = { at: 0, headers: {} };
let inflight = null;

async function usageForConnection(connection) {
  const proxyConfig = await resolveConnectionProxyConfig(connection.providerSpecificData);
  const proxyOptions = {
    connectionProxyEnabled: proxyConfig.connectionProxyEnabled === true,
    connectionProxyUrl: proxyConfig.connectionProxyUrl || "",
    connectionNoProxy: proxyConfig.connectionNoProxy || "",
    vercelRelayUrl: proxyConfig.vercelRelayUrl || "",
    strictProxy: false,
  };

  let accessToken = connection.accessToken;
  const expiresAt = connection.expiresAt || connection.tokenExpiresAt;
  const isExpired = expiresAt ? new Date(expiresAt).getTime() <= Date.now() + 60_000 : false;

  if (isExpired && connection.refreshToken) {
    const refreshed = await refreshCodexToken(connection.refreshToken).catch(() => null);
    if (refreshed?.accessToken) {
      accessToken = refreshed.accessToken;
      await updateProviderCredentials(connection.id, {
        ...refreshed,
        existingProviderSpecificData: connection.providerSpecificData || {},
      }).catch(() => {});
    }
  }

  if (!accessToken) return null;
  const usage = await getCodexUsage(accessToken, proxyOptions);
  // A plain { message } payload means the usage API was unavailable, not zero usage.
  return usage?.quotas ? usage : null;
}

async function computeHeaders() {
  let connections = [];
  try {
    connections = await getProviderConnections();
  } catch {
    return {};
  }

  const codexConnections = connections.filter(
    (c) => c.provider === "codex" && c.isActive !== false && (c.accessToken || c.refreshToken)
  );
  if (codexConnections.length === 0) return {};

  const settled = await Promise.allSettled(codexConnections.map(usageForConnection));
  const usages = settled
    .filter((r) => r.status === "fulfilled" && r.value)
    .map((r) => r.value);
  if (usages.length === 0) return {};

  return buildRateLimitHeaders(usages);
}

function refreshInBackground() {
  if (inflight) return;
  inflight = computeHeaders()
    .then((headers) => {
      cache = { at: Date.now(), headers };
    })
    .catch((error) => {
      console.log(`[CodexPooledUsage] refresh failed: ${error?.message || error}`);
      // Keep serving the previous value; only the timestamp moves so a failing
      // upstream doesn't turn into a refresh loop on every request.
      cache = { ...cache, at: Date.now() };
    })
    .finally(() => {
      inflight = null;
    });
}

/**
 * Pooled rate-limit headers for the Codex CLI. Returns immediately — the value
 * may be up to CACHE_TTL_MS stale, and is `{}` until the first refresh lands.
 * @returns {Record<string, string>}
 */
export function getPooledCodexRateLimitHeaders() {
  if (Date.now() - cache.at > CACHE_TTL_MS) refreshInBackground();
  return cache.headers;
}
