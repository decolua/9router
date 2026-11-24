import { isKeyBudget } from "../../../shared/utils/keyBudget.js";
import { periodsSql, periodIds, withinWindows, incrementWindows, blockedWindows } from "./requestWindowSql.js";

function micros(input, output, policy) {
  return Number((BigInt(input) * BigInt(policy.inputRate) + BigInt(output) * BigInt(policy.outputRate) + 999999n) / 1000000n);
}

export const BUDGET_REQUEST_TIMEOUT_MS = 300_000;
// The upstream deadline starts before admission. A crashed worker's slot
// survives slightly longer than that deadline, without releasing its money.
const SLOT_LEASE_MS = BUDGET_REQUEST_TIMEOUT_MS + 30_000;
const MINUTE_MS = 60_000;

function windowAt(now) {
  const start = now - now % MINUTE_MS;
  return {
    minuteStart: new Date(start).toISOString(),
    minuteEnd: new Date(start + MINUTE_MS).toISOString(),
    leaseCutoff: new Date(now - SLOT_LEASE_MS).toISOString(),
  };
}

// One definition for both enforcement and the management balance endpoint.
// Settlement replaces the reserved tokens in the minute of admission, even
// if the provider finishes in a later minute.
const totalsSql = `SELECT COUNT(*) AS requests,
  COUNT(CASE WHEN actualMicros IS NULL THEN 1 END) AS holds,
  COALESCE(SUM(CASE WHEN actualMicros IS NULL THEN reservedTokens END),0) AS heldTokens,
  COALESCE(SUM(CASE WHEN actualMicros IS NULL THEN reservedMicros END),0) AS heldMicros,
  COALESCE(SUM(inputTokens+outputTokens),0) AS usedTokens, COALESCE(SUM(actualMicros),0) AS usedMicros,
  COALESCE(SUM(CASE WHEN createdAt>=? AND createdAt<? THEN COALESCE(inputTokens+outputTokens,reservedTokens) END),0) AS minuteTokens,
  COUNT(CASE WHEN state='pending' AND createdAt>? THEN 1 END) AS activeRequests
  FROM budgetReservations WHERE keyId=?`;

export function reserveBudget(db, requestId, keyId, policy, maxOutput, now = Date.now(), keySnapshot = null) {
  if (db.driver === "sql.js") return { status: 503, code: "quota_storage_unavailable" };
  if (!isKeyBudget(policy) || !Number.isSafeInteger(maxOutput) || maxOutput < 1 || maxOutput > 1e8) {
    return { status: 400, code: "invalid_reservation" };
  }
  const tokens = policy.inputTokenCeiling + maxOutput;
  if (policy.tpmLimit != null && tokens > policy.tpmLimit) return { status: 422, code: "request_exceeds_tpm_limit" };
  const cost = micros(policy.inputTokenCeiling, maxOutput, policy);
  const snapshot = JSON.stringify(policy);
  const stamp = new Date(now).toISOString();
  const { minuteStart, minuteEnd, leaseCutoff } = windowAt(now);
  const args = [minuteStart, minuteEnd, leaseCutoff, keyId];
  // Recheck the exact key generation and allow list used during async model resolution.
  const accessSql = keySnapshot ? " AND key_version=? AND accessRestricted=? AND (accessRestricted=0 OR accessAllow=?) AND allowedConnections IS ?" : "";
  const accessArgs = keySnapshot ? [keySnapshot.keyVersion, Number(keySnapshot.access.restricted), JSON.stringify(keySnapshot.access.allow),
    keySnapshot.allowedConnections?.length ? JSON.stringify(keySnapshot.allowedConnections) : null] : [];
  const eligible = `id=? AND isActive=1 AND (expiresAt IS NULL OR expiresAt>?) AND budget=?${accessSql}`;
  const eligibilityArgs = [keyId, stamp, snapshot, ...accessArgs];
  const periods = periodIds(now);
  // Start with a write statement: SQLite takes its writer lock before
  // evaluating the admission checks. A denied call inserts no row.
  return db.transaction(() => {
    const result = db.run(`INSERT INTO budgetReservations
      (requestId,keyId,createdAt,state,policy,reservedTokens,reservedMicros)
      SELECT ?,id,?,'pending',?,?,? FROM apiKeys CROSS JOIN (${totalsSql}) CROSS JOIN ${periodsSql}
      WHERE ${eligible} AND ${withinWindows}
      AND NOT EXISTS (SELECT 1 FROM budgetReservations WHERE keyId=apiKeys.id AND state='overrun' AND policy=apiKeys.budget)
      AND usedTokens+heldTokens<=? AND usedMicros+heldMicros<=?
      AND (? IS NULL OR minuteTokens<=?) AND (? IS NULL OR activeRequests<?)
      ON CONFLICT(requestId) DO NOTHING`,
      [requestId, stamp, snapshot, tokens, cost, ...args, ...periods, ...eligibilityArgs,
        policy.tokenLimit - tokens, policy.costLimitMicros - cost,
        policy.tpmLimit ?? null, (policy.tpmLimit ?? 0) - tokens, policy.concurrencyLimit ?? null, policy.concurrencyLimit ?? null]);
    if (result.changes) {
      db.run(`UPDATE apiKeys SET ${incrementWindows} FROM ${periodsSql} WHERE id=?`, [...periods, keyId]);
      return { status: 200 };
    }
    if (db.get("SELECT 1 FROM budgetReservations WHERE requestId=?", [requestId])) return { status: 409, code: "duplicate_reservation" };
    const key = db.get(`SELECT * FROM apiKeys WHERE ${eligible}`, eligibilityArgs);
    if (!key) return { status: 403, code: "key_policy_changed" };
    if (db.get("SELECT 1 FROM budgetReservations WHERE keyId=? AND state='overrun' AND policy=? LIMIT 1", [keyId, snapshot])) {
      return { status: 503, code: "model_budget_overrun" };
    }
    const blocked = blockedWindows(key, now);
    if (blocked) return { ...blocked, code: "key_request_limit" };
    const t = db.get(totalsSql, args);
    if (t.usedTokens + t.heldTokens > policy.tokenLimit - tokens || t.usedMicros + t.heldMicros > policy.costLimitMicros - cost) {
      return { status: 429, code: "insufficient_key_budget" };
    }
    if (policy.tpmLimit != null && t.minuteTokens > policy.tpmLimit - tokens) {
      return { status: 429, code: "key_tpm_limit", retryAfter: Math.ceil((MINUTE_MS - now % MINUTE_MS) / 1000) };
    }
    return { status: 429, code: "key_concurrency_limit", retryAfter: 1 };
  });
}

export function validBudgetUsage(usage) {
  const i = usage?.prompt_tokens, o = usage?.completion_tokens;
  return [i, o].every(n => Number.isSafeInteger(n) && n >= 0 && n <= 1e9) &&
    (usage.total_tokens === undefined || usage.total_tokens === i + o);
}

export function settleBudget(db, requestId, usage) {
  const row = db.get("SELECT policy,reservedTokens FROM budgetReservations WHERE requestId=? AND state='pending'", [requestId]);
  if (!row) return false;
  const i = usage?.prompt_tokens, o = usage?.completion_tokens;
  if (!validBudgetUsage(usage)) {
    return !!db.run("UPDATE budgetReservations SET state='unconfirmed' WHERE requestId=? AND state='pending'", [requestId]).changes;
  }
  const policy = JSON.parse(row.policy);
  const state = i > policy.inputTokenCeiling || o > row.reservedTokens - policy.inputTokenCeiling ? "overrun" : "settled";
  return !!db.run(`UPDATE budgetReservations SET state=?,inputTokens=?,outputTokens=?,actualMicros=?
    WHERE requestId=? AND state='pending'`, [state, i, o, micros(i, o, policy), requestId]).changes;
}

export function getBudgetBalance(db, keyId, now = Date.now()) {
  const key = db.get("SELECT budget FROM apiKeys WHERE id=?", [keyId]);
  if (!key) return null;
  const budget = key.budget && JSON.parse(key.budget);
  const { minuteStart, minuteEnd, leaseCutoff } = windowAt(now);
  const totals = db.get(totalsSql, [minuteStart, minuteEnd, leaseCutoff, keyId]);
  return { budget, ...totals, minuteResetsAt: minuteEnd,
    remainingMinuteTokens: budget?.tpmLimit == null ? null : Math.max(0, budget.tpmLimit - totals.minuteTokens),
    availableSlots: budget?.concurrencyLimit == null ? null : Math.max(0, budget.concurrencyLimit - totals.activeRequests),
    remainingTokens: budget ? Math.max(0, budget.tokenLimit - totals.usedTokens - totals.heldTokens) : null,
    remainingMicros: budget ? Math.max(0, budget.costLimitMicros - totals.usedMicros - totals.heldMicros) : null };
}

// Keep admission and synchronous stream settlement on the same connection.
export async function getBudgetLedger() {
  const { getAdapter } = await import("../driver.js");
  const db = await getAdapter();
  return {
    reserve: (...args) => reserveBudget(db, ...args),
    settle: (requestId, usage) => settleBudget(db, requestId, usage),
    actualMicros: requestId => db.get("SELECT actualMicros FROM budgetReservations WHERE requestId=?", [requestId]).actualMicros,
  };
}
