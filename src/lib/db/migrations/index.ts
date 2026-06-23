// Migration registry — append new entries when schema changes.
// Each migration: { version: number, name: string, up(db): void }
// Versions MUST be unique and monotonically increasing.
import type { Migration } from "./001-initial.js";
import m001 from "./001-initial.js";
import m002 from "./002-normalize-usage-api-keys.js";
import m003 from "./003-mcp-gateway.js";
import m004 from "./004-mcp-grant-tools.js";
import m005 from "./005-apikey-rbac.js";
import m006 from "./006-files.js";

export type { Migration };

export const MIGRATIONS: Migration[] = [m001, m002, m003, m004, m005, m006].sort(
  (a, b) => a.version - b.version,
);

export function latestVersion() {
  return MIGRATIONS.length ? MIGRATIONS[MIGRATIONS.length - 1]!.version : 0;
}
