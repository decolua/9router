// Retention runs during driver startup; load the driver only for standalone requests.
async function auditDatabase() {
  const { getAdapter } = await import("../driver.js");
  return getAdapter();
}

export async function insertAuditEntry({ actorRole, actor, action, target, result, ip, detail }) {
  const db = await auditDatabase();
  db.run("INSERT INTO auditLog(timestamp,actorRole,actor,action,target,result,ip,detail) VALUES(?,?,?,?,?,?,?,?)",
    [new Date().toISOString(), actorRole, actor, action, target, result, ip, JSON.stringify(detail)]);
}

export async function listAuditEntries({ startDate, endDate, action, page, pageSize }) {
  const where = [], args = [];
  if (startDate) { where.push("timestamp >= ?"); args.push(startDate); }
  if (endDate) { where.push("timestamp <= ?"); args.push(endDate); }
  if (action) { where.push("action = ?"); args.push(action); }
  const filter = where.length ? " WHERE " + where.join(" AND ") : "";
  const db = await auditDatabase();
  return db.all("SELECT * FROM auditLog" + filter + " ORDER BY timestamp DESC,id DESC LIMIT ? OFFSET ?",
    [...args, pageSize + 1, (page - 1) * pageSize]);
}

export function deleteAuditEntriesThrough(db, cutoff) {
  db.run("DELETE FROM auditLog WHERE timestamp <= ?", [cutoff], { saveOnlyIfChanged: true });
}
