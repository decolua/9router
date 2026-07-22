const VALIDATION_PATTERNS = [
  /validation_required/i,
  /verify your account/i,
];

export const MODEL_ERROR_PREFIX = "modelError_";
export const MODEL_ERROR_CODE_PREFIX = "modelErrorCode_";

export function getModelErrorKey(model) {
  return `${MODEL_ERROR_PREFIX}${model || "__all"}`;
}

export function getModelErrorCodeKey(model) {
  return `${MODEL_ERROR_CODE_PREFIX}${model || "__all"}`;
}

export function isAntigravityValidationRequired(errorText) {
  const text = typeof errorText === "string" ? errorText : JSON.stringify(errorText || "");
  return VALIDATION_PATTERNS.some((pattern) => pattern.test(text));
}

export function extractAntigravityValidationUrl(errorText) {
  const text = typeof errorText === "string" ? errorText : JSON.stringify(errorText || "");
  const match = text.match(/"validation_url"\s*:\s*"([^"]+)"/i);
  if (!match?.[1]) return null;

  try {
    const url = new URL(match[1].replace(/\\u0026/g, "&"));
    return url.protocol === "https:" && url.hostname === "accounts.google.com"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

export function classifyAntigravityRuntimeError(errorText, status = null) {
  const text = typeof errorText === "string" ? errorText : JSON.stringify(errorText || "");
  if (isAntigravityValidationRequired(text)) return "account blocked";
  if (status === 429 || /quota|capacity|resource_exhausted/i.test(text)) return "runtime limit";
  return "temporarily unavailable";
}

export function applyAntigravityRuntimeLimits(connection, usage, now = Date.now()) {
  if (connection?.provider !== "antigravity" || !usage?.quotas) return usage;

  const validationRequired = connection.antigravityValidationRequired === true;

  for (const [modelKey, quota] of Object.entries(usage.quotas)) {
    const resetAt = connection[`modelLock_${modelKey}`] || connection.modelLock___all;
    const resetAtMs = resetAt ? new Date(resetAt).getTime() : NaN;
    const lockActive = Number.isFinite(resetAtMs) && resetAtMs > now;
    if (!validationRequired && !lockActive) continue;

    const modelError = connection[getModelErrorKey(modelKey)]
      || connection[getModelErrorKey(null)]
      || connection.lastError
      || "";
    const modelErrorCode = connection[getModelErrorCodeKey(modelKey)]
      || connection[getModelErrorCodeKey(null)]
      || connection.errorCode
      || null;

    quota.reportedRemainingPercentage = quota.remainingPercentage;
    quota.reportedResetAt = quota.resetAt;
    quota.remainingPercentage = 0;
    quota.used = quota.total;
    quota.resetAt = validationRequired ? null : resetAt;
    quota.runtimeLimited = true;
    quota.runtimeLimitLabel = validationRequired
      ? "account blocked"
      : classifyAntigravityRuntimeError(modelError, modelErrorCode);
    quota.runtimeLimitReason = modelError.slice(0, 240);
    quota.runtimeActionUrl = validationRequired ? connection.antigravityValidationUrl || null : null;
  }

  return usage;
}
