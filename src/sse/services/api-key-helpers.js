import {
  extractApiKey,
  getLimitStatusForUi,
  getApiKeyLimitSnapshot,
  getApiKeyLimitState,
  getApiKeyValue,
  getApiKeyFailurePayload,
  authFailureToErrorResponse,
  buildApiKeyError,
} from "./api-key-validation.js";

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

// buildLimitExceededMessage is private in api-key-validation.js, replicate for this module's use
function buildLimitExceededMessage(limitState) {
  return `${limitState.metricType} ${limitState.currentValue}/${limitState.limitValue} exceeded for ${limitState.periodType} window`;
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
