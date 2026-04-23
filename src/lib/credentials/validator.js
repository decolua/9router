/**
 * Credential record validation
 */

const ALLOWED_FIELDS = [
  "provider",
  "authType",
  "name",
  "displayName",
  "email",
  "priority",
  "isActive",
  "defaultModel",
  "globalPriority",
  "accessToken",
  "refreshToken",
  "idToken",
  "apiKey",
  "expiresAt",
  "expiresIn",
  "tokenType",
  "scope",
  "projectId",
  "providerSpecificData",
  "routingStatus",
  "quotaState",
  "healthStatus",
  "authState",
  "reasonCode",
  "reasonDetail",
  "nextRetryAt",
  "resetAt",
  "lastCheckedAt",
  "usageSnapshot",
  "version",
  "lastUsedAt",
  "consecutiveUseCount",
  "backoffLevel",
];

function normalizeAuthType(value) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") return value;
  return value.trim().toLowerCase();
}

function hasCredentialPayload(data) {
  return Boolean(
    data.accessToken ||
      data.refreshToken ||
      data.idToken ||
      data.apiKey ||
      data.projectId,
  );
}

function createInvalidRecordError(message) {
  const error = new Error(message);
  error.code = "INVALID_RECORD";
  return error;
}

function inferAuthType(record, normalizedAuthType) {
  if (normalizedAuthType === "apikey" || normalizedAuthType === "oauth") {
    return normalizedAuthType;
  }
  if (normalizedAuthType !== undefined) {
    throw createInvalidRecordError(
      `Unsupported authType: ${record.authType ?? normalizedAuthType}`,
    );
  }

  // If authType is missing/unknown but payload clearly has an API key only,
  // treat it as API key auth for safer upsert behavior.
  const hasApiKey =
    typeof record.apiKey === "string" && record.apiKey.trim() !== "";
  const hasOAuthToken = Boolean(
    record.accessToken || record.refreshToken || record.idToken,
  );
  if (hasApiKey && !hasOAuthToken) return "apikey";

  return "oauth";
}

export function sanitizeCredentialRecord(record) {
  const data = {};

  for (const field of ALLOWED_FIELDS) {
    if (record[field] !== undefined && record[field] !== null) {
      data[field] = record[field];
    }
  }

  data.provider = typeof data.provider === "string" ? data.provider.trim() : "";
  data.authType = inferAuthType(record, normalizeAuthType(data.authType));

  // Restored Codex OAuth credentials should behave like manually added ones.
  // If no canonical status was provided, seed an initial eligible state.
  if (
    data.provider === "codex" &&
    data.authType === "oauth" &&
    data.routingStatus === undefined &&
    data.quotaState === undefined &&
    data.healthStatus === undefined &&
    data.authState === undefined
  ) {
    data.routingStatus = "eligible";
    data.quotaState = "ok";
  }

  if (!data.provider) {
    throw createInvalidRecordError("Credential record is missing provider");
  }

  if (!hasCredentialPayload(data)) {
    throw createInvalidRecordError("Credential record has no credential payload");
  }

  return data;
}
