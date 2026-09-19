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
import { BACKUPS_DIR, ensureDirs } from "./paths.js";
import { timestampSlug, getAppVersion } from "./version.js";

const KEEP_BACKUPS = 3;

// Tables excluded from safety backups (large, non-critical, reproducible).
const BACKUP_EXCLUDE_TABLES = ["requestDetails"];

export function makeBackupDir(label) {
  ensureDirs();
  const ver = getAppVersion();
  const slug = `${label}-${ver}-${timestampSlug()}`;
  const dir = path.join(BACKUPS_DIR, slug);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function backupFile(srcPath, destDir, destName = null) {
  if (!fs.existsSync(srcPath)) return null;
  const name = destName || path.basename(srcPath);
  const dest = path.join(destDir, name);
  fs.copyFileSync(srcPath, dest);
  return dest;
}

// Lightweight DB backup: create a fresh SQLite file containing every table
// EXCEPT the excluded ones (plus explicit indexes), so a multi-hundred-MB DB
// backs up as a few MB regardless of the observability log size.
//
// Two implementations:
// - Native drivers (bun:sqlite / better-sqlite3 / node:sqlite): ATTACH an
//   empty on-disk file and INSERT SELECT into it.
// - sql.js fallback: ATTACH is USELESS there — the "filesystem" is sql.js's
//   in-memory Emscripten FS, so an attached file never reaches real disk (and
//   in practice ATTACH throws "unable to open database"). Build the backup in
//   a fresh in-memory sql.js DB, copy tables row-by-row through the adapter's
//   public API, and export the buffer to a real file (T1.4 H-2).
// Failures are NOT swallowed here — they propagate so callers can report an
// explicit warning that no safety backup exists.
export async function backupDbLite(adapter, destDir, destName = "data.sqlite") {
  const dest = path.join(destDir, destName);
  try { fs.rmSync(dest, { force: true }); } catch {}
  const excluded = new Set(BACKUP_EXCLUDE_TABLES);

  if (adapter.driver === "sql.js") return backupViaExport(adapter, dest, excluded);

  const escaped = dest.replace(/'/g, "''");

  adapter.exec(`ATTACH DATABASE '${escaped}' AS bak`);
  try {
    const tables = copyableTables(adapter, excluded);

    adapter.transaction(() => {
      for (const t of tables) {
        // Recreate table structure in backup DB, then copy rows.
        const createSql = t.sql.replace(/CREATE TABLE\s+/i, "CREATE TABLE bak.");
        adapter.exec(createSql);
        adapter.exec(`INSERT INTO bak.${t.name} SELECT * FROM main.${t.name}`);
      }
      // Explicit indexes too (e.g. migration-owned idx_uh_event — partial
      // unique index not re-created elsewhere; losing it degrades dedup).
      for (const t of copyableIndexes(adapter, excluded)) {
        const createSql = t.sql.replace(/CREATE( UNIQUE)? INDEX /i, "CREATE$1 INDEX bak.");
        try { adapter.exec(createSql); }
        catch (e) { console.warn(`[DB][backup] ⚠️ WARNING failed to copy index ${t.name}: ${e.message}`); }
      }
    });
  } finally {
    try { adapter.exec("DETACH DATABASE bak"); } catch {}
  }
  return dest;
}

function copyableTables(adapter, excluded) {
  return adapter
    .all(`SELECT name, sql FROM main.sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`)
    .filter((t) => !excluded.has(t.name));
}

// Explicit (non-auto) indexes whose target table is not excluded.
function copyableIndexes(adapter, excluded) {
  return adapter
    .all(`SELECT name, sql FROM main.sqlite_master WHERE type='index' AND sql IS NOT NULL`)
    .filter((t) => {
      const m = /ON\s+"?(\w+)"?/i.exec(t.sql || "");
      return !(m && excluded.has(m[1]));
    });
}

async function backupViaExport(adapter, dest, excluded) {
  const { default: initSqlJs } = await import("sql.js");
  const SQL = await initSqlJs();
  const bak = new SQL.Database();
  try {
    for (const t of copyableTables(adapter, excluded)) {
      bak.run(t.sql);
      const rows = adapter.all(`SELECT * FROM main.${t.name}`);
      if (!rows.length) continue;
      const cols = Object.keys(rows[0]);
      const stmt = bak.prepare(
        `INSERT INTO "${t.name}" (${cols.map((c) => `"${c}"`).join(",")}) VALUES (${cols.map(() => "?").join(",")})`
      );
      try {
        for (const r of rows) {
          const vals = cols.map((c) => (r[c] === undefined ? null : r[c]));
          if (!stmt.run(vals)) throw new Error(`[DB][backup] failed copying row into ${t.name}`);
        }
      } finally {
        stmt.free();
      }
    }
    for (const t of copyableIndexes(adapter, excluded)) {
      try { bak.run(t.sql); }
      catch (e) { console.warn(`[DB][backup] ⚠️ WARNING failed to copy index ${t.name}: ${e.message}`); }
    }
    const buf = Buffer.from(bak.export());
    if (!buf.length) throw new Error("[DB][backup] sql.js backup exported an empty buffer");
    fs.writeFileSync(dest, buf);
    if (!fs.existsSync(dest) || fs.statSync(dest).size === 0) {
      throw new Error(`[DB][backup] backup file was not written to disk: ${dest}`);
    }
  } finally {
    try { bak.close(); } catch {}
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
