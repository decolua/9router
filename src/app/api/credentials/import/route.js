import { NextResponse } from "next/server";
import {
  createProviderConnection,
  getProviderConnections,
  updateProviderConnection,
} from "@/lib/localDb";

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

function normalizeAuthType(value) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") return value;
  return value.trim().toLowerCase();
}

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

function findLegacyStatusFields(record = {}) {
  return Object.keys(record).filter((key) => LEGACY_STATUS_FIELDS.has(key));
}

function assertNoLegacyStatusFields(record = {}) {
  const legacyFields = findLegacyStatusFields(record);
  if (legacyFields.length === 0) return;

  const error = new Error(`Legacy status fields are not supported: ${legacyFields.join(", ")}`);
  error.code = "INVALID_LEGACY_STATUS_FIELDS";
  error.legacyFields = legacyFields;
  throw error;
}

function normalizeInputRecord(raw) {
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
    consecutiveUseCount: pickValue(record.consecutiveUseCount, record.consecutive_use_count),
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

  if (normalized.reasonCode === undefined && normalized.routingStatus === "exhausted") {
    normalized.reasonCode = "quota_exhausted";
  }

  if (Object.keys(normalized.providerSpecificData).length === 0) {
    delete normalized.providerSpecificData;
  }

  return normalized;
}

function extractInputRecords(payload) {
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
  if (normalizedAuthType === "apikey" || normalizedAuthType === "oauth") return normalizedAuthType;
  if (normalizedAuthType !== undefined) {
    throw createInvalidRecordError(`Unsupported authType: ${record.authType ?? normalizedAuthType}`);
  }

  // If authType is missing/unknown but payload clearly has an API key only,
  // treat it as API key auth for safer upsert behavior.
  const hasApiKey = typeof record.apiKey === "string" && record.apiKey.trim() !== "";
  const hasOAuthToken = Boolean(record.accessToken || record.refreshToken || record.idToken);
  if (hasApiKey && !hasOAuthToken) return "apikey";

  return "oauth";
}

function sanitizeCredentialRecord(record) {
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

function findExistingConnection(existing, record, sourceId) {
  if (sourceId) {
    const byId = existing.find(
      (conn) =>
        conn.id === sourceId &&
        conn.provider === record.provider &&
        conn.authType === record.authType,
    );
    if (byId) return byId;
  }

  if (record.authType === "oauth" && record.email) {
    const byEmail = existing.find(
      (conn) =>
        conn.provider === record.provider &&
        conn.authType === "oauth" &&
        conn.email === record.email,
    );
    if (byEmail) return byEmail;
  }

  if (record.name) {
    const byName = existing.find(
      (conn) =>
        conn.provider === record.provider &&
        conn.authType === record.authType &&
        conn.name === record.name,
    );
    if (byName) return byName;
  }

  if (record.authType === "oauth") {
    const sameProviderConnections = existing.filter(
      (conn) => conn.provider === record.provider && conn.authType === "oauth",
    );
    if (sameProviderConnections.length === 1) {
      return sameProviderConnections[0];
    }
  }

  return null;
}

export async function POST(request) {
  try {
    const payload = await request.json();

    const inputRecords = extractInputRecords(payload);
    if (!inputRecords) {
      throw new Error("Payload must contain credentials array or equivalent entries");
    }

    const existing = await getProviderConnections();
    let created = 0;
    let updated = 0;
    let skipped = 0;
    const skipReasons = [];

    for (const item of inputRecords) {
      const normalizedItem = normalizeInputRecord(item);
      if (!normalizedItem) {
        skipped += 1;
        skipReasons.push({ code: "INVALID_RECORD", message: "Credential record must be an object" });
        continue;
      }

      const sourceId = typeof normalizedItem.id === "string" ? normalizedItem.id : null;
      let data;
      try {
        data = sanitizeCredentialRecord(normalizedItem);
      } catch (error) {
        skipped += 1;
        skipReasons.push({
          code: error?.code || "INVALID_RECORD",
          message: error?.message || "Credential record is invalid",
        });
        continue;
      }

      const existingConnection = findExistingConnection(existing, data, sourceId);

      if (existingConnection) {
        await updateProviderConnection(existingConnection.id, data);
        const index = existing.findIndex((conn) => conn.id === existingConnection.id);
        if (index !== -1) {
          existing[index] = { ...existing[index], ...data };
        }
        updated += 1;
      } else {
        if (data.authType === "apikey" && !data.name) {
          skipped += 1;
          skipReasons.push({
            code: "INVALID_RECORD",
            message: "API key credential record is missing name",
          });
          continue;
        }

        const createdConnection = await createProviderConnection(data);
        existing.push(createdConnection);
        created += 1;
      }
    }

    return NextResponse.json({
      success: true,
      created,
      updated,
      skipped,
      imported: created + updated,
      skipReasons,
    });
  } catch (error) {
    console.log("Error importing credentials:", error);
    if (error?.code === "INVALID_LEGACY_STATUS_FIELDS") {
      return NextResponse.json(
        {
          error: error.message,
          errorCode: "INVALID_LEGACY_STATUS_FIELDS",
          legacyFields: error.legacyFields || [],
        },
        { status: 400 },
      );
    }

    return NextResponse.json(
      { error: error?.message || "Failed to import credentials" },
      { status: 400 },
    );
  }
}
