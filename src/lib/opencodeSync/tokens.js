import crypto from "crypto";

const VALID_TOKEN_MODES = new Set(["device", "shared"]);

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

export function validateSyncTokenMode(mode) {
  const normalizedMode = normalizeString(mode);
  if (!VALID_TOKEN_MODES.has(normalizedMode)) {
    throw new Error("Invalid token mode");
  }
  return normalizedMode;
}

export function hashSyncToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function createSyncToken({ name, mode, metadata } = {}) {
  const normalizedName = normalizeString(name);
  if (!normalizedName) {
    throw new Error("Token name is required");
  }

  const normalizedMode = validateSyncTokenMode(mode);
  const now = new Date().toISOString();
  const rawToken = `ocs_${crypto.randomBytes(32).toString("base64url")}`;
  const tokenHash = hashSyncToken(rawToken);

  return {
    token: rawToken,
    record: {
      id: crypto.randomUUID(),
      name: normalizedName,
      mode: normalizedMode,
      metadata: normalizeMetadata(metadata),
      tokenHash,
      createdAt: now,
      updatedAt: now,
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

export function toPublicTokenRecord(record) {
  if (!isPlainObject(record)) return null;

  const publicRecord = {
    id: record.id,
    name: record.name,
    mode: record.mode,
    metadata: record.metadata,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
  return {
    ...publicRecord,
    metadata: normalizeMetadata(publicRecord.metadata),
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

  if (Object.hasOwn(input, "mode")) {
    throw new Error("Token mode cannot be updated");
  }

  return updates;
}
