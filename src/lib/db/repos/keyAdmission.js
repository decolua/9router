import { REQUEST_WINDOWS as windows } from "../../../shared/utils/requestWindows.js";
import { findVerifiedKey } from "../helpers/keyVerifier.js";
import { periodsSql, periodIds, withinWindows, incrementWindows, blockedWindows } from "./requestWindowSql.js";
import { budgetEndpoint } from "../../../shared/utils/keyBudget.js";

const valid = "key_verifier = ? AND isActive = 1 AND (expiresAt IS NULL OR expiresAt > ?)";
const checkedColumns = ["budget", ...windows.flatMap(w => [w.limit, w.bucket, w.used])].join(", ");
const lookupSql = `SELECT ${checkedColumns} FROM apiKeys WHERE ${valid}`;

// One SQLite UPDATE consumes all enabled windows or none. Older windows are
// rolled forward lazily; an out-of-order timestamp cannot rewind a counter.
const consumeSql = `UPDATE apiKeys SET ${incrementWindows} FROM ${periodsSql}
  WHERE ${valid} AND budget IS NULL AND (${windows.map(w => `${w.limit} IS NOT NULL`).join(" OR ")})
  AND ${withinWindows}`;

function fastDecision(row, budgetPath) {
  if (!row) return { status: 401 };
  // The budget ledger consumes request windows atomically with the reservation.
  if (row.budget) return { status: budgetPath ? 200 : 403 };
  if (windows.every(w => row[w.limit] == null)) return { status: 200 };
  return null;
}

export function admitKey(db, key, now = Date.now(), pathname, consume = true) {
  const stamp = new Date(now).toISOString();
  const budgetPath = budgetEndpoint(pathname);
  const verified = findVerifiedKey(db, key);
  if (verified?.isActive !== 1 || (verified.expiresAt != null && verified.expiresAt <= stamp)) return { status: 401 };
  if (!consume) return { status: verified.budget && !budgetPath ? 403 : 200 };
  const verifier = verified.key_verifier;
  const decision = fastDecision(verified, budgetPath);
  if (decision) return decision;
  if (db.driver === "sql.js") return { status: 503 };

  return db.transaction(() => {
    // First statement in the transaction is a write, not a snapshot read.
    if (db.run(consumeSql, [...periodIds(now), verifier, stamp]).changes) return { status: 200 };
    const row = db.get(lookupSql, [verifier, stamp]);
    const changed = fastDecision(row, budgetPath);
    if (changed) return changed;
    return blockedWindows(row, now);
  });
}
