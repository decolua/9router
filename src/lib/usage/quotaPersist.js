import { updateProviderConnection } from "@/lib/localDb";
import { parseQuotaData } from "open-sse/services/usage/normalize.js";
import {
  getQuotaResetUntil, buildModelLockUpdate, getEarliestModelLockUntil,
} from "open-sse/services/accountFallback.js";

/**
 * Persist the latest quota snapshot onto the connection record.
 * Normalizes the raw provider usage response to the `quotaInfos` array shape
 * (the shape `getQuotaResetUntil` expects). Only overwrites quota fields when
 * we actually got buckets back — keeps the last good snapshot when a provider
 * transiently returns an auth/empty response.
 */
export async function persistQuotaSnapshot(connection, usage) {
  if (!usage) return connection;
  const quotaInfos = parseQuotaData(connection.provider, usage);
  // Only overwrite quotaInfos when at least one bucket has a real limit.
  // Claude's auth-error path returns { message } and parseQuotaData synthesizes
  // a length-1 {name:"error", total:0} bucket from it; persisting that would
  // clobber the last-known-good snapshot. quotaMessage is still updated below.
  const hasRealBuckets = quotaInfos.some((q) => Number(q?.total) > 0);
  try {
    const update = {
      quotaUpdatedAt: new Date().toISOString(),
      quotaPlan: usage?.plan ?? null,
      quotaMessage: usage?.message ?? null,
    };
    if (hasRealBuckets) {
      update.quotaInfos = quotaInfos;
    }
    await updateProviderConnection(connection.id, update);
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
export async function applyQuotaLockIfNeeded(connection, usage) {
  if (!usage) return connection;
  const quotaInfos = parseQuotaData(connection.provider, usage);
  const connectionWithQuota = { ...connection, quotaInfos };
  const resetUntil = getQuotaResetUntil(connectionWithQuota);
  if (!resetUntil) return connection;
  const cooldownMs = new Date(resetUntil).getTime() - Date.now();
  if (cooldownMs <= 0) return connection;
  try {
    await updateProviderConnection(connection.id, buildModelLockUpdate(null, cooldownMs));
    return { ...connection, quotaInfos };
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
