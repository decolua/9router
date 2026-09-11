// Consent audit log — immutable, append-only records of DLP consent changes.
// By design there is NO clear/delete/prune: the log is evidence and is never
// modified after insertion (except inside full importDb restore, which
// replaces the whole DB from a payload).
import { getAdapter } from "../driver.js";

const VALID_ACTIONS = new Set(["accepted", "revoked"]);

export async function logConsent({ user = "anonymous", hostname = "", action } = {}) {
  if (!VALID_ACTIONS.has(action)) return null;
  try {
    const db = await getAdapter();
    const createdAt = new Date().toISOString();
    db.run(
      `INSERT INTO consent_log(user, hostname, action, createdAt) VALUES(?, ?, ?, ?)`,
      [String(user).slice(0, 200), String(hostname).slice(0, 200), action, createdAt],
    );
    return { user: String(user).slice(0, 200), hostname: String(hostname).slice(0, 200), action, createdAt };
  } catch (err) {
    // Fail-open: audit logging must never break the settings save path.
    console.error("[consent_log] failed to write:", err.message);
    return null;
  }
}

// Returns entries newest-first. `limit` only bounds the response size —
// nothing is ever deleted from the table.
export async function getConsentLog({ limit } = {}) {
  try {
    const db = await getAdapter();
    const safe = Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 10000) : null;
    const rows = safe
      ? db.all(`SELECT * FROM consent_log ORDER BY id DESC LIMIT ?`, [safe])
      : db.all(`SELECT * FROM consent_log ORDER BY id DESC`);
    return rows.map((r) => ({
      id: r.id,
      user: r.user,
      hostname: r.hostname,
      action: r.action,
      createdAt: r.createdAt,
    }));
  } catch (err) {
    console.error("[consent_log] failed to read:", err.message);
    return [];
  }
}