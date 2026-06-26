import crypto from "node:crypto";
import { getSettings, rotateAdminApiKeySettings } from "@/lib/localDb";

const ADMIN_KEY_HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;

function hashAdminKey(key) {
  return `sha256:${crypto.createHash("sha256").update(String(key)).digest("hex")}`;
}

function timingSafeEqualString(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function generateAdminApiKey() {
  return crypto.randomBytes(32).toString("base64url");
}

export function extractAdminApiKey(request) {
  const authHeader = request.headers.get("Authorization")?.trim();
  const bearerMatch = authHeader?.match(/^Bearer\s+(.+)$/i);
  const bearerKey = bearerMatch?.[1]?.trim();
  if (bearerKey) return bearerKey;
  return request.headers.get("x-admin-api-key")?.trim() || "";
}

export async function verifyAdminApiKey(key) {
  if (!key) return false;
  const settings = (await getSettings()) || {};
  const storedHash = settings.adminApiKeyHash;
  if (!ADMIN_KEY_HASH_PATTERN.test(storedHash || "")) return false;
  return timingSafeEqualString(hashAdminKey(key), storedHash);
}

export async function requireAdminApiKey(request) {
  const key = extractAdminApiKey(request);
  return await verifyAdminApiKey(key);
}

export async function getAdminApiKeyStatus() {
  const settings = (await getSettings()) || {};
  return {
    configured: ADMIN_KEY_HASH_PATTERN.test(settings.adminApiKeyHash || ""),
    createdAt: settings.adminApiKeyCreatedAt || null,
    updatedAt: settings.adminApiKeyUpdatedAt || null,
  };
}

export async function createOrRotateAdminApiKey(now = new Date(), { expectedUpdatedAt } = {}) {
  let rotationExpectedUpdatedAt = expectedUpdatedAt;
  if (rotationExpectedUpdatedAt === undefined) {
    const settings = (await getSettings()) || {};
    rotationExpectedUpdatedAt = settings.adminApiKeyUpdatedAt || "";
  }

  return await rotateAdminApiKeySettings({
    now,
    expectedUpdatedAt: rotationExpectedUpdatedAt,
    generateKey: generateAdminApiKey,
    hashKey: hashAdminKey,
  });
}
