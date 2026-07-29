import { v4 as uuidv4 } from "uuid";
import { qAll, qRun } from "../query.js";
import { getAdapter } from "../driver.js";
import { stringifyJson } from "../helpers/jsonCol.js";
import { getRuntimeOrgId } from "../../auth/runtimeUserContext.js";
import { resolveOrgId } from "../helpers/orgScope.js";

export const AUDIT_RETENTION_DAYS = 90;

const PURGE_INTERVAL_MS = 60 * 60 * 1000;
let lastPurgeAt = 0;

function retentionCutoffIso() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - AUDIT_RETENTION_DAYS);
  return d.toISOString();
}

async function maybePurgeOldEvents(db) {
  const now = Date.now();
  if (now - lastPurgeAt < PURGE_INTERVAL_MS) return;
  lastPurgeAt = now;
  await qRun(db, `DELETE FROM auditLogs WHERE timestamp < ?`, [retentionCutoffIso()]);
}

export async function recordAuditEvent(event) {
  try {
    const db = await getAdapter();
    const timestamp = new Date().toISOString();
    const orgId = event.orgId || event.meta?.orgId || getRuntimeOrgId() || (await resolveOrgId());
    await qRun(
      db,
      `INSERT INTO auditLogs(id, orgId, timestamp, action, actorUserId, actorEmail, targetType, targetId, ip, outcome, meta) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        uuidv4(),
        orgId || null,
        timestamp,
        event.action,
        event.actorUserId || null,
        event.actorEmail || null,
        event.targetType || null,
        event.targetId || null,
        event.ip || null,
        event.outcome || "success",
        stringifyJson(event.meta || {}),
      ],
    );
    await maybePurgeOldEvents(db);
  } catch (err) {
    console.warn("[audit] failed to record event:", err?.message || err);
  }
}

export async function getAuditLogs({ limit = 100, offset = 0, orgId } = {}) {
  const db = await getAdapter();
  const resolvedOrg = await resolveOrgId(orgId);
  const params = [];
  let where = "";
  if (resolvedOrg) {
    where = "WHERE orgId = ?";
    params.push(resolvedOrg);
  }
  params.push(Math.min(Math.max(limit, 1), 500), Math.max(offset, 0));
  const rows = await qAll(
    db,
    `SELECT id, orgId, timestamp, action, actorUserId, actorEmail, targetType, targetId, ip, outcome, meta
     FROM auditLogs ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`,
    params,
  );
  return rows.map((row) => ({
    ...row,
    meta: row.meta ? JSON.parse(row.meta) : {},
  }));
}
