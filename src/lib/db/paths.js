import path from "node:path";
import fs from "node:fs";
import { DATA_DIR } from "@/lib/dataDir.js";

export const DB_DIR = path.join(DATA_DIR, "db");
export const DATA_FILE = path.join(DB_DIR, "data.sqlite");
export const BACKUPS_DIR = path.join(DB_DIR, "backups");
export const LEGACY_FILES = {
  main: path.join(DATA_DIR, "db.json"),
  usage: path.join(DATA_DIR, "usage.json"),
  disabled: path.join(DATA_DIR, "disabledModels.json"),
  details: path.join(DATA_DIR, "request-details.json"),
};

// The DB holds provider OAuth access/refresh tokens and plaintext client API
// keys, so it is at least as sensitive as auth/cli-secret and jwt-secret (both
// already written with mode 0o600). Without an explicit mode it inherits the
// process umask — 022 on most systems — leaving it world-readable at 0644.
export const SECRET_DIR_MODE = 0o700;
export const SECRET_FILE_MODE = 0o600;

// chmod is a no-op for our purposes on Windows (ACL-based, only the read-only
// bit maps through), so restrict tightening to POSIX platforms.
const isPosix = process.platform !== "win32";

// Best-effort: a Docker bind mount may be owned by another uid, and failing to
// tighten permissions must never prevent the app from starting.
export function chmodQuiet(target, mode) {
  if (!isPosix) return;
  try {
    fs.chmodSync(target, mode);
  } catch {}
}

export function ensureDirs() {
  for (const dir of [DATA_DIR, DB_DIR, BACKUPS_DIR]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: SECRET_DIR_MODE });
  }
}

// Repair permissions on every startup. Creating new files with the right mode
// only protects fresh installs; existing installs already have 0755 dirs and a
// 0644 DB on disk, and SQLite writes in place so those modes persist forever.
export function hardenPermissions() {
  if (!isPosix) return;
  for (const dir of [DATA_DIR, DB_DIR, BACKUPS_DIR]) {
    if (fs.existsSync(dir)) chmodQuiet(dir, SECRET_DIR_MODE);
  }
  // -wal and -shm are created by SQLite itself, so they inherit the umask too.
  for (const suffix of ["", "-wal", "-shm"]) {
    const file = `${DATA_FILE}${suffix}`;
    if (fs.existsSync(file)) chmodQuiet(file, SECRET_FILE_MODE);
  }
}
