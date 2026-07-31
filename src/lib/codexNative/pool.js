import crypto from "node:crypto";
import { getProviderConnections } from "@/lib/localDb.js";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy.js";
import { checkAndRefreshToken } from "@/sse/services/tokenRefresh.js";
import { markAccountUnavailable, clearAccountError } from "@/sse/services/auth.js";
import { CODEX_NATIVE_CONFIG } from "open-sse/config/codexNative.js";
import { isModelLockActive } from "open-sse/services/accountFallback.js";
import { getCodexUsage } from "open-sse/services/usage/codex.js";
import {
  bindCodexNativeAffinity,
  getCodexNativeAffinity,
  getCodexNativeAffinityCounts,
  releaseCodexNativeAffinity,
  resolveCodexNativeAffinityKey,
} from "./affinity.js";
import { getCodexNativeCatalog, invalidateCodexNativeCatalog } from "./catalog.js";

if (!global.__codexNativePoolState) {
  global.__codexNativePoolState = {
    quotas: new Map(),
    quotaRefreshes: new Map(),
    activeTurns: new Map(),
    activeSockets: new Map(),
    leases: new Map(),
    failures: new Map(),
    httpFallbackCount: 0,
  };
}
const state = global.__codexNativePoolState;

function increment(map, key, delta) {
  const next = Math.max(0, (map.get(key) || 0) + delta);
  if (next === 0) map.delete(key);
  else map.set(key, next);
}

function minRemaining(usage) {
  const windows = [usage?.quotas?.session, usage?.quotas?.weekly].filter(Boolean);
  const values = windows.map((quota) => Number(quota.remaining)).filter(Number.isFinite);
  return values.length ? Math.min(...values) : null;
}

function earliestReset(usage) {
  const resets = [usage?.quotas?.session?.resetAt, usage?.quotas?.weekly?.resetAt]
    .filter(Boolean)
    .map((value) => new Date(value).getTime())
    .filter(Number.isFinite);
  return resets.length ? new Date(Math.min(...resets)).toISOString() : null;
}

export function codexQuotaStatus(remaining, previousStatus) {
  const thresholds = CODEX_NATIVE_CONFIG.quotaThresholds;
  if (remaining === null || !Number.isFinite(remaining)) return "unknown";
  if (remaining <= 0) return "exhausted";
  if (previousStatus && previousStatus !== "healthy" && remaining < thresholds.recoverRemainingPercent) {
    return remaining < thresholds.criticalRemainingPercent ? "critical" : "draining";
  }
  if (remaining < thresholds.criticalRemainingPercent) return "critical";
  if (remaining < thresholds.drainRemainingPercent) return "draining";
  return "healthy";
}

function proxyOptions(proxy) {
  return {
    connectionProxyEnabled: proxy.connectionProxyEnabled === true,
    connectionProxyUrl: proxy.connectionProxyUrl || "",
    connectionNoProxy: proxy.connectionNoProxy || "",
    vercelRelayUrl: proxy.vercelRelayUrl || "",
    strictProxy: proxy.strictProxy === true,
  };
}

export function codexWebSocketProxyCapability(proxy) {
  if (proxy?.vercelRelayUrl) return { capable: false, reason: "relay-only proxy has no WebSocket transport" };
  if (!proxy?.connectionProxyEnabled || !proxy?.connectionProxyUrl) {
    return { capable: true, reason: null };
  }
  let protocol;
  try {
    protocol = new URL(proxy.connectionProxyUrl.includes("://")
      ? proxy.connectionProxyUrl
      : `http://${proxy.connectionProxyUrl}`).protocol;
  } catch {
    return { capable: false, reason: "invalid proxy URL" };
  }
  if (!["http:", "https:", "socks:", "socks4:", "socks4a:", "socks5:", "socks5h:"].includes(protocol)) {
    return { capable: false, reason: `unsupported WebSocket proxy scheme ${protocol}` };
  }
  return { capable: true, reason: null };
}

async function refreshConnectionQuota(connection) {
  const existing = state.quotas.get(connection.id);
  if (existing && Date.now() - existing.fetchedAt < CODEX_NATIVE_CONFIG.quotaTtlMs) return existing;
  if (state.quotaRefreshes.has(connection.id)) return state.quotaRefreshes.get(connection.id);

  const pending = (async () => {
    try {
      const credentials = await checkAndRefreshToken("codex", {
        ...connection,
        connectionId: connection.id,
      });
      const proxy = await resolveConnectionProxyConfig(credentials.providerSpecificData || {});
      const usage = await getCodexUsage(credentials.accessToken, proxyOptions(proxy));
      const remaining = minRemaining(usage);
      const snapshot = {
        remaining,
        status: codexQuotaStatus(remaining, existing?.status),
        resetAt: earliestReset(usage),
        fetchedAt: Date.now(),
        source: "poll",
      };
      state.quotas.set(connection.id, snapshot);
      return snapshot;
    } catch (error) {
      const snapshot = existing || {
        remaining: null,
        status: "unknown",
        resetAt: null,
        fetchedAt: Date.now(),
        source: "poll-error",
      };
      return { ...snapshot, error: error.message };
    }
  })().finally(() => state.quotaRefreshes.delete(connection.id));

  state.quotaRefreshes.set(connection.id, pending);
  return pending;
}

function cachedQuota(connectionId) {
  return state.quotas.get(connectionId)
    || { remaining: null, status: "unknown", resetAt: null, fetchedAt: null, source: null };
}

function remainingFromRateLimitPayload(payload) {
  const details = payload?.rate_limits || payload?.rate_limit || payload;
  const windows = [
    details?.primary,
    details?.primary_window,
    details?.secondary,
    details?.secondary_window,
  ].filter(Boolean);
  const remaining = windows
    .map((window) => Number(window.remaining ?? (100 - Number(window.used_percent ?? window.percent_used))))
    .filter(Number.isFinite);
  return remaining.length ? Math.max(0, Math.min(...remaining)) : null;
}

export function ingestCodexNativeQuota(connectionId, payload, source = "event") {
  if (!connectionId || !payload) return null;
  let remaining = null;
  let resetAt = null;
  if (typeof payload?.get === "function") {
    const used = [
      payload.get("x-codex-primary-used-percent"),
      payload.get("x-codex-secondary-used-percent"),
    ].map(Number).filter(Number.isFinite);
    if (used.length) remaining = Math.max(0, 100 - Math.max(...used));
    const resets = [
      payload.get("x-codex-primary-reset-at"),
      payload.get("x-codex-secondary-reset-at"),
    ].map(Number).filter(Number.isFinite);
    if (resets.length) resetAt = new Date(Math.min(...resets) * 1000).toISOString();
  } else {
    remaining = remainingFromRateLimitPayload(payload);
  }
  if (remaining === null) return null;
  const existing = state.quotas.get(connectionId);
  const snapshot = {
    remaining,
    status: codexQuotaStatus(remaining, existing?.status),
    resetAt: resetAt || existing?.resetAt || null,
    fetchedAt: Date.now(),
    source,
  };
  state.quotas.set(connectionId, snapshot);
  return snapshot;
}

function rankCandidates(candidates, counts, transport) {
  const statusRank = { healthy: 0, unknown: 1, draining: 2, critical: 3, exhausted: 4 };
  return [...candidates].sort((a, b) => {
    const aQuota = cachedQuota(a.id);
    const bQuota = cachedQuota(b.id);
    const statusDiff = (statusRank[aQuota.status] ?? 1) - (statusRank[bQuota.status] ?? 1);
    if (statusDiff !== 0) return statusDiff;
    const remainingDiff = (bQuota.remaining ?? -1) - (aQuota.remaining ?? -1);
    if (remainingDiff !== 0) return remainingDiff;
    const activeMap = transport === "ws" ? state.activeSockets : state.activeTurns;
    const activeDiff = (activeMap.get(a.id) || 0) - (activeMap.get(b.id) || 0);
    if (activeDiff !== 0) return activeDiff;
    const affinityDiff = (counts.get(a.id) || 0) - (counts.get(b.id) || 0);
    if (affinityDiff !== 0) return affinityDiff;
    const priorityDiff = (a.priority ?? 999) - (b.priority ?? 999);
    if (priorityDiff !== 0) return priorityDiff;
    return new Date(a.lastUsedAt || 0) - new Date(b.lastUsedAt || 0);
  });
}

async function candidatesFor({ model, transport, excludeConnectionIds, clientVersion }) {
  const [connections, catalog, counts] = await Promise.all([
    getProviderConnections({ provider: "codex", isActive: true }),
    getCodexNativeCatalog({ clientVersion }),
    getCodexNativeAffinityCounts(),
  ]);
  const advertised = model ? new Set(catalog.eligibleConnectionIds?.[model] || []) : null;
  const skipped = new Map();
  const candidates = [];

  for (const connection of connections) {
    let reason = null;
    if (excludeConnectionIds.has(connection.id)) reason = "excluded after failure";
    else if (advertised && !advertised.has(connection.id)) reason = "different model metadata cohort";
    else if (model && isModelLockActive(connection, model)) reason = "model temporarily locked";
    else if (cachedQuota(connection.id).status === "exhausted") reason = "quota exhausted";
    if (!reason && transport === "ws") {
      const proxy = await resolveConnectionProxyConfig(connection.providerSpecificData || {});
      const capability = codexWebSocketProxyCapability(proxy);
      if (!capability.capable) reason = capability.reason;
    }
    if (reason) skipped.set(connection.id, reason);
    else candidates.push(connection);
  }
  return { connections, catalog, counts, candidates, skipped };
}

export async function refreshCodexNativePoolUsage(options = {}) {
  const connections = await getProviderConnections({ provider: "codex", isActive: true });
  await Promise.all(connections.map(refreshConnectionQuota));
  return getCodexNativePoolSnapshot(options);
}

export async function getCodexNativePoolSnapshot({ model = null, clientVersion } = {}) {
  const { connections, catalog, counts, candidates, skipped } = await candidatesFor({
    model,
    transport: "http",
    excludeConnectionIds: new Set(),
    clientVersion,
  });
  const candidateIds = new Set(candidates.map((connection) => connection.id));
  return connections.map((connection) => {
    const quota = cachedQuota(connection.id);
    return {
      connectionId: connection.id,
      name: connection.displayName || connection.name || connection.email || connection.id.slice(0, 8),
      priority: connection.priority ?? 999,
      eligible: candidateIds.has(connection.id),
      skippedReason: skipped.get(connection.id) || null,
      affinityCount: counts.get(connection.id) || 0,
      activeTurns: state.activeTurns.get(connection.id) || 0,
      activeSockets: state.activeSockets.get(connection.id) || 0,
      remaining: quota.remaining,
      status: isModelLockActive(connection, model) ? "locked" : quota.status,
      resetAt: quota.resetAt,
      quotaFetchedAt: quota.fetchedAt,
      quotaSource: quota.source,
      catalogEtag: catalog.upstreamEtags?.[connection.id] || null,
    };
  });
}

export async function resolveCodexNativeRouting({
  headers,
  body,
  model,
  transport = "http",
  clientVersion,
  excludeConnectionIds = new Set(),
}) {
  const { counts, candidates, skipped, catalog } = await candidatesFor({
    model,
    transport,
    excludeConnectionIds,
    clientVersion,
  });
  for (const connection of candidates) refreshConnectionQuota(connection).catch(() => {});

  const affinityKey = await resolveCodexNativeAffinityKey({ headers, body, model });
  const affinity = affinityKey ? await getCodexNativeAffinity(affinityKey) : null;
  const preferred = affinity
    ? candidates.find((connection) => connection.id === affinity.connectionId)
    : null;
  if (preferred) {
    const status = cachedQuota(preferred.id).status;
    if (status !== "critical" && status !== "exhausted") {
      return {
        affinityKey,
        preferredConnectionId: preferred.id,
        eligibleConnectionIds: candidates.map((connection) => connection.id),
        skippedReasons: Object.fromEntries(skipped),
        catalog,
      };
    }
  }

  const ranked = rankCandidates(candidates, counts, transport);
  const selected = ranked.find((connection) => {
    const status = cachedQuota(connection.id).status;
    return status === "healthy" || status === "unknown";
  }) || null;

  if (affinityKey && selected) await bindCodexNativeAffinity(affinityKey, selected.id);
  return {
    affinityKey,
    preferredConnectionId: selected?.id || null,
    eligibleConnectionIds: candidates.map((connection) => connection.id),
    skippedReasons: Object.fromEntries(skipped),
    catalog,
  };
}

export async function acquireCodexNativeLease({
  headers,
  body,
  model,
  transport = "http",
  clientVersion,
  excludeConnectionIds = new Set(),
}) {
  const routing = await resolveCodexNativeRouting({
    headers,
    body,
    model,
    transport,
    clientVersion,
    excludeConnectionIds,
  });
  if (!routing.preferredConnectionId) return { ...routing, lease: null };
  const connections = await getProviderConnections({ provider: "codex", isActive: true });
  const connection = connections.find((entry) => entry.id === routing.preferredConnectionId);
  if (!connection) return { ...routing, lease: null };
  const credentials = await checkAndRefreshToken("codex", {
    ...connection,
    connectionId: connection.id,
  });
  const proxy = await resolveConnectionProxyConfig(credentials.providerSpecificData || {});
  if (transport === "ws" && !codexWebSocketProxyCapability(proxy).capable) {
    return { ...routing, lease: null };
  }
  const lease = {
    id: crypto.randomUUID(),
    connectionId: connection.id,
    connection,
    credentials,
    proxy,
    affinityKey: routing.affinityKey,
    model: model || null,
    transport,
    clientVersion: clientVersion ?? null,
    createdAt: Date.now(),
    semanticOutput: false,
  };
  state.leases.set(lease.id, lease);
  increment(transport === "ws" ? state.activeSockets : state.activeTurns, connection.id, 1);
  return { ...routing, lease };
}

export function getCodexNativeLease(leaseId) {
  const lease = state.leases.get(leaseId);
  if (!lease) return null;
  if (Date.now() - lease.createdAt > CODEX_NATIVE_CONFIG.leaseTtlMs) {
    releaseCodexNativeLease(leaseId);
    return null;
  }
  return lease;
}

export async function validateCodexNativeLeaseModel(leaseId, model) {
  const lease = getCodexNativeLease(leaseId);
  if (!lease || !model) return false;
  const catalog = await getCodexNativeCatalog({ clientVersion: lease.clientVersion });
  const eligible = catalog.eligibleConnectionIds?.[model] || [];
  if (!eligible.includes(lease.connectionId)) return false;
  lease.model = model;
  if (lease.affinityKey) await bindCodexNativeAffinity(lease.affinityKey, lease.connectionId);
  return true;
}

export function markCodexNativeSemanticOutput(leaseId) {
  const lease = getCodexNativeLease(leaseId);
  if (lease) lease.semanticOutput = true;
}

export async function succeedCodexNativeLease(leaseId, { headers } = {}) {
  const lease = getCodexNativeLease(leaseId);
  if (!lease) return;
  if (headers) {
    ingestCodexNativeQuota(lease.connectionId, headers, "headers");
    const modelsEtag = headers.get?.("x-models-etag");
    if (modelsEtag) invalidateCodexNativeCatalog(lease.connectionId, modelsEtag, lease.clientVersion);
  }
  await clearAccountError(lease.connectionId, lease.connection, lease.model).catch(() => {});
  if (lease.affinityKey) await bindCodexNativeAffinity(lease.affinityKey, lease.connectionId);
}

export async function failCodexNativeLease(leaseId, { status = 503, error = "Codex Native failure" } = {}) {
  const lease = getCodexNativeLease(leaseId);
  if (!lease) return;
  state.failures.set(lease.connectionId, {
    status,
    message: String(error).slice(0, 160),
    at: Date.now(),
  });
  if (lease.affinityKey) await releaseCodexNativeAffinity(lease.affinityKey, lease.connectionId);
  if ([401, 429].includes(Number(status)) || Number(status) >= 500) {
    await markAccountUnavailable(
      lease.connectionId,
      Number(status),
      String(error),
      "codex",
      lease.model
    ).catch(() => {});
  }
}

export function releaseCodexNativeLease(leaseId) {
  const lease = state.leases.get(leaseId);
  if (!lease) return;
  state.leases.delete(leaseId);
  increment(lease.transport === "ws" ? state.activeSockets : state.activeTurns, lease.connectionId, -1);
}

export function incrementCodexNativeHttpFallback() {
  state.httpFallbackCount += 1;
}

export function getCodexNativeMetrics() {
  return {
    activeLeases: state.leases.size,
    activeSockets: [...state.activeSockets.values()].reduce((sum, count) => sum + count, 0),
    activeTurns: [...state.activeTurns.values()].reduce((sum, count) => sum + count, 0),
    httpFallbackCount: state.httpFallbackCount,
  };
}

export async function getCodexNativeWebSocketEligibility({ model = null, clientVersion } = {}) {
  const connections = await getProviderConnections({ provider: "codex", isActive: true });
  const catalog = await getCodexNativeCatalog({ clientVersion });
  const advertised = model ? new Set(catalog.eligibleConnectionIds?.[model] || []) : null;
  return Promise.all(connections.map(async (connection) => {
    let reason = null;
    if (advertised && !advertised.has(connection.id)) reason = "different model metadata cohort";
    else if (cachedQuota(connection.id).status === "exhausted") reason = "quota exhausted";
    const proxy = await resolveConnectionProxyConfig(connection.providerSpecificData || {});
    const capability = codexWebSocketProxyCapability(proxy);
    if (!reason && !capability.capable) reason = capability.reason;
    return {
      connectionId: connection.id,
      eligible: !reason,
      reason,
    };
  }));
}

// Compatibility exports used by phase-1 Universal glue.
export async function confirmCodexNativeRouting(affinityKey, connectionId) {
  await bindCodexNativeAffinity(affinityKey, connectionId);
}

export async function failCodexNativeRouting(affinityKey, connectionId) {
  await releaseCodexNativeAffinity(affinityKey, connectionId);
}
