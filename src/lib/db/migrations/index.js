// Migration registry — append new entries when schema changes.
// Each migration: { version: number, name: string, up(db): void }
// Versions MUST be unique and monotonically increasing.
import m001 from "./001-initial.js";
import m002 from "./002-encrypt-secrets.js";
import m003 from "./003-multi-user.js";
import m004 from "./004-fix-pg-user-columns.js";
import m005 from "./005-audit-log.js";

export const MIGRATIONS = [m001, m002, m003, m004, m005].sort((a, b) => a.version - b.version);

export function latestVersion() {
  return MIGRATIONS.length ? MIGRATIONS[MIGRATIONS.length - 1].version : 0;
}
