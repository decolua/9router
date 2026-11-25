import { deleteAuditEntriesThrough } from "./repos/auditRepo.js";

export const DAY_MS = 86400000;
export const validRetention = days => Number.isSafeInteger(days) && days >= 1 && days <= 3650;

export function activeDebugUntil(db, now = Date.now()) {
  const until = db.get("SELECT json_extract(data, '$.debugBodyLoggingUntil') AS until FROM settings WHERE id=1")?.until;
  return typeof until === "string" && Date.parse(until) > now ? until : null;
}

// End or replace a live capture window without extending previously written bodies.
export function endCaptureWindow(db, now = Date.now()) {
  const old = activeDebugUntil(db, now);
  if (old) db.run("UPDATE requestDetails SET bodyExpiresAt=? WHERE bodyExpiresAt=?",
    [new Date(now + DAY_MS).toISOString(), new Date(Date.parse(old) + DAY_MS).toISOString()]);
}

export function cleanLogs(db, now = Date.now()) {
  db.run(`UPDATE requestDetails SET data=json_remove(data,'$.request','$.providerRequest','$.providerResponse','$.response'),
    bodyExpiresAt=NULL WHERE bodyExpiresAt <= ?`, [new Date(now).toISOString()], { saveOnlyIfChanged: true });
  const days = db.get("SELECT json_extract(data, '$.auditRetentionDays') AS days FROM settings WHERE id=1")?.days;
  deleteAuditEntriesThrough(db, new Date(now - (validRetention(days) ? days : 180) * DAY_MS).toISOString());
}

export function startLogMaintenance(db) {
  cleanLogs(db);
  const timer = setInterval(() => {
    try { cleanLogs(db); } catch { console.warn("[logs] Retention cleanup failed"); }
  }, 60_000);
  timer.unref?.();
  return timer;
}
