import crypto from "crypto";

const API_KEY_SECRET = process.env.API_KEY_SECRET || "endpoint-proxy-api-key-secret";

/**
 * Generate 6-char random keyId
 */
function generateKeyId() {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Generate CRC (8-char HMAC)
 */
function generateCrc(machineId, keyId) {
  return crypto
    .createHmac("sha256", API_KEY_SECRET)
    .update(machineId + keyId)
    .digest("hex")
    .slice(0, 8);
}

/**
 * Generate API key with machineId embedded
 * Format: {prefix}{machineId}-{keyId}-{crc8}
 * @param {string} machineId - 16-char machine ID
 * @param {string} [prefix] - configurable prefix, "sk-" by default
 * @returns {{ key: string, keyId: string }}
 */
export function generateApiKeyWithMachine(machineId, prefix = "sk-") {
  const keyId = generateKeyId();
  const crc = generateCrc(machineId, keyId);
  const key = `${normalizeKeyPrefix(prefix)}${machineId}-${keyId}-${crc}`;
  return { key, keyId };
}

/**
 * Normalizes an API key prefix:
 * - Only alphanumeric characters [a-zA-Z0-9] are allowed in the prefix.
 * - Hyphen "-" is automatically appended at the end.
 * - Empty or whitespace-only input falls back to the default "sk-".
 */
export function normalizeKeyPrefix(prefix) {
  if (!prefix) return "sk-";
  const clean = String(prefix).trim().replace(/[^a-zA-Z0-9]/g, "");
  if (!clean) return "sk-";
  return `${clean}-`;
}

/**
 * Parse API key and extract machineId + keyId
 * Supports both formats:
 * - New: {prefix}{machineId}-{keyId}-{crc8}
 * - Old: sk-{random8}
 * The prefix is operator-configurable and may itself contain dashes, so the new
 * format is read from the right (crc, keyId, machineId) rather than by position.
 * @param {string} apiKey
 * @returns {{ machineId: string, keyId: string, isNewFormat: boolean } | null}
 */
export function parseApiKey(apiKey) {
  const key = String(apiKey ?? "");
  if (!key.includes("-")) return null;

  // Read the tail rather than counting from the front: whatever prefix the
  // operator set (it may contain dashes), machineId is a 16-char hex segment
  // sitting directly before keyId, then crc closes the key.
  const parts = key.split("-");
  if (parts.length >= 4) {
    const crc = parts[parts.length - 1];
    const keyId = parts[parts.length - 2];
    const machineId = parts[parts.length - 3];
    if (/^[0-9a-f]{16}$/.test(machineId) && crc.length === 8 && keyId) {
      if (generateCrc(machineId, keyId) === crc) {
        return { machineId, keyId, isNewFormat: true };
      }
    }
  }

  // Old format: sk-{random8} = 2 parts
  if (parts.length === 2 && parts[0] === "sk") {
    return { machineId: null, keyId: parts[1], isNewFormat: false };
  }

  return null;
}

/**
 * Verify API key CRC (only for new format)
 * @param {string} apiKey
 * @returns {boolean}
 */
export function verifyApiKeyCrc(apiKey) {
  const parsed = parseApiKey(apiKey);
  if (!parsed) return false;
  
  // Old format doesn't have CRC, always valid if parsed
  if (!parsed.isNewFormat) return true;
  
  // New format already verified in parseApiKey
  return true;
}

/**
 * Check if API key is new format (contains machineId)
 * @param {string} apiKey
 * @returns {boolean}
 */
export function isNewFormatKey(apiKey) {
  const parsed = parseApiKey(apiKey);
  return parsed?.isNewFormat === true;
}

