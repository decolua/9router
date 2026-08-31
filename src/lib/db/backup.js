// DB safety backups — taken ONLY before a schema change (see migrate.js).
//
// ⚠️ AGENT/DEV NOTES:
// - Backups are a best-effort safety net before schema migrations. There is NO
//   automated restore path; recovery is manual (`psql < backup.sql`).
// - Backups intentionally EXCLUDE the `requestDetails` table (observability log,
//   auto-pruned, non-critical) so a multi-hundred-MB DB backs up as a few MB.
// - Only the newest KEEP_BACKUPS are kept; older ones are pruned automatically.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { BACKUPS_DIR, ensureDirs } from "./paths.js";
import { timestampSlug, getAppVersion } from "./version.js";
import { getConnectionString } from "./pg.js";

const KEEP_BACKUPS = 3;

// Tables excluded from safety backups (large, non-critical, reproducible).
// Postgres folds unquoted identifiers to lower-case.
const BACKUP_EXCLUDE_TABLES = ["requestdetails"];

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

// Postgres backup via `pg_dump` (plain SQL). Excludes the observability log so
// the dump stays small regardless of DB size. Best-effort: if `pg_dump` is not
// on PATH, logs a warning and returns null — the caller (migrate.js) already
// treats backup failure as non-fatal.
//
// `adapter` is accepted for signature-compat with the previous SQLite impl but
// unused; pg_dump connects directly with the connection string.
export async function backupDbLite(adapter, destDir, destName = "data.sql") {
  const dest = path.join(destDir, destName);
  const args = [
    getConnectionString(),
    "--no-owner",
    "--no-privileges",
    ...BACKUP_EXCLUDE_TABLES.flatMap((t) => ["--exclude-table-data", t]),
    "-f",
    dest,
  ];
  const env = { ...process.env };
  const caPath = process.env.DATABASE_CA_PATH || process.env.PGSSLROOTCERT;
  if (caPath) env.PGSSLROOTCERT = caPath;
  const res = spawnSync("pg_dump", args, { encoding: "utf8", env });
  if (res.error || res.status !== 0) {
    const reason = res.error?.message || res.stderr?.trim() || `exit ${res.status}`;
    console.warn(`[DB][backup] pg_dump unavailable or failed (${reason}) — skipping backup`);
    return null;
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
    try { fs.rmSync(old.full, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}
