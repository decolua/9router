import {
  validateApiKey,
  getSettings,
  getApiKeyValidationInfo,
  evaluateApiKeyLimitState,
} from "@/lib/localDb";

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
