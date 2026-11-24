// DB safety backups — taken ONLY before a schema change (see migrate.js).
//
// ⚠️ AGENT/DEV NOTES:
// - Backups are a best-effort safety net before schema migrations. There is NO
//   automated restore path; recovery is manual (copy a backup file back).
// - Backups intentionally EXCLUDE the `requestDetails` table (observability log,
//   auto-pruned, non-critical) so a multi-hundred-MB DB backs up as a few MB.
// - Only the newest KEEP_BACKUPS are kept; older ones are pruned automatically.
import fs from "node:fs";
import path from "node:path";
import { BACKUPS_DIR } from "./paths.js";
import { timestampSlug, getAppVersion } from "./version.js";

const KEEP_BACKUPS = 3;

// Tables excluded from safety backups (large, non-critical, reproducible).
const BACKUP_EXCLUDE_TABLES = ["requestDetails"];

export function makeBackupDir(label) {
  // Create the backup root inside the migration's required-backup guard.
  fs.mkdirSync(BACKUPS_DIR, { recursive: true, mode: 0o700 });
  // A dotted version inside the slug looks like a JWT to the log redactor.
  const ver = getAppVersion().replaceAll(".", "-");
  const slug = `${label}-${ver}-${timestampSlug()}`;
  return fs.mkdtempSync(path.join(BACKUPS_DIR, slug + "-"));
}

export function backupFile(srcPath, destDir, destName = null) {
  if (!fs.existsSync(srcPath)) return null;
  const name = destName || path.basename(srcPath);
  const dest = path.join(destDir, name);
  fs.copyFileSync(srcPath, dest);
  return dest;
}

// Lightweight DB backup via ATTACH: create an empty sqlite file, copy every
// table EXCEPT the excluded ones into it. Avoids duplicating the huge
// observability log, so the backup stays small regardless of DB size.
export function backupDbLite(adapter, destDir, destName = "data.sqlite") {
  const dest = path.join(destDir, destName);
  if (adapter.backupLite) {
    adapter.backupLite(dest, BACKUP_EXCLUDE_TABLES);
    return dest;
  }
  const escaped = dest.replace(/'/g, "''");

  adapter.exec(`ATTACH DATABASE '${escaped}' AS bak`);
  try {
    const excluded = new Set(BACKUP_EXCLUDE_TABLES);
    const tables = adapter
      .all(`SELECT name, sql FROM main.sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY (name='apiKeys') DESC`)
      .filter((t) => !excluded.has(t.name));

    adapter.transaction(() => {
      for (const t of tables) {
        // Recreate table structure in backup DB, then copy rows.
        const createSql = t.sql.replace(/CREATE TABLE\s+/i, "CREATE TABLE bak.");
        adapter.exec(createSql);
        adapter.exec(`INSERT INTO bak.${t.name} SELECT * FROM main.${t.name}`);
      }
      if (tables.some(t => t.name === "apiKeys") &&
          adapter.get("SELECT (SELECT count(*) FROM bak.apiKeys) = (SELECT count(*) FROM main.apiKeys) AS ok").ok !== 1)
        throw new Error("Incomplete gateway key backup");
    });
  } finally {
    try { adapter.exec("DETACH DATABASE bak"); } catch {}
  }
  return dest;
}

export function pruneOldBackups() {
  if (!fs.existsSync(BACKUPS_DIR)) return;
  const entries = fs.readdirSync(BACKUPS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => ({ name: e.name, full: path.join(BACKUPS_DIR, e.name), mtime: fs.statSync(path.join(BACKUPS_DIR, e.name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);

  for (const old of entries.slice(KEEP_BACKUPS)) {
    try { fs.rmSync(old.full, { recursive: true, force: true }); } catch {}
  }
}
