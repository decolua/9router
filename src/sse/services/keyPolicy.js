// Per-API-key authorization: expiry, model allowlist, RPM/TPM and budget.
//
// One place so every inbound path enforces the same rules, and so a key that is
// out of budget or past its expiry is rejected before any upstream call is made.

import { getApiKeyBySecret, addKeySpend, budgetPeriodMs } from "@/lib/db/index.js";
import { isOverLimit, recordRequest, retryAfterMs, usage } from "./rpmLimiter.js";

const rpmId = (id) => `key:${id}:rpm`;
const tpmId = (id) => `key:${id}:tpm`;

/** Spend counted inside the key's current budget window (0 once it rolls over). */
export function currentSpend(record, now = Date.now()) {
  const periodMs = budgetPeriodMs(record.budgetPeriod);
  const startedAt = record.budgetStartedAt ? Date.parse(record.budgetStartedAt) : null;
  if (periodMs && startedAt && now - startedAt >= periodMs) return 0;
  return record.spend || 0;
}

/**
 * Authorize one request.
 * @returns {{ok: true, record: object} | {ok: false, status: number, error: string}}
 */
export async function authorizeApiKey(apiKey, model, now = Date.now()) {
  const record = await getApiKeyBySecret(apiKey);
  if (!record) return { ok: false, status: 401, error: "Invalid API key" };
  if (!record.isActive) return { ok: false, status: 401, error: "API key is disabled" };

  if (record.expiresAt && Date.parse(record.expiresAt) <= now) {
    return { ok: false, status: 401, error: `API key expired at ${record.expiresAt}` };
  }

  // Empty allowlist == every model.
  if (model && record.models?.length && !record.models.includes(model)) {
    return {
      ok: false,
      status: 403,
      error: `Model "${model}" is not allowed for this API key`,
    };
  }

  if (record.maxBudget != null && record.maxBudget > 0) {
    const spent = currentSpend(record, now);
    if (spent >= record.maxBudget) {
      const window = record.budgetPeriod ? ` for the current ${record.budgetPeriod} period` : "";
      return {
        ok: false,
        status: 429,
        error: `Budget exhausted${window}: $${spent.toFixed(4)} of $${record.maxBudget}`,
      };
    }
  }

  if (record.rpm > 0 && isOverLimit(rpmId(record.id), record.rpm, now)) {
    const wait = Math.ceil((retryAfterMs(rpmId(record.id), record.rpm, now) || 0) / 1000);
    return { ok: false, status: 429, error: `Rate limit: ${record.rpm} requests/min for this API key (retry in ${wait}s)` };
  }

  if (record.tpm > 0 && isOverLimit(tpmId(record.id), record.tpm, now)) {
    const wait = Math.ceil((retryAfterMs(tpmId(record.id), record.tpm, now) || 0) / 1000);
    return { ok: false, status: 429, error: `Token limit: ${record.tpm} tokens/min for this API key (retry in ${wait}s)` };
  }

  // Only the request itself is known up front; tokens are added on completion.
  if (record.rpm > 0) recordRequest(rpmId(record.id), 1, now);

  return { ok: true, record };
}

/**
 * Record what a finished request consumed. Called after a response so TPM and
 * budget reflect real usage. Never throws — accounting must not break a reply.
 */
export async function recordKeyUsage(apiKey, { tokens = 0, cost = 0 } = {}) {
  try {
    if (!apiKey) return;
    const record = await getApiKeyBySecret(apiKey);
    if (!record) return;
    if (tokens > 0 && record.tpm > 0) recordRequest(tpmId(record.id), tokens);
    if (cost > 0) await addKeySpend(apiKey, cost);
  } catch {
    // accounting is best-effort
  }
}

/** Live counters for the dashboard. */
export function keyUsageSnapshot(record, now = Date.now()) {
  return {
    rpmUsed: usage(rpmId(record.id), now),
    tpmUsed: usage(tpmId(record.id), now),
    spendUsed: currentSpend(record, now),
  };
}
