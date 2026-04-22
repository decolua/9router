import crypto from "crypto";

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeMetadata(value) {
  if (!isPlainObject(value)) return {};

  return Object.keys(value)
    .sort((left, right) => left.localeCompare(right))
    .reduce((result, key) => {
      const nextValue = value[key];
      if (nextValue == null) return result;
      if (["string", "number", "boolean"].includes(typeof nextValue)) {
        result[key] = nextValue;
      }
      return result;
    }, {});
}

export function hashSyncToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function createSyncToken({ name, metadata } = {}) {
  const normalizedName = normalizeString(name);
  if (!normalizedName) {
    throw new Error("Token name is required");
  }

  const now = new Date().toISOString();
  const rawToken = `ocs_${crypto.randomBytes(32).toString("base64url")}`;
  const tokenHash = hashSyncToken(rawToken);

  return {
    token: rawToken,
    record: {
      id: crypto.randomUUID(),
      name: normalizedName,
      metadata: normalizeMetadata(metadata),
      tokenHash,
      createdAt: now,
      updatedAt: now,
      lastUsedAt: null,
    },
  };
}

export function verifySyncToken(token, record) {
  if (!normalizeString(token) || !normalizeString(record?.tokenHash)) {
    return false;
  }

  const expected = Buffer.from(record.tokenHash, "hex");
  const actual = Buffer.from(hashSyncToken(token), "hex");

  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

export function extractBearerToken(authorizationHeader) {
  const value = normalizeString(authorizationHeader);
  if (!value) return "";

  const match = /^Bearer\s+(.+)$/iu.exec(value);
  return match ? normalizeString(match[1]) : "";
}

export function findMatchingSyncTokenRecord(records, authorizationHeader) {
  const token = extractBearerToken(authorizationHeader);
  if (!token || !Array.isArray(records)) {
    return null;
  }

  return records.find((record) => verifySyncToken(token, record)) || null;
}

export function toPublicTokenRecord(record) {
  if (!isPlainObject(record)) return null;

  const publicRecord = {
    id: record.id,
    name: record.name,
    metadata: record.metadata,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    lastUsedAt: record.lastUsedAt || null,
  };
  return {
    ...publicRecord,
    metadata: normalizeMetadata(publicRecord.metadata),
  };
}

export function touchSyncTokenRecord(record, usedAt = new Date().toISOString()) {
  if (!isPlainObject(record)) {
    throw new Error("Invalid token record");
  }

  return {
    ...record,
    lastUsedAt: usedAt,
    updatedAt: usedAt,
  };
}

export function normalizeSyncTokenPatch(input) {
  if (!isPlainObject(input)) {
    throw new Error("Invalid token payload");
  }

  const updates = {};

  if (Object.hasOwn(input, "name")) {
    const name = normalizeString(input.name);
    if (!name) throw new Error("Token name is required");
    updates.name = name;
  }

  if (Object.hasOwn(input, "metadata")) {
    if (!isPlainObject(input.metadata)) {
      throw new Error("Invalid token metadata");
    }
    updates.metadata = normalizeMetadata(input.metadata);
  }

  return updates;
}
