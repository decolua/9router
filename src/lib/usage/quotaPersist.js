import { updateProviderConnection } from "@/lib/localDb";
import {
  getQuotaResetUntil, buildModelLockUpdate, getEarliestModelLockUntil,
} from "open-sse/services/accountFallback.js";

/**
 * Persist the latest quota snapshot onto the connection record.
 * Only overwrites quotaInfos when buckets are present — keeps the last good
 * snapshot when the provider transiently returns an auth/empty response.
 */
export async function persistQuotaSnapshot(connection, quotaInfos) {
  if (!Array.isArray(quotaInfos) || quotaInfos.length === 0) return connection;
  try {
    await updateProviderConnection(connection.id, { quotaInfos, updatedAt: new Date().toISOString() });
    return { ...connection, quotaInfos };
  } catch (e) {
    console.warn(`[Usage] ${connection.provider}: failed to persist quota: ${e.message}`);
    return connection;
  }
}

/**
 * Apply an account-level model lock when the account is fully depleted
 * with a future resetAt. Returns the updated connection (for response shaping).
 */
export async function applyQuotaLockIfNeeded(connection) {
  const connWithQuota = { ...connection, quotaInfos: connection.quotaInfos || [] };
  const resetUntil = getQuotaResetUntil(connWithQuota);
  if (!resetUntil) return connection;
  const cooldownMs = new Date(resetUntil).getTime() - Date.now();
  if (cooldownMs <= 0) return connection;
  try {
    await updateProviderConnection(connection.id, buildModelLockUpdate(null, cooldownMs));
    return { ...connection, quotaInfos: connWithQuota.quotaInfos };
  } catch (e) {
    console.warn(`[Usage] ${connection.provider}: failed to apply quota lock: ${e.message}`);
    return connection;
  }
}

/**
 * Compute the earliest model-lock-until timestamp for the response.
 */
export function getUnavailableUntil(connection) {
  return getEarliestModelLockUntil(connection) || null;
}
