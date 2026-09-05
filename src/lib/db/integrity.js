import { BACKUPS_DIR, DATA_FILE } from "./paths.js";

const CORRUPTION_CODES = new Set(["SQLITE_CORRUPT", "SQLITE_NOTADB"]);
const CORRUPTION_PATTERNS = [
  /database disk image is malformed/i,
  /database corruption/i,
  /file is not a database/i,
  /malformed database schema/i,
];

function recoveryMessage(filePath, detail) {
  return [
    `[DB] Integrity check failed for ${filePath}: ${detail}.`,
    "Startup stopped before schema migration or backup pruning.",
    "No backup was restored automatically.",
    `Preserve the damaged database, verify a candidate under ${BACKUPS_DIR} with PRAGMA quick_check, then restore it manually.`,
  ].join(" ");
}

export class DatabaseCorruptionError extends Error {
  constructor(filePath, detail, options = {}) {
    super(recoveryMessage(filePath, detail), options);
    this.name = "DatabaseCorruptionError";
    this.code = "SQLITE_CORRUPT";
    this.databasePath = filePath;
  }
}

export function asDatabaseCorruptionError(error, filePath = DATA_FILE) {
  if (error instanceof DatabaseCorruptionError) return error;

  const code = String(error?.code || "").toUpperCase();
  const message = String(error?.message || error || "unknown SQLite error");
  const isCorruption = CORRUPTION_CODES.has(code)
    || CORRUPTION_PATTERNS.some((pattern) => pattern.test(message));

  if (!isCorruption) return null;
  return new DatabaseCorruptionError(filePath, message, { cause: error });
}

export function assertDatabaseIntegrity(adapter, filePath = DATA_FILE) {
  let rows;
  try {
    rows = adapter.all("PRAGMA quick_check");
  } catch (error) {
    throw asDatabaseCorruptionError(error, filePath)
      || new DatabaseCorruptionError(filePath, String(error?.message || error), { cause: error });
  }

  const results = Array.isArray(rows)
    ? rows.flatMap((row) => Object.values(row || {}).map((value) => String(value).trim()))
    : [];
  if (results.length === 1 && results[0].toLowerCase() === "ok") return;

  const detail = results.length > 0 ? results.join("; ") : "PRAGMA quick_check returned no result";
  throw new DatabaseCorruptionError(filePath, detail);
}
