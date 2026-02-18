/**
 * API Key utilities for Worker
 * Supports both formats:
 * - New: sk-{machineId}-{keyId}-{crc8}
 * - Old: sk-{random8}
 */

const API_KEY_SECRET = "endpoint-proxy-api-key-secret";

/**
 * Generate CRC (8-char HMAC) using Web Crypto API
 */
async function generateCrc(machineId, keyId) {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(API_KEY_SECRET);
  const data = encoder.encode(machineId + keyId);

  const key = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign("HMAC", key, data);
  const hashArray = Array.from(new Uint8Array(signature));
  const hashHex = hashArray
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return hashHex.slice(0, 8);
}

/**
 * Parse API key and extract machineId + keyId
 * @param {string} apiKey
 * @returns {Promise<{ machineId: string, keyId: string, isNewFormat: boolean } | null>}
 */
export async function parseApiKey(apiKey) {
  if (!apiKey || !apiKey.startsWith("sk-")) return null;

  const parts = apiKey.split("-");

  // New format: sk-{machineId}-{keyId}-{crc8} = 4 parts
  if (parts.length === 4) {
    const [, machineId, keyId, crc] = parts;

    // Verify CRC
    const expectedCrc = await generateCrc(machineId, keyId);
    if (crc !== expectedCrc) return null;

    return { machineId, keyId, isNewFormat: true };
  }

  // Old format: sk-{random8} = 2 parts
  if (parts.length === 2) {
    return { machineId: null, keyId: parts[1], isNewFormat: false };
  }

  return null;
}

/**
 * Extract API key from request headers
 * Supports both OpenAI format (Authorization: Bearer) and Anthropic format (x-api-key)
 * @param {Request} request
 * @returns {string | null}
 */
export function extractBearerToken(request) {
  // OpenAI SDK format: Authorization: Bearer sk-... (case-insensitive)
  const authHeader = request.headers.get("Authorization");
  if (authHeader) {
    const match = authHeader.match(/^bearer\s+(.+)$/i);
    if (match) {
      return match[1];
    }
  }

  // Anthropic SDK format: x-api-key: sk-...
  const xApiKey = request.headers.get("x-api-key");
  if (xApiKey) {
    return xApiKey;
  }

  return null;
}
