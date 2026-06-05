import {
  getProviderConnections,
  validateApiKey,
  updateProviderConnection,
  getSettings,
  getApiKeyValidationInfo,
  evaluateApiKeyLimitState,
} from "@/lib/localDb";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";
import {
  formatRetryAfter,
  checkFallbackError,
  isModelLockActive,
  buildModelLockUpdate,
  getEarliestModelLockUntil,
} from "open-sse/services/accountFallback.js";
import { MAX_RATE_LIMIT_COOLDOWN_MS } from "open-sse/config/errorConfig.js";
import {
  resolveProviderId,
  FREE_PROVIDERS,
} from "@/shared/constants/providers.js";
import * as log from "../utils/logger.js";

// Mutex to prevent race conditions during account selection
let selectionMutex = Promise.resolve();

/**
 * Get provider credentials from localDb
 * Filters out unavailable accounts and returns the selected account based on strategy
 * @param {string} provider - Provider name
 * @param {Set<string>|string|null} excludeConnectionIds - Connection ID(s) to exclude (for retry with next account)
 * @param {string|null} model - Model name for per-model rate limit filtering
 */
export async function getProviderCredentials(
  provider,
  excludeConnectionIds = null,
  model = null,
  options = {},
) {
  // Normalize to Set for consistent handling
  const excludeSet =
    excludeConnectionIds instanceof Set
      ? excludeConnectionIds
      : excludeConnectionIds
        ? new Set([excludeConnectionIds])
        : new Set();
  const preferredConnectionId = options?.preferredConnectionId || null;
  // Acquire mutex to prevent race conditions
  const currentMutex = selectionMutex;
  let resolveMutex;
  selectionMutex = new Promise((resolve) => {
    resolveMutex = resolve;
  });

  try {
    await currentMutex;

    // Resolve alias to provider ID (e.g., "kc" -> "kilocode")
    const providerId = resolveProviderId(provider);

    // Inject a virtual connection for no-auth free providers (with optional proxy pool from settings)
    if (FREE_PROVIDERS[providerId]?.noAuth) {
      const settings = await getSettings();
      const override = (settings.providerStrategies || {})[providerId] || {};
      const resolvedProxy = await resolveConnectionProxyConfig({
        proxyPoolId: override.proxyPoolId || "",
      });
      return {
        id: "noauth",
        connectionName: "Public",
        isActive: true,
        accessToken: "public",
        providerSpecificData: {
          connectionProxyEnabled: resolvedProxy.connectionProxyEnabled,
          connectionProxyUrl: resolvedProxy.connectionProxyUrl,
          connectionNoProxy: resolvedProxy.connectionNoProxy,
          connectionProxyPoolId: resolvedProxy.proxyPoolId || null,
          vercelRelayUrl: resolvedProxy.vercelRelayUrl || "",
          connectionProxyHeadersTimeoutMs: resolvedProxy.connectionProxyHeadersTimeoutMs,
        },
      };
    }

    const connections = await getProviderConnections({
      provider: providerId,
      isActive: true,
    });
    log.debug(
      "AUTH",
      `${provider} | total connections: ${connections.length}, excludeIds: ${excludeSet.size > 0 ? [...excludeSet].join(",") : "none"}, model: ${model || "any"}`,
    );

    if (connections.length === 0) {
      log.warn("AUTH", `No credentials for ${provider}`);
      return null;
    }

    // Filter out model-locked and excluded connections
    const availableConnections = connections.filter((c) => {
      if (excludeSet.has(c.id)) return false;
      if (isModelLockActive(c, model)) return false;
      return true;
    });

    log.debug(
      "AUTH",
      `${provider} | available: ${availableConnections.length}/${connections.length}`,
    );
    connections.forEach((c) => {
      const excluded = excludeSet.has(c.id);
      const locked = isModelLockActive(c, model);
      if (excluded || locked) {
        const lockUntil = getEarliestModelLockUntil(c);
        log.debug(
          "AUTH",
          `  → ${c.id?.slice(0, 8)} | ${excluded ? "excluded" : ""} ${locked ? `modelLocked(${model}) until ${lockUntil}` : ""}`,
        );
      }
    });

    if (availableConnections.length === 0) {
      // Find earliest lock expiry across all connections for retry timing
      const lockedConns = connections.filter((c) =>
        isModelLockActive(c, model),
      );
      const expiries = lockedConns
        .map((c) => getEarliestModelLockUntil(c))
        .filter(Boolean);
      const earliest = expiries.sort()[0] || null;
      if (earliest) {
        const earliestConn = lockedConns[0];
        log.warn(
          "AUTH",
          `${provider} | all ${connections.length} accounts locked for ${model || "all"} (${formatRetryAfter(earliest)}) | lastError=${earliestConn?.lastError?.slice(0, 50)}`,
        );
        return {
          allRateLimited: true,
          retryAfter: earliest,
          retryAfterHuman: formatRetryAfter(earliest),
          lastError: earliestConn?.lastError || null,
          lastErrorCode: earliestConn?.errorCode || null,
        };
      }
      log.warn(
        "AUTH",
        `${provider} | all ${connections.length} accounts unavailable`,
      );
      return null;
    }

    const settings = await getSettings();
    // Per-provider strategy overrides global setting
    const providerOverride =
      (settings.providerStrategies || {})[providerId] || {};
    const strategy =
      providerOverride.fallbackStrategy ||
      settings.fallbackStrategy ||
      "fill-first";

    let connection;
    // Pin to preferred connection if specified and available
    if (preferredConnectionId) {
      connection = availableConnections.find(
        (c) => c.id === preferredConnectionId,
      );
      if (connection) {
        log.info(
          "AUTH",
          `${provider} | pinned to ${connection.id?.slice(0, 8)} (${connection.name || connection.email || "unnamed"})`,
        );
      }
    }
    if (connection) {
      // skip strategy
    } else if (strategy === "round-robin") {
      const stickyLimit =
        providerOverride.stickyRoundRobinLimit ||
        settings.stickyRoundRobinLimit ||
        3;

      // Sort by lastUsed (most recent first) to find current candidate
      const byRecency = [...availableConnections].sort((a, b) => {
        if (!a.lastUsedAt && !b.lastUsedAt)
          return (a.priority || 999) - (b.priority || 999);
        if (!a.lastUsedAt) return 1;
        if (!b.lastUsedAt) return -1;
        return new Date(b.lastUsedAt) - new Date(a.lastUsedAt);
      });

      const current = byRecency[0];
      const currentCount = current?.consecutiveUseCount || 0;

      if (current && current.lastUsedAt && currentCount < stickyLimit) {
        // Stay with current account
        connection = current;
        // Update lastUsedAt and increment count (await to ensure persistence)
        await updateProviderConnection(connection.id, {
          lastUsedAt: new Date().toISOString(),
          consecutiveUseCount: (connection.consecutiveUseCount || 0) + 1,
        });
      } else {
        // Pick the least recently used (excluding current if possible)
        const sortedByOldest = [...availableConnections].sort((a, b) => {
          if (!a.lastUsedAt && !b.lastUsedAt)
            return (a.priority || 999) - (b.priority || 999);
          if (!a.lastUsedAt) return -1;
          if (!b.lastUsedAt) return 1;
          return new Date(a.lastUsedAt) - new Date(b.lastUsedAt);
        });

        connection = sortedByOldest[0];

        // Update lastUsedAt and reset count to 1 (await to ensure persistence)
        await updateProviderConnection(connection.id, {
          lastUsedAt: new Date().toISOString(),
          consecutiveUseCount: 1,
        });
      }
    } else {
      // Default: fill-first (already sorted by priority in getProviderConnections)
      connection = availableConnections[0];
    }

    const resolvedProxy = await resolveConnectionProxyConfig(
      connection.providerSpecificData || {},
    );

    const isKiro = providerId === "kiro";

    return {
      authType: connection.authType,
      apiKey: connection.apiKey,
      accessToken: connection.accessToken,
      refreshToken: connection.refreshToken,
      ...(isKiro ? {
        expiresAt: connection.expiresAt,
        expiresIn: connection.expiresIn,
      } : {}),
      projectId: connection.projectId,
      connectionName:
        connection.displayName ||
        connection.name ||
        connection.email ||
        connection.id,
      copilotToken: connection.providerSpecificData?.copilotToken,
      providerSpecificData: {
        ...(connection.providerSpecificData || {}),
        connectionProxyEnabled: resolvedProxy.connectionProxyEnabled,
        connectionProxyUrl: resolvedProxy.connectionProxyUrl,
        connectionNoProxy: resolvedProxy.connectionNoProxy,
        connectionProxyPoolId: resolvedProxy.proxyPoolId || null,
        vercelRelayUrl: resolvedProxy.vercelRelayUrl || "",
        connectionProxyHeadersTimeoutMs: resolvedProxy.connectionProxyHeadersTimeoutMs,
      },
      connectionId: connection.id,
      // Include current status for optimization check
      testStatus: connection.testStatus,
      lastError: connection.lastError,
      // Pass full connection for clearAccountError to read modelLock_* keys
      _connection: connection,
    };
  } finally {
    if (resolveMutex) resolveMutex();
  }
}

/**
 * Mark account+model as unavailable — locks modelLock_${model} in DB.
 * All errors (429, 401, 5xx, etc.) lock per model, not per account.
 * @param {string} connectionId
 * @param {number} status - HTTP status code from upstream
 * @param {string} errorText
 * @param {string|null} provider
 * @param {string|null} model - The specific model that triggered the error
 * @returns {{ shouldFallback: boolean, cooldownMs: number }}
 */
export async function markAccountUnavailable(
  connectionId,
  status,
  errorText,
  provider = null,
  model = null,
  resetsAtMs = null,
) {
  if (!connectionId || connectionId === "noauth")
    return { shouldFallback: false, cooldownMs: 0 };
  const connections = await getProviderConnections({ provider });
  const conn = connections.find((c) => c.id === connectionId);
  const backoffLevel = conn?.backoffLevel || 0;

  const connName =
    conn?.displayName || conn?.name || conn?.email || connectionId.slice(0, 8);

  const lowerError =
    typeof errorText === "string" ? errorText.toLowerCase() : "";

  const isInvalidToken =
    status === 401 ||
    lowerError.includes("token_revoked") ||
    lowerError.includes("invalidated oauth token") ||
    lowerError.includes("invalid oauth token") ||
    lowerError.includes("token revoked") ||
    lowerError.includes("invalid token") ||
    lowerError.includes("invalid api key") ||
    lowerError.includes("unauthorized") ||
    lowerError.includes("unauthenticated");

  const isReachLimit =
    lowerError.includes("reach limit") ||
    lowerError.includes("reached the limit") ||
    lowerError.includes("reached limit") ||
    lowerError.includes("quota exceeded") ||
    lowerError.includes("insufficient_quota") ||
    lowerError.includes("usage limit") ||
    lowerError.includes("limit has been reached") ||
    lowerError.includes("limit reached") ||
    lowerError.includes("monthly_request_count");

  const isSuspended =
    lowerError.includes("suspended") ||
    lowerError.includes("locked your account") ||
    lowerError.includes("verify your identity") ||
    lowerError.includes("support_form");

  if (isReachLimit || isInvalidToken || isSuspended) {
    const reason =
      typeof errorText === "string"
        ? errorText.slice(0, 100)
        : isInvalidToken
          ? "Invalid/Revoked Token"
          : isSuspended
            ? "Account suspended/locked"
            : "Quota reached";
    log.warn(
      "AUTH",
      `[Auto-Disable] Disabling connection ${connName} permanently due to ${
        isInvalidToken
          ? "invalid/revoked token"
          : isSuspended
            ? "account suspension"
            : "quota limit reached"
      }: ${reason}`,
    );
    await updateProviderConnection(connectionId, {
      isActive: false, // Disable account permanently in DB
      testStatus: "unavailable",
      lastError: isInvalidToken
        ? `Invalid Token: ${reason}`
        : isSuspended
          ? `Suspended: ${reason}`
          : `Quota reached: ${reason}`,
      errorCode: status,
      lastErrorAt: new Date().toISOString(),
      backoffLevel: 0,
    });
    if (provider && status && reason) {
      console.error(
        `\x1b[31m❌ ${provider} [${status}]: ${reason} (Auto-disabled)\x1b[0m`,
      );
    }
    return { shouldFallback: true, cooldownMs: 5 * 60 * 60 * 1000 }; // 5 hours fallback cooldown
  }

  // Provider-specific precise cooldown (e.g. codex usage_limit_reached resets_at) overrides backoff
  let shouldFallback, cooldownMs, newBackoffLevel;
  if (resetsAtMs && resetsAtMs > Date.now()) {
    shouldFallback = true;
    cooldownMs = Math.min(resetsAtMs - Date.now(), MAX_RATE_LIMIT_COOLDOWN_MS);
    newBackoffLevel = 0;
  } else {
    ({ shouldFallback, cooldownMs, newBackoffLevel } = checkFallbackError(
      status,
      errorText,
      backoffLevel,
    ));
  }
  if (!shouldFallback) return { shouldFallback: false, cooldownMs: 0 };

  const reason =
    typeof errorText === "string" ? errorText.slice(0, 100) : "Provider error";
  const lockUpdate = buildModelLockUpdate(model, cooldownMs);

  await updateProviderConnection(connectionId, {
    ...lockUpdate,
    testStatus: "unavailable",
    lastError: reason,
    errorCode: status,
    lastErrorAt: new Date().toISOString(),
    backoffLevel: newBackoffLevel ?? backoffLevel,
  });

  const lockKey = Object.keys(lockUpdate)[0];
  log.warn(
    "AUTH",
    `${connName} locked ${lockKey} for ${Math.round(cooldownMs / 1000)}s [${status}]`,
  );

  if (provider && status && reason) {
    console.error(`\x1b[31m❌ ${provider} [${status}]: ${reason}\x1b[0m`);
  }

  return { shouldFallback: true, cooldownMs };
}

/**
 * Clear account error status on successful request.
 * - Clears modelLock_${model} (the model that just succeeded)
 * - Lazy-cleans any other expired modelLock_* keys
 * - Resets error state only if no active locks remain
 * @param {string} connectionId
 * @param {object} currentConnection - credentials object (has _connection) or raw connection
 * @param {string|null} model - model that succeeded
 */
export async function clearAccountError(
  connectionId,
  currentConnection,
  model = null,
) {
  if (!connectionId || connectionId === "noauth") return;
  const conn = currentConnection._connection || currentConnection;
  const now = Date.now();
  const allLockKeys = Object.keys(conn).filter((k) =>
    k.startsWith("modelLock_"),
  );

  if (!conn.testStatus && !conn.lastError && allLockKeys.length === 0) return;

  // Keys to clear: current model's lock + all expired locks
  const keysToClear = allLockKeys.filter((k) => {
    if (model && k === `modelLock_${model}`) return true; // succeeded model
    if (model && k === "modelLock___all") return true; // account-level lock
    const expiry = conn[k];
    return expiry && new Date(expiry).getTime() <= now; // expired
  });

  if (
    keysToClear.length === 0 &&
    conn.testStatus !== "unavailable" &&
    !conn.lastError
  )
    return;

  // Check if any active locks remain after clearing
  const remainingActiveLocks = allLockKeys.filter((k) => {
    if (keysToClear.includes(k)) return false;
    const expiry = conn[k];
    return expiry && new Date(expiry).getTime() > now;
  });

  const clearObj = Object.fromEntries(keysToClear.map((k) => [k, null]));

  // Only reset error state if no active locks remain
  if (remainingActiveLocks.length === 0) {
    Object.assign(clearObj, {
      testStatus: "active",
      lastError: null,
      lastErrorAt: null,
      backoffLevel: 0,
    });
  }

  await updateProviderConnection(connectionId, clearObj);
}

/**
 * Extract API key from request headers
 */
export function extractApiKey(request) {
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

function buildLimitExceededMessage(limitState) {
  return `${limitState.metricType} ${limitState.currentValue}/${limitState.limitValue} exceeded for ${limitState.periodType} window`;
}

export async function requireValidApiKey(request, settings = null) {
  const effectiveSettings = settings || (await getSettings());
  const apiKey = extractApiKey(request);

  if (!effectiveSettings.requireApiKey) {
    return {
      ok: true,
      apiKey,
      keyInfo: null,
      limitState: null,
      settings: effectiveSettings,
    };
  }

  if (!apiKey) {
    return {
      ok: false,
      apiKey: null,
      keyInfo: null,
      limitState: null,
      settings: effectiveSettings,
      status: 401,
      message: "Missing API key",
      code: "missing_api_key",
    };
  }

  const validation = await getApiKeyValidationInfo(apiKey);
  if (!validation.valid) {
    return {
      ok: false,
      apiKey,
      keyInfo: validation.apiKey,
      limitState: null,
      settings: effectiveSettings,
      status: 401,
      message:
        validation.reason === "inactive"
          ? "API key is paused"
          : "Invalid API key",
      code:
        validation.reason === "inactive"
          ? "inactive_api_key"
          : "invalid_api_key",
    };
  }

  const limitState = await evaluateApiKeyLimitState(validation.apiKey);
  if (limitState.enabled && limitState.exceeded) {
    return {
      ok: false,
      apiKey,
      keyInfo: validation.apiKey,
      limitState,
      settings: effectiveSettings,
      status: 403, // Return 403 Forbidden for quota/budget limits to prevent client retry loops
      message: buildLimitExceededMessage(limitState),
      code: "insufficient_quota",
    };
  }

  return {
    ok: true,
    apiKey,
    keyInfo: validation.apiKey,
    limitState,
    settings: effectiveSettings,
  };
}

/**
 * Validate API key (optional - for local use can skip)
 */
export async function isValidApiKey(apiKey) {
  if (!apiKey) return false;
  return await validateApiKey(apiKey);
}

export function apiKeyErrorResponse(authResult, errorResponse) {
  return errorResponse(authResult.status, authResult.message, {
    code: authResult.code,
    limit: authResult.limitState
      ? {
          metricType: authResult.limitState.metricType,
          periodType: authResult.limitState.periodType,
          limitValue: authResult.limitState.limitValue,
          currentValue: authResult.limitState.currentValue,
          remainingValue: authResult.limitState.remainingValue,
          nextResetAt: authResult.limitState.nextResetAt,
        }
      : undefined,
  });
}

export async function enforceApiKeyPolicy(
  request,
  errorResponse,
  settings = null,
) {
  const result = await requireValidApiKey(request, settings);
  if (!result.ok) {
    return {
      ok: false,
      response: apiKeyErrorResponse(result, errorResponse),
      auth: result,
    };
  }
  return { ok: true, auth: result };
}

export function logApiKeyPresence(apiKey, log) {
  if (apiKey) {
    log.debug("AUTH", `API Key: ${log.maskKey(apiKey)}`);
  } else {
    log.debug("AUTH", "No API key provided (local mode)");
  }
}

export function normalizeApiKeyFailureLog(authResult, log) {
  if (!authResult?.ok) {
    log.warn("AUTH", authResult.message);
  }
}

export function getLimitStatusForUi(limitState) {
  if (!limitState?.enabled) return "unlimited";
  if (limitState.exceeded) return "exceeded";
  if (
    limitState.limitValue &&
    limitState.currentValue >= limitState.limitValue * 0.8
  ) {
    return "near";
  }
  return "healthy";
}

export function getApiKeyLimitSnapshot(authResult) {
  if (!authResult?.limitState?.enabled) return null;
  return {
    metricType: authResult.limitState.metricType,
    periodType: authResult.limitState.periodType,
    limitValue: authResult.limitState.limitValue,
    currentValue: authResult.limitState.currentValue,
    remainingValue: authResult.limitState.remainingValue,
    nextResetAt: authResult.limitState.nextResetAt,
    status: getLimitStatusForUi(authResult.limitState),
  };
}

export function attachApiKeyContext(body, authResult) {
  return {
    ...body,
    _apiKeyContext: {
      apiKeyId: authResult?.keyInfo?.id || null,
      limit: getApiKeyLimitSnapshot(authResult),
    },
  };
}

export function applyApiKeyContextToUsage(entry, authResult) {
  return {
    ...entry,
    apiKeyId: authResult?.keyInfo?.id || null,
  };
}

export function buildApiKeyDebugMeta(authResult) {
  return {
    apiKeyId: authResult?.keyInfo?.id || null,
    apiKeyName: authResult?.keyInfo?.name || null,
    apiKeyLimit: getApiKeyLimitSnapshot(authResult),
  };
}

export function getApiKeyLimitCode(authResult) {
  return authResult?.code || null;
}

export function getApiKeyLimitState(authResult) {
  return authResult?.limitState || null;
}

export function getApiKeyInfo(authResult) {
  return authResult?.keyInfo || null;
}

export function getApiKeyValue(authResult) {
  return authResult?.apiKey || null;
}

export function isApiKeyRequired(settings) {
  return !!settings?.requireApiKey;
}

export function canSkipApiKeyValidation(settings) {
  return !isApiKeyRequired(settings);
}

export function getApiKeyFailureStatus(authResult) {
  return authResult?.status || 401;
}

export function getApiKeyFailureMessage(authResult) {
  return authResult?.message || "Invalid API key";
}

export function getApiKeyFailurePayload(authResult) {
  return {
    code: authResult?.code,
    limit: authResult?.limitState
      ? {
          metricType: authResult.limitState.metricType,
          periodType: authResult.limitState.periodType,
          limitValue: authResult.limitState.limitValue,
          currentValue: authResult.limitState.currentValue,
          remainingValue: authResult.limitState.remainingValue,
          nextResetAt: authResult.limitState.nextResetAt,
        }
      : undefined,
  };
}

export function buildApiKeyError(authResult) {
  return {
    status: getApiKeyFailureStatus(authResult),
    message: getApiKeyFailureMessage(authResult),
    payload: getApiKeyFailurePayload(authResult),
  };
}

export function authFailureToErrorResponse(authResult, errorResponse) {
  const failure = buildApiKeyError(authResult);
  return errorResponse(failure.status, failure.message, failure.payload);
}

export function getRequestApiKeyContext(request, authResult = null) {
  return {
    apiKey: authResult?.apiKey ?? extractApiKey(request),
    apiKeyId: authResult?.keyInfo?.id || null,
  };
}

export function buildApiKeyUsageSummaryResponse(
  apiKey,
  limitState,
  history = [],
) {
  return {
    key: {
      id: apiKey.id,
      name: apiKey.name,
      key: apiKey.key,
      isActive: apiKey.isActive,
      createdAt: apiKey.createdAt,
      limit: apiKey.limit,
    },
    limitState: limitState
      ? {
          ...limitState,
          status: getLimitStatusForUi(limitState),
        }
      : null,
    history,
  };
}

export function isLimitExceeded(limitState) {
  return !!limitState?.enabled && !!limitState?.exceeded;
}

export function getApiKeyMetricLabel(metricType) {
  if (metricType === "requests") return "Requests";
  if (metricType === "tokens") return "Tokens";
  if (metricType === "cost") return "Cost";
  return "Usage";
}

export function getApiKeyPeriodLabel(periodType) {
  return periodType === "monthly" ? "Monthly" : "Daily";
}

export function formatApiKeyLimitMessage(limitState) {
  if (!limitState?.enabled) return "Unlimited";
  return `${getApiKeyMetricLabel(limitState.metricType)} ${limitState.currentValue}/${limitState.limitValue} · ${getApiKeyPeriodLabel(limitState.periodType)}`;
}

export function getApiKeyLimitRemainingText(limitState) {
  if (!limitState?.enabled) return "Unlimited";
  return `${limitState.remainingValue} remaining`;
}

export function getApiKeyNextResetText(limitState) {
  return limitState?.nextResetAt || null;
}

export function buildApiKeyLimitUiState(authResult) {
  const limitState = authResult?.limitState;
  return {
    message: formatApiKeyLimitMessage(limitState),
    remaining: getApiKeyLimitRemainingText(limitState),
    nextResetAt: getApiKeyNextResetText(limitState),
    status: getLimitStatusForUi(limitState),
  };
}

export function getValidatedApiKey(authResult) {
  return authResult?.keyInfo || null;
}

export function getValidatedApiKeyId(authResult) {
  return authResult?.keyInfo?.id || null;
}

export function getValidatedApiKeyName(authResult) {
  return authResult?.keyInfo?.name || null;
}

export function getValidatedApiKeyLimit(authResult) {
  return authResult?.keyInfo?.limit || null;
}

export function hasApiKeyLimit(authResult) {
  return !!authResult?.keyInfo?.limit;
}

export function buildApiKeyRequestMeta(authResult) {
  return {
    apiKeyId: getValidatedApiKeyId(authResult),
    apiKeyName: getValidatedApiKeyName(authResult),
    hasLimit: hasApiKeyLimit(authResult),
    limit: getValidatedApiKeyLimit(authResult),
  };
}

export function getApiKeyValidationSummary(authResult) {
  return {
    ok: !!authResult?.ok,
    apiKeyId: getValidatedApiKeyId(authResult),
    hasLimit: hasApiKeyLimit(authResult),
    exceeded: isLimitExceeded(authResult?.limitState),
  };
}

export function getApiKeyLimitResponseMeta(limitState) {
  if (!limitState?.enabled) return undefined;
  return {
    metricType: limitState.metricType,
    periodType: limitState.periodType,
    limitValue: limitState.limitValue,
    currentValue: limitState.currentValue,
    remainingValue: limitState.remainingValue,
    nextResetAt: limitState.nextResetAt,
  };
}

export function getApiKeyLimitDisplay(limitState) {
  return {
    status: getLimitStatusForUi(limitState),
    message: formatApiKeyLimitMessage(limitState),
    remaining: getApiKeyLimitRemainingText(limitState),
    nextResetAt: getApiKeyNextResetText(limitState),
  };
}

export function isApiKeyPresent(request) {
  return !!extractApiKey(request);
}

export function getApiKeyAuthMode(settings) {
  return settings?.requireApiKey ? "required" : "optional";
}

export function getApiKeyLimitKind(limitState) {
  return limitState?.metricType || null;
}

export function getApiKeyLimitWindow(limitState) {
  return limitState?.periodType || null;
}

export function getApiKeyLimitValue(limitState) {
  return limitState?.limitValue ?? null;
}

export function getApiKeyCurrentValue(limitState) {
  return limitState?.currentValue ?? 0;
}

export function getApiKeyRemainingValue(limitState) {
  return limitState?.remainingValue ?? null;
}

export function getApiKeyResetAt(limitState) {
  return limitState?.nextResetAt ?? null;
}

export function buildApiKeyHeaderDebug(request, authResult) {
  return {
    apiKey: getApiKeyValue(authResult) || extractApiKey(request),
    apiKeyId: getValidatedApiKeyId(authResult),
    authMode: getApiKeyAuthMode(authResult?.settings),
  };
}

export function buildApiKeyLimitStatus(limitState) {
  return {
    enabled: !!limitState?.enabled,
    exceeded: !!limitState?.exceeded,
    status: getLimitStatusForUi(limitState),
  };
}

export function getRequestApiKeyValue(request) {
  return extractApiKey(request);
}

export function getRequestApiKeyValidationState(authResult) {
  return {
    valid: !!authResult?.ok,
    code: authResult?.code || null,
  };
}

export function getApiKeyPolicySnapshot(apiKey) {
  return apiKey?.limit || null;
}

export function getApiKeyLimitSummary(limitState) {
  return getApiKeyLimitResponseMeta(limitState);
}

export function buildApiKeyValidationResult(authResult) {
  return {
    apiKey: getValidatedApiKey(authResult),
    limitState: getApiKeyLimitState(authResult),
  };
}

export function getApiKeyEnforcementContext(authResult) {
  return {
    apiKey: getValidatedApiKey(authResult),
    limitState: getApiKeyLimitState(authResult),
    snapshot: buildApiKeyLimitUiState(authResult),
  };
}

export function applyApiKeyEnforcementLog(authResult, log) {
  if (isLimitExceeded(authResult?.limitState)) {
    log.warn("AUTH", buildLimitExceededMessage(authResult.limitState));
  }
}

export function getApiKeyRequestTelemetry(authResult) {
  return {
    apiKeyId: getValidatedApiKeyId(authResult),
    metricType: getApiKeyLimitKind(authResult?.limitState),
    periodType: getApiKeyLimitWindow(authResult?.limitState),
  };
}

export function getApiKeyRequestGuardResult(authResult) {
  return authResult?.ok !== false;
}

export function buildMissingApiKeyResponse(errorResponse) {
  return errorResponse(401, "Missing API key", { code: "missing_api_key" });
}

export function buildInvalidApiKeyResponse(errorResponse) {
  return errorResponse(401, "Invalid API key", { code: "invalid_api_key" });
}

export function buildInactiveApiKeyResponse(errorResponse) {
  return errorResponse(401, "API key is paused", { code: "inactive_api_key" });
}

export function buildExceededApiKeyResponse(limitState, errorResponse) {
  return errorResponse(429, buildLimitExceededMessage(limitState), {
    code: "api_key_limit_exceeded",
    limit: getApiKeyLimitResponseMeta(limitState),
  });
}

export function hasExceededApiKeyLimit(authResult) {
  return isLimitExceeded(authResult?.limitState);
}

export function getApiKeyAuthDetails(authResult) {
  return {
    keyInfo: getValidatedApiKey(authResult),
    limitState: getApiKeyLimitState(authResult),
    ui: buildApiKeyLimitUiState(authResult),
  };
}

export function getApiKeySummaryForLog(authResult) {
  const keyInfo = getValidatedApiKey(authResult);
  if (!keyInfo) return null;
  return {
    id: keyInfo.id,
    name: keyInfo.name,
    isActive: keyInfo.isActive,
  };
}

export function getApiKeyAuthSnapshot(authResult) {
  return {
    apiKeyId: getValidatedApiKeyId(authResult),
    keyName: getValidatedApiKeyName(authResult),
    limitStatus: buildApiKeyLimitStatus(authResult?.limitState),
  };
}

export function getApiKeyLimitTelemetry(limitState) {
  if (!limitState?.enabled) return null;
  return {
    metricType: limitState.metricType,
    periodType: limitState.periodType,
    limitValue: limitState.limitValue,
    currentValue: limitState.currentValue,
  };
}

export function getApiKeyLimitResponse(limitState) {
  return getApiKeyLimitResponseMeta(limitState);
}

export function getApiKeyRateLimitHint(limitState) {
  return limitState?.nextResetAt || null;
}

export function buildApiKeyStatusBadge(limitState) {
  return getLimitStatusForUi(limitState);
}

export function getApiKeyLimitReason(authResult) {
  return authResult?.code || null;
}

export function getApiKeyLimitMessage(authResult) {
  return authResult?.message || null;
}

export function buildApiKeyGuardContext(authResult) {
  return {
    auth: getApiKeyValidationSummary(authResult),
    key: getApiKeySummaryForLog(authResult),
    limit: getApiKeyLimitTelemetry(authResult?.limitState),
  };
}

export function buildApiKeyUsageContext(authResult) {
  return {
    apiKeyId: getValidatedApiKeyId(authResult),
    apiKeyName: getValidatedApiKeyName(authResult),
    limit: getApiKeyLimitResponse(authResult?.limitState),
  };
}

export function hasApiKeyGuardError(authResult) {
  return authResult?.ok === false;
}

export function getApiKeyGuardErrorResponse(authResult, errorResponse) {
  return authFailureToErrorResponse(authResult, errorResponse);
}

export function getApiKeyGuardErrorPayload(authResult) {
  return getApiKeyFailurePayload(authResult);
}

export function buildApiKeyResult(authResult) {
  return {
    ok: authResult?.ok !== false,
    apiKey: getValidatedApiKey(authResult),
    limitState: getApiKeyLimitState(authResult),
  };
}

export function getApiKeyLimitUiStatus(limitState) {
  return getLimitStatusForUi(limitState);
}

export function getApiKeyLimitUiMessage(limitState) {
  return formatApiKeyLimitMessage(limitState);
}

export function getApiKeyLimitUiRemaining(limitState) {
  return getApiKeyLimitRemainingText(limitState);
}

export function getApiKeyLimitUiReset(limitState) {
  return getApiKeyNextResetText(limitState);
}

export function getAuthRequestApiKey(request) {
  return extractApiKey(request);
}

export function getAuthValidationInfo(authResult) {
  return getApiKeyValidationSummary(authResult);
}

export function getApiKeyErrorLimitMeta(authResult) {
  return getApiKeyLimitResponseMeta(authResult?.limitState);
}

export function getApiKeyErrorCode(authResult) {
  return authResult?.code || null;
}

export function buildApiKeyDebugContext(request, authResult) {
  return {
    requestApiKey: getAuthRequestApiKey(request),
    validation: getAuthValidationInfo(authResult),
  };
}

export function getApiKeyGuardMeta(authResult) {
  return {
    apiKeyId: getValidatedApiKeyId(authResult),
    status: getApiKeyLimitUiStatus(authResult?.limitState),
  };
}

export function buildApiKeyLimitDetails(limitState) {
  return getApiKeyLimitResponseMeta(limitState);
}

export function getApiKeyRemainingText(limitState) {
  return getApiKeyLimitUiRemaining(limitState);
}

export function getApiKeyStatusText(limitState) {
  return getApiKeyLimitUiMessage(limitState);
}

export function getApiKeyResetText(limitState) {
  return getApiKeyLimitUiReset(limitState);
}

export function getRequestApiKeyId(authResult) {
  return getValidatedApiKeyId(authResult);
}

export function getRequestApiKeyName(authResult) {
  return getValidatedApiKeyName(authResult);
}

export function getRequestApiKeyLimitState(authResult) {
  return getApiKeyLimitState(authResult);
}

export function getRequestApiKeyStatus(authResult) {
  return getApiKeyLimitUiStatus(authResult?.limitState);
}

export function getRequestApiKeyTelemetry(authResult) {
  return getApiKeyRequestTelemetry(authResult);
}

export function getRequestApiKeyUi(authResult) {
  return buildApiKeyLimitUiState(authResult);
}

export function getRequestApiKeySummary(authResult) {
  return getApiKeySummaryForLog(authResult);
}

export function getApiKeyQuotaState(authResult) {
  return getApiKeyLimitState(authResult);
}

export function getApiKeyQuotaExceeded(authResult) {
  return hasExceededApiKeyLimit(authResult);
}

export function getApiKeyQuotaMeta(authResult) {
  return getApiKeyLimitResponse(authResult?.limitState);
}
