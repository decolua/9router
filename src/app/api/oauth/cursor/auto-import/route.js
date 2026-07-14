import { NextResponse } from "next/server";
import { access, constants } from "fs/promises";
import { homedir } from "os";
import { join } from "path";

const ACCESS_TOKEN_KEYS = ["cursorAuth/accessToken", "cursorAuth/token"];
const MACHINE_ID_KEYS = [
  "storage.serviceMachineId",
  "storage.machineId",
  "telemetry.machineId",
];
const ACCESS_TOKEN_LIKE_PATTERNS = ["cursorAuth/%accessToken%", "cursorAuth/%token%"];
const MACHINE_ID_LIKE_PATTERNS = ["storage.%machineId%", "telemetry.%machineId%"];

/** Get candidate db paths by platform (macOS only — others use single fixed path). */
function getMacCandidatePaths() {
  const home = homedir();
  return [
    join(home, "Library/Application Support/Cursor/User/globalStorage/state.vscdb"),
    join(home, "Library/Application Support/Cursor - Insiders/User/globalStorage/state.vscdb"),
  ];
}

function getLinuxPath() {
  return join(homedir(), ".config/Cursor/User/globalStorage/state.vscdb");
}

function getWin32Path() {
  const home = homedir();
  const appData = process.env.APPDATA || join(home, "AppData", "Roaming");
  return join(appData, "Cursor", "User", "globalStorage", "state.vscdb");
}

const normalize = (value) => {
  if (typeof value !== "string") return value;
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === "string" ? parsed : value;
  } catch {
    return value;
  }
};

function pickToken(rows, exactKeys, fuzzyMatcher) {
  for (const exact of exactKeys) {
    const hit = rows.find((r) => r.key === exact);
    if (hit && hit.value) return normalize(hit.value);
  }
  const fuzzyHit = rows.find((r) => r.value && fuzzyMatcher(r.key));
  return fuzzyHit ? normalize(fuzzyHit.value) : null;
}

async function loadDatabase(dbPath) {
  // Dynamic import so Vitest can mock better-sqlite3 and production remains
  // importable when native bindings are unavailable until this route runs.
  const sqliteModule = await import("better-sqlite3");
  const Database = sqliteModule.default || sqliteModule;
  return new Database(dbPath, { readonly: true, fileMustExist: true });
}

function queryRows(db, exactKeys, fuzzyPatterns, allowFuzzy) {
  const placeholders = exactKeys.map(() => "?").join(",");
  const exact = db.prepare(`SELECT key, value FROM itemTable WHERE key IN (${placeholders})`).all(...exactKeys);
  if (exact.length || !allowFuzzy) return exact;
  const likeClauses = fuzzyPatterns.map(() => "key LIKE ?").join(" OR ");
  return db.prepare(`SELECT key, value FROM itemTable WHERE ${likeClauses}`).all(...fuzzyPatterns);
}

/**
 * GET /api/oauth/cursor/auto-import
 * Auto-detect and extract Cursor tokens from local SQLite database.
 *
 * macOS: probes multiple candidate paths and falls back to fuzzy key matching.
 * linux/win32: uses a single hardcoded path with original error message.
 * other: returns 400 (unsupported).
 */
export async function GET() {
  const platform = process.platform;

  if (platform !== "darwin" && platform !== "linux" && platform !== "win32") {
    return NextResponse.json({ error: "Unsupported platform" }, { status: 400 });
  }

  // ── macOS: candidate probing + fuzzy fallback ─────────────────────────────
  if (platform === "darwin") {
    const candidates = getMacCandidatePaths();
    let dbPath = null;
    for (const candidate of candidates) {
      try {
        await access(candidate, constants.R_OK);
        dbPath = candidate;
        break;
      } catch {
        // try next
      }
    }
    if (!dbPath) {
      return NextResponse.json({
        found: false,
        error: `Cursor database not found in known macOS locations:\n${candidates.join("\n")}\n\nMake sure Cursor IDE is installed and opened at least once.`,
      });
    }

    let db;
    try {
      db = await loadDatabase(dbPath);
    } catch (error) {
      return NextResponse.json({
        found: false,
        error: `Cursor database exists at ${dbPath} but could not open it: ${error?.message || error}`,
      });
    }

    try {
      const tokenRows = queryRows(db, ACCESS_TOKEN_KEYS, ACCESS_TOKEN_LIKE_PATTERNS, true);
      const machineRows = queryRows(db, MACHINE_ID_KEYS, MACHINE_ID_LIKE_PATTERNS, true);
      const accessToken = pickToken(tokenRows, ACCESS_TOKEN_KEYS, (key) => /token/i.test(key));
      const machineId = pickToken(machineRows, MACHINE_ID_KEYS, (key) => /machineId/i.test(key));

      if (accessToken && machineId) {
        return NextResponse.json({ found: true, accessToken, machineId });
      }
      return NextResponse.json({
        found: false,
        error: "Cursor tokens not found. Please login to Cursor IDE first, then retry auto-import.",
      });
    } finally {
      try { db.close(); } catch { /* ignore */ }
    }
  }

  // ── linux / win32: single hardcoded path, original error message ──────────
  const dbPath = platform === "linux" ? getLinuxPath() : getWin32Path();
  let db;
  try {
    db = await loadDatabase(dbPath);
  } catch {
    return NextResponse.json({
      found: false,
      error: "Cursor database not found. Make sure Cursor IDE is installed and you are logged in.",
    });
  }

  try {
    const tokenRows = queryRows(db, ACCESS_TOKEN_KEYS, ACCESS_TOKEN_LIKE_PATTERNS, false);
    const machineRows = queryRows(db, MACHINE_ID_KEYS, MACHINE_ID_LIKE_PATTERNS, false);
    const accessToken = pickToken(tokenRows, ACCESS_TOKEN_KEYS, (key) => /token/i.test(key));
    const machineId = pickToken(machineRows, MACHINE_ID_KEYS, (key) => /machineId/i.test(key));

    if (accessToken && machineId) {
      return NextResponse.json({ found: true, accessToken, machineId });
    }
    return NextResponse.json({
      found: false,
      error: "Cursor tokens not found. Please login to Cursor IDE first, then retry auto-import.",
    });
  } finally {
    try { db.close(); } catch { /* ignore */ }
  }
}
