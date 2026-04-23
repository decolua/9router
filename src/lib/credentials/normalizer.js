/**
 * Input record normalization
 */

function toNonArrayObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value;
}

function pickValue(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

function compactObject(input) {
  const out = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) return out;
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined && value !== null) out[key] = value;
  }
  return out;
}

const LEGACY_STATUS_FIELDS = new Set([
  "testStatus",
  "test_status",
  "lastTested",
  "last_tested",
  "lastError",
  "last_error",
  "lastErrorAt",
  "last_error_at",
  "lastErrorType",
  "last_error_type",
  "rateLimitedUntil",
  "rate_limited_until",
  "errorCode",
  "error_code",
]);

function findLegacyStatusFields(record = {}) {
  return Object.keys(record).filter((key) => LEGACY_STATUS_FIELDS.has(key));
}

function assertNoLegacyStatusFields(record = {}) {
  const legacyFields = findLegacyStatusFields(record);
  if (legacyFields.length === 0) return;

  const error = new Error(
    `Legacy status fields are not supported: ${legacyFields.join(", ")}`,
  );
  error.code = "INVALID_LEGACY_STATUS_FIELDS";
  error.legacyFields = legacyFields;
  throw error;
}

export function normalizeInputRecord(raw) {
  const record = toNonArrayObject(raw);
  if (!record) return null;

  assertNoLegacyStatusFields(record);

  const credentials = toNonArrayObject(record.credentials);
  const secrets = toNonArrayObject(record.secrets);
  const token = toNonArrayObject(record.token);
  const auth = toNonArrayObject(record.auth);
  const identity = toNonArrayObject(record.identity);
  const meta = toNonArrayObject(record.meta);
  const metadata = toNonArrayObject(record.metadata);

  const providerSpecificData = {
    ...compactObject(record.providerSpecificData),
    ...compactObject(record.provider_specific_data),
  };

  const normalized = {
    id: pickValue(record.id, record.connectionId, record.connection_id),
    provider: pickValue(record.provider, record.providerId, record.provider_id),
    authType: pickValue(
      record.authType,
      record.auth_type,
      auth?.type,
      auth?.authType,
      auth?.auth_type,
    ),
    name: pickValue(record.name, identity?.name, identity?.label),
    displayName: pickValue(record.displayName, record.display_name),
    email: pickValue(record.email, identity?.email),
    priority: pickValue(record.priority),
    isActive: pickValue(record.isActive, record.is_active),
    defaultModel: pickValue(record.defaultModel, record.default_model),
    globalPriority: pickValue(record.globalPriority, record.global_priority),
    accessToken: pickValue(
      record.accessToken,
      record.access_token,
      credentials?.accessToken,
      credentials?.access_token,
      secrets?.accessToken,
      secrets?.access_token,
      token?.accessToken,
      token?.access_token,
    ),
    refreshToken: pickValue(
      record.refreshToken,
      record.refresh_token,
      credentials?.refreshToken,
      credentials?.refresh_token,
      secrets?.refreshToken,
      secrets?.refresh_token,
      token?.refreshToken,
      token?.refresh_token,
    ),
    idToken: pickValue(
      record.idToken,
      record.id_token,
      credentials?.idToken,
      credentials?.id_token,
      secrets?.idToken,
      secrets?.id_token,
      token?.idToken,
      token?.id_token,
    ),
    apiKey: pickValue(
      record.apiKey,
      record.api_key,
      credentials?.apiKey,
      credentials?.api_key,
      secrets?.apiKey,
      secrets?.api_key,
      auth?.apiKey,
      auth?.api_key,
    ),
    expiresAt: pickValue(
      record.expiresAt,
      record.expires_at,
      credentials?.expiresAt,
      credentials?.expires_at,
      secrets?.expiresAt,
      secrets?.expires_at,
      token?.expiresAt,
      token?.expires_at,
    ),
    expiresIn: pickValue(
      record.expiresIn,
      record.expires_in,
      credentials?.expiresIn,
      credentials?.expires_in,
      secrets?.expiresIn,
      secrets?.expires_in,
      token?.expiresIn,
      token?.expires_in,
    ),
    tokenType: pickValue(
      record.tokenType,
      record.token_type,
      credentials?.tokenType,
      credentials?.token_type,
      secrets?.tokenType,
      secrets?.token_type,
      token?.tokenType,
      token?.token_type,
    ),
    scope: pickValue(
      record.scope,
      credentials?.scope,
      secrets?.scope,
      token?.scope,
    ),
    projectId: pickValue(
      record.projectId,
      record.project_id,
      credentials?.projectId,
      credentials?.project_id,
      secrets?.projectId,
      secrets?.project_id,
      metadata?.projectId,
      metadata?.project_id,
      meta?.projectId,
      meta?.project_id,
    ),
    routingStatus: pickValue(record.routingStatus, record.routing_status),
    quotaState: pickValue(record.quotaState, record.quota_state),
    healthStatus: pickValue(record.healthStatus, record.health_status),
    authState: pickValue(record.authState, record.auth_state),
    reasonCode: pickValue(record.reasonCode, record.reason_code),
    reasonDetail: pickValue(record.reasonDetail, record.reason_detail),
    nextRetryAt: pickValue(record.nextRetryAt, record.next_retry_at),
    resetAt: pickValue(record.resetAt, record.reset_at),
    lastCheckedAt: pickValue(record.lastCheckedAt, record.last_checked_at),
    usageSnapshot: pickValue(record.usageSnapshot, record.usage_snapshot),
    version: pickValue(record.version),
    lastUsedAt: pickValue(record.lastUsedAt, record.last_used_at),
    consecutiveUseCount: pickValue(
      record.consecutiveUseCount,
      record.consecutive_use_count,
    ),
    backoffLevel: pickValue(record.backoffLevel, record.backoff_level),
    providerSpecificData: {
      ...providerSpecificData,
      ...compactObject(metadata),
      ...compactObject(meta),
    },
  };

  if (normalized.routingStatus === undefined && normalized.quotaState === "ok") {
    normalized.routingStatus = "eligible";
  }

  if (
    normalized.reasonCode === undefined &&
    normalized.routingStatus === "exhausted"
  ) {
    normalized.reasonCode = "quota_exhausted";
  }

  if (Object.keys(normalized.providerSpecificData).length === 0) {
    delete normalized.providerSpecificData;
  }

  return normalized;
}

export function extractInputRecords(payload) {
  if (Array.isArray(payload)) return payload;

  const obj = toNonArrayObject(payload);
  if (!obj) return null;

  const candidates = [
    obj.credentials,
    obj.entries,
    obj.items,
    obj.connections,
    obj.providerConnections,
    obj.data,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }

  return null;
}
