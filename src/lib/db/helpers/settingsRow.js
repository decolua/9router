import { qGet, qRun } from "../query.js";

export function settingsColumnsSync(db) {
  try {
    return new Set(db.all("PRAGMA table_info(settings)").map((c) => c.name));
  } catch {
    return new Set();
  }
}

export async function settingsColumnsPostgres(db) {
  const { qAll } = await import("../query.js");
  const cols = await qAll(
    db,
    `SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ?`,
    ["settings"],
  );
  return new Set(cols.map((r) => r.name));
}

export function readSettingsDataSync(db) {
  const cols = settingsColumnsSync(db);
  if (cols.has("orgId")) {
    const row = db.get("SELECT data FROM settings LIMIT 1");
    return row?.data ?? null;
  }
  if (cols.has("id")) {
    const row = db.get("SELECT data FROM settings WHERE id = 1");
    return row?.data ?? null;
  }
  return null;
}

export async function readSettingsDataPostgres(db) {
  const cols = await settingsColumnsPostgres(db);
  if (cols.has("orgId")) {
    const row = await qGet(db, `SELECT data FROM settings LIMIT 1`);
    return row?.data ?? null;
  }
  if (cols.has("id")) {
    const row = await qGet(db, `SELECT data FROM settings WHERE id = 1`);
    return row?.data ?? null;
  }
  return null;
}

export function writeSettingsDataSync(db, serialized, { orgId = "bootstrap" } = {}) {
  const cols = settingsColumnsSync(db);
  if (cols.has("orgId")) {
    db.run(
      "INSERT INTO settings(orgId, data) VALUES(?, ?) ON CONFLICT(orgId) DO UPDATE SET data = excluded.data",
      [orgId, serialized],
    );
    return;
  }
  if (cols.has("id")) {
    db.run(
      "INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data",
      [serialized],
    );
  }
}

export async function writeSettingsDataPostgres(db, serialized, { orgId = "bootstrap" } = {}) {
  const cols = await settingsColumnsPostgres(db);
  if (cols.has("orgId")) {
    await qRun(
      db,
      `INSERT INTO settings("orgId", data) VALUES(?, ?) ON CONFLICT("orgId") DO UPDATE SET data = excluded.data`,
      [orgId, serialized],
    );
    return;
  }
  if (cols.has("id")) {
    await qRun(
      db,
      `INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
      [serialized],
    );
  }
}
