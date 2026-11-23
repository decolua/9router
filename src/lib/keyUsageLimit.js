// Per-API-key usage limits: DB-backed checks. The /v1 gate lives in
// src/dashboardGuard.js (single choke point for every LLM endpoint); the
// Endpoint page reads snapshots through /api/keys.
import { getApiKeyByKey } from "@/lib/db/repos/apiKeysRepo.js";
import { getApiKeyUsageByPeriods } from "@/lib/db/repos/usageRepo.js";
import { KEY_USAGE_PERIODS } from "@/shared/constants/keyUsageLimit.js";
import { getPeriodStart, getPeriodEnd, hasUsageLimits, findExceededLimit } from "@/shared/utils/keyUsageLimit.js";

/**
 * Current usage for every period the key has a limit on.
 * @returns {Promise<Object<string, {inputTokens, outputTokens, cost, requests, resetAt: string}>>}
 */
export async function getKeyUsageSnapshot(keyRecord, now = new Date()) {
  const limits = keyRecord?.usageLimits;
  if (!keyRecord?.key || !hasUsageLimits(limits)) return {};
  const starts = {};
  for (const period of KEY_USAGE_PERIODS) {
    if (limits[period]) starts[period] = getPeriodStart(period, now);
  }
  const usage = await getApiKeyUsageByPeriods(keyRecord.key, starts);
  for (const period of Object.keys(usage)) {
    usage[period].resetAt = getPeriodEnd(period, now).toISOString();
  }
  return usage;
}

/**
 * Exhausted limit for a raw client key, or null (unknown key, no limits, or under limit).
 * Fails OPEN on DB errors: a broken usage query must not take the gateway down.
 * @returns {Promise<{period, metric, used, max, resetAt, keyName}|null>}
 */
export async function checkKeyUsageLimit(rawKey) {
  if (!rawKey) return null;
  try {
    const record = await getApiKeyByKey(rawKey);
    if (!record || !hasUsageLimits(record.usageLimits)) return null;
    const usage = await getKeyUsageSnapshot(record);
    const exceeded = findExceededLimit(record.usageLimits, usage);
    if (!exceeded) return null;
    return { ...exceeded, resetAt: usage[exceeded.period].resetAt, keyName: record.name || record.id };
  } catch (e) {
    console.warn(`[KEY_LIMIT] usage check failed, allowing request: ${e.message}`);
    return null;
  }
}
