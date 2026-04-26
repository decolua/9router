import { getProviderConnections, validateApiKey, updateProviderConnection, getSettings, type ProviderConnection } from "@/lib/localDb";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";
import { formatRetryAfter, checkFallbackError, isModelLockActive, buildModelLockUpdate, getEarliestModelLockUntil } from "@/lib/open-sse/services/accountFallback";
import { BACKOFF_CONFIG } from "@/lib/open-sse/config/errorConfig";
import { resolveProviderId, FREE_PROVIDERS } from "@/shared/constants/providers";
import * as log from "../utils/logger";

// Mutex to prevent race conditions during account selection
let selectionMutex = Promise.resolve();

// Runtime selector memory (per provider+model) to avoid premature account flips
const fillFirstPreferredConnectionByContext = new Map<string, string>();
const roundRobinLastConnectionByContext = new Map<string, string>();
const SELECTOR_CONTEXT_MEMORY_CAP = 512;

// Deduplicate repetitive clear-account logs under concurrent success traffic
const clearLogDedupeByContext = new Map<string, number>();
const CLEAR_LOG_DEDUPE_WINDOW_MS = 15000;

function formatAccountRef(connection: Pick<ProviderConnection, "id" | "displayName" | "name" | "email"> | null | undefined): string {
  if (!connection?.id) return "unknown";
  const label = connection.displayName || connection.name || connection.email || connection.id.slice(0, 8);
  return `${label} (${connection.id.slice(0, 8)})`;
}

function formatCooldownUntil(iso: string | null): string {
  return iso || "n/a";
}

function formatAuthCtx(providerId: string, model: string | null, mode: string): string {
  return `provider=${providerId} model=${model || "__all"} mode=${mode}`;
}

function shouldEmitClearLog(contextKey: string): boolean {
  const now = Date.now();
  const last = clearLogDedupeByContext.get(contextKey) || 0;
  if (now - last < CLEAR_LOG_DEDUPE_WINDOW_MS) return false;
  clearLogDedupeByContext.set(contextKey, now);
  while (clearLogDedupeByContext.size > SELECTOR_CONTEXT_MEMORY_CAP) {
    const oldestKey = clearLogDedupeByContext.keys().next().value;
    if (!oldestKey) break;
    clearLogDedupeByContext.delete(oldestKey);
  }
  return true;
}

function getSelectionContextKey(providerId: string, model: string | null): string {
  return `${providerId}::${model || "__all"}`;
}

function setSelectorMemory(map: Map<string, string>, key: string, value: string): void {
  if (map.has(key)) {
    map.delete(key);
  }
  map.set(key, value);

  while (map.size > SELECTOR_CONTEXT_MEMORY_CAP) {
    const oldestKey = map.keys().next().value;
    if (!oldestKey) break;
    map.delete(oldestKey);
  }
}

export interface ProviderCredentials {
  id?: string;
  apiKey?: string;
  accessToken?: string;
  refreshToken?: string;
  projectId?: string;
  connectionName: string;
  copilotToken?: string;
  providerSpecificData?: any;
  connectionId?: string;
  testStatus?: string;
  lastError?: string;
  _connection?: ProviderConnection;
  isActive?: boolean;
  allRateLimited?: boolean;
  retryAfter?: string | null;
  retryAfterHuman?: string;
  lastErrorCode?: string | number | null;
}

/**
 * Get provider credentials from localDb
 * Filters out unavailable accounts and returns the selected account based on strategy
 * @param {string} provider - Provider name
 * @param {Set<string>|string|null} excludeConnectionIds - Connection ID(s) to exclude (for retry with next account)
 * @param {string|null} model - Model name for per-model rate limit filtering
 */
export async function getProviderCredentials(provider: string, excludeConnectionIds: Set<string> | string | null = null, model: string | null = null): Promise<ProviderCredentials | null> {
  // Normalize to Set for consistent handling
  const excludeSet = excludeConnectionIds instanceof Set
    ? excludeConnectionIds
    : (excludeConnectionIds ? new Set([excludeConnectionIds]) : new Set<string>());
  // Acquire mutex to prevent race conditions
  const currentMutex = selectionMutex;
  let resolveMutex!: () => void;
  selectionMutex = new Promise(resolve => { resolveMutex = resolve as any; });

  try {
    await currentMutex;

    // Resolve alias to provider ID (e.g., "kc" -> "kilocode")
    const providerId = resolveProviderId(provider);

    // Inject a virtual connection for no-auth free providers
    if ((FREE_PROVIDERS as any)[providerId]?.noAuth) {
      return { id: "noauth", connectionName: "Public", isActive: true, accessToken: "public" };
    }

    const connections = await getProviderConnections({ provider: providerId, isActive: true });

    if (connections.length === 0) {
      log.warn("AUTH", `[AUTH] ${formatAuthCtx(providerId, model, "n/a")} no-account-configured`);
      return null;
    }

    const settings = await getSettings();
    // Per-provider strategy overrides global setting
    const providerOverride = (settings.providerStrategies || {})[providerId] || {};
    const strategy = providerOverride.fallbackStrategy || settings.comboStrategy || "fill-first";
    const authCtx = formatAuthCtx(providerId, model, strategy);

    const skippedConnections = connections
      .map(c => {
        const excluded = excludeSet.has(c.id);
        const locked = isModelLockActive(c, model);
        if (!excluded && !locked) return null;
        const cooldownUntil = locked ? getEarliestModelLockUntil(c) : null;
        const reason = excluded && locked ? "excluded+model-locked" : (excluded ? "excluded" : "model-locked");
        return { connection: c, reason, cooldownUntil };
      })
      .filter(Boolean) as Array<{ connection: ProviderConnection; reason: string; cooldownUntil: string | null }>;

    // Filter out model-locked and excluded connections
    const availableConnections = connections.filter(c => {
      if (excludeSet.has(c.id)) return false;
      if (isModelLockActive(c, model)) return false;
      return true;
    });

    log.info("AUTH", `[AUTH] ${authCtx} accounts=${connections.length} usable=${availableConnections.length} skipped=${skippedConnections.length}`);
    skippedConnections.forEach(item => {
      log.debug("AUTH", `[AUTH] ${authCtx} skip account=${formatAccountRef(item.connection)} reason=${item.reason} cooldownUntil=${formatCooldownUntil(item.cooldownUntil)}`);
    });

    if (availableConnections.length === 0) {
      // Find earliest lock expiry across all connections for retry timing
      const lockedConns = connections.filter(c => isModelLockActive(c, model));
      const expiries = lockedConns.map(c => getEarliestModelLockUntil(c)).filter(Boolean) as string[];
      const earliest = expiries.sort()[0] || null;
      if (earliest) {
        const earliestConn = lockedConns[0];
        log.warn("AUTH", `[AUTH] ${authCtx} all-unavailable reason=model-locked retryAfter=${formatRetryAfter(earliest)} cooldownUntil=${earliest} sampleAccount=${formatAccountRef(earliestConn)}`);
        return {
          connectionName: "",
          allRateLimited: true,
          retryAfter: earliest,
          retryAfterHuman: formatRetryAfter(earliest),
          lastError: earliestConn?.lastError || undefined,
          lastErrorCode: earliestConn?.errorCode || undefined
        };
      }
      log.warn("AUTH", `[AUTH] ${authCtx} all-unavailable reason=excluded-or-inactive`);
      return null;
    }

    const contextKey = getSelectionContextKey(providerId, model);
    let connection: any;
    let selectedReason = "first-available";
    if (strategy === "round-robin") {
      const lastSelectedId = roundRobinLastConnectionByContext.get(contextKey);

      if (!lastSelectedId) {
        connection = availableConnections[0];
        selectedReason = "round-robin-first";
      } else {
        const currentIdx = availableConnections.findIndex(c => c.id === lastSelectedId);
        const nextIdx = currentIdx >= 0 ? (currentIdx + 1) % availableConnections.length : 0;
        // Hard round-robin: every request advances to next usable account.
        // Accounts on cooldown/unusable are already filtered out in availableConnections.
        connection = availableConnections[nextIdx];
        selectedReason = currentIdx >= 0 ? `round-robin-next-from-${lastSelectedId.slice(0, 8)}` : "round-robin-reset";
      }

      if (connection?.id) setSelectorMemory(roundRobinLastConnectionByContext, contextKey, connection.id);
    } else {
      // Mode 1 (fill-first): stick to last healthy selected account to avoid premature jump-back
      const preferredId = fillFirstPreferredConnectionByContext.get(contextKey);
      const preferred = preferredId ? availableConnections.find(c => c.id === preferredId) : null;
      connection = preferred || availableConnections[0];
      selectedReason = preferred ? `fill-first-stick-${preferredId?.slice(0, 8)}` : "fill-first-first-available";
      if (connection?.id) setSelectorMemory(fillFirstPreferredConnectionByContext, contextKey, connection.id);
    }

    log.info("AUTH", `[AUTH] ${authCtx} selected account=${formatAccountRef(connection)} reason=${selectedReason}`);

    const resolvedProxy = await resolveConnectionProxyConfig(connection.providerSpecificData || {});

    return {
      apiKey: connection.apiKey,
      accessToken: connection.accessToken,
      refreshToken: connection.refreshToken,
      projectId: connection.projectId,
      connectionName: connection.displayName || connection.name || connection.email || connection.id,
      copilotToken: connection.providerSpecificData?.copilotToken,
      providerSpecificData: {
        ...(connection.providerSpecificData || {}),
        connectionProxyEnabled: resolvedProxy.connectionProxyEnabled,
        connectionProxyUrl: resolvedProxy.connectionProxyUrl,
        connectionNoProxy: resolvedProxy.connectionNoProxy,
        connectionProxyPoolId: resolvedProxy.proxyPoolId || null,
        vercelRelayUrl: resolvedProxy.vercelRelayUrl || "",
      },
      connectionId: connection.id,
      // Include current status for optimization check
      testStatus: connection.testStatus,
      lastError: connection.lastError,
      // Pass full connection for clearAccountError to read modelLock_* keys
      _connection: connection
    };
  } finally {
    if (resolveMutex) resolveMutex();
  }
}

/**
 * Mark account+model as unavailable — locks modelLock_${model} in DB.
 * All errors (429, 401, 5xx, etc.) lock per model, not per account.
 */
export async function markAccountUnavailable(
  connectionId: string,
  status: number,
  errorText: string,
  provider: string | null = null,
  model: string | null = null,
  resetsAtMs: number | null = null
) {
  if (!connectionId || connectionId === "noauth") return { shouldFallback: false, cooldownMs: 0 };
  const connections = await getProviderConnections({ provider: provider || undefined });
  const conn = connections.find(c => c.id === connectionId);
  const backoffLevel = (conn as any)?.backoffLevel || 0;

  const { shouldFallback, cooldownMs, newBackoffLevel } = checkFallbackError(status, errorText, backoffLevel);
  if (!shouldFallback) return { shouldFallback: false, cooldownMs: 0 };

  let effectiveCooldownMs = cooldownMs;
  if (typeof resetsAtMs === "number" && Number.isFinite(resetsAtMs) && resetsAtMs > Date.now()) {
    const resetCooldownMs = Math.max(0, Math.floor(resetsAtMs - Date.now()));
    effectiveCooldownMs = Math.min(resetCooldownMs, BACKOFF_CONFIG.max);
  }

  const reason = typeof errorText === "string" ? errorText.slice(0, 100) : "Provider error";
  const lockUpdate = buildModelLockUpdate(model, effectiveCooldownMs);
  const lockKey = Object.keys(lockUpdate)[0];
  const cooldownUntil = (lockUpdate as any)[lockKey] || null;

  await updateProviderConnection(connectionId, {
    ...lockUpdate,
    testStatus: "unavailable",
    lastError: reason,
    errorCode: String(status),
    lastErrorAt: new Date().toISOString(),
    backoffLevel: newBackoffLevel ?? backoffLevel
  } as any);

  const providerId = resolveProviderId(provider || "unknown");
  const settings = await getSettings();
  const providerOverride = (settings.providerStrategies || {})[providerId] || {};
  const authMode = providerOverride.fallbackStrategy || settings.comboStrategy || "fill-first";
  log.warn("AUTH", `[AUTH] provider=${providerId} model=${model || "__all"} mode=${authMode} fallback account=${formatAccountRef(conn)} reason=http-${status} cooldownUntil=${formatCooldownUntil(cooldownUntil)} detail=${reason}`);

  if (provider && status && reason) {
    console.error(`❌ ${provider} [${status}]: ${reason}`);
  }

  return { shouldFallback: true, cooldownMs: effectiveCooldownMs };
}

/**
 * Clear account error status on successful request.
 */
export async function clearAccountError(connectionId: string, currentConnection: any, model: string | null = null) {
  if (!connectionId || connectionId === "noauth") return;
  const conn = currentConnection._connection || currentConnection;
  const now = Date.now();
  const allLockKeys = Object.keys(conn).filter(k => k.startsWith("modelLock_"));

  if (!conn.testStatus && !conn.lastError && allLockKeys.length === 0) return;

  // Keys to clear: current model's lock + all expired locks
  const keysToClear = allLockKeys.filter(k => {
    if (model && k === `modelLock_${model}`) return true; // succeeded model
    const expiry = conn[k];
    return expiry && new Date(expiry).getTime() <= now;   // expired
  });

  if (keysToClear.length === 0 && conn.testStatus !== "unavailable" && !conn.lastError) return;

  // Check if any active locks remain after clearing
  const remainingActiveLocks = allLockKeys.filter(k => {
    if (keysToClear.includes(k)) return false;
    const expiry = conn[k];
    return expiry && new Date(expiry).getTime() > now;
  });

  const clearObj: Record<string, any> = Object.fromEntries(keysToClear.map(k => [k, null]));

  // Only reset error state if no active locks remain
  if (remainingActiveLocks.length === 0) {
    Object.assign(clearObj, { testStatus: "active", lastError: null, lastErrorAt: null, backoffLevel: 0 });
  }

  await updateProviderConnection(connectionId, clearObj);
  const providerId = resolveProviderId(conn?.provider || currentConnection?.provider || "unknown");
  const settings = await getSettings();
  const providerOverride = (settings.providerStrategies || {})[providerId] || {};
  const authMode = providerOverride.fallbackStrategy || settings.comboStrategy || "fill-first";
  const authCtx = formatAuthCtx(providerId, model, authMode);
  const contextKey = `${connectionId}::${model || "__all"}`;
  if (shouldEmitClearLog(contextKey)) {
    log.info("AUTH", `[AUTH] ${authCtx} clear account=${formatAccountRef(conn)} cleared=${keysToClear.length} remainingActiveLocks=${remainingActiveLocks.length}`);
  }
}

/**
 * Extract API key from request headers
 */
export function extractApiKey(request: Request): string | null {
  // Check Authorization header first
  const authHeader = request.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }

  // Check Anthropic x-api-key header
  const xApiKey = request.headers.get("x-api-key");
  if (xApiKey) {
    return xApiKey;
  }

  return null;
}

/**
 * Validate API key (optional - for local use can skip)
 */
export async function isValidApiKey(apiKey: string | null): Promise<boolean> {
  if (!apiKey) return false;
  return (await validateApiKey(apiKey)) === true;
}
