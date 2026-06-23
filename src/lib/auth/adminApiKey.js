import crypto from "node:crypto";
import { getSettings, updateSettings } from "@/lib/localDb";

const ADMIN_KEY_PREFIX = "9r-admin-";

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
  return `${ADMIN_KEY_PREFIX}${crypto.randomBytes(24).toString("base64url")}`;
}

export function extractAdminApiKey(request) {
  const authHeader = request.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) return authHeader.slice(7).trim();
  return request.headers.get("x-admin-api-key")?.trim() || "";
}

export async function verifyAdminApiKey(key) {
  if (!key) return false;
  const settings = (await getSettings()) || {};
  const storedHash = settings.adminApiKeyHash;
  if (!storedHash) return false;
  return timingSafeEqualString(hashAdminKey(key), storedHash);
}

export async function requireAdminApiKey(request) {
  const key = extractAdminApiKey(request);
  return await verifyAdminApiKey(key);
}

export async function getAdminApiKeyStatus() {
  const settings = (await getSettings()) || {};
  return {
    configured: Boolean(settings.adminApiKeyHash),
    createdAt: settings.adminApiKeyCreatedAt || null,
    updatedAt: settings.adminApiKeyUpdatedAt || null,
  };
}

export async function createOrRotateAdminApiKey(now = new Date()) {
  const settings = (await getSettings()) || {};
  const timestamp = now.toISOString();
  const key = generateAdminApiKey();
  const updates = {
    adminApiKeyHash: hashAdminKey(key),
    adminApiKeyCreatedAt: settings.adminApiKeyCreatedAt || timestamp,
    adminApiKeyUpdatedAt: timestamp,
  };
  await updateSettings(updates);
  return {
    key,
    status: {
      configured: true,
      createdAt: updates.adminApiKeyCreatedAt,
      updatedAt: updates.adminApiKeyUpdatedAt,
    },
  };
}
