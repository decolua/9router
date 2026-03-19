import { NextResponse } from "next/server";
import { access, constants, readFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const ACCESS_TOKEN_KEYS = ["cursorAuth/accessToken", "cursorAuth/token"];
const MACHINE_ID_KEYS = ["storage.serviceMachineId", "storage.machineId", "telemetry.machineId"];

/** Get candidate db paths by platform */
function getCandidatePaths(platform) {
  const home = homedir();

  if (platform === "darwin") {
    return [
      join(home, "Library/Application Support/Cursor/User/globalStorage/state.vscdb"),
      join(home, "Library/Application Support/Cursor - Insiders/User/globalStorage/state.vscdb"),
    ];
  }

  if (platform === "win32") {
    const appData = process.env.APPDATA || join(home, "AppData", "Roaming");
    const localAppData = process.env.LOCALAPPDATA || join(home, "AppData", "Local");
    return [
      join(appData, "Cursor", "User", "globalStorage", "state.vscdb"),
      join(appData, "Cursor - Insiders", "User", "globalStorage", "state.vscdb"),
      join(localAppData, "Cursor", "User", "globalStorage", "state.vscdb"),
      join(localAppData, "Programs", "Cursor", "User", "globalStorage", "state.vscdb"),
    ];
  }

  return [
    join(home, ".config/Cursor/User/globalStorage/state.vscdb"),
    join(home, ".config/cursor/User/globalStorage/state.vscdb"),
  ];
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

/** Extract tokens using sql.js (pure JS, cross-platform) */
async function extractTokens(dbPath) {
  const initSqlJs = (await import("sql.js")).default;
  const SQL = await initSqlJs();
  const db = new SQL.Database(await readFile(dbPath));

  const queryAll = (sql, params = []) => {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  };

  const desiredKeys = [...ACCESS_TOKEN_KEYS, ...MACHINE_ID_KEYS];
  const placeholders = desiredKeys.map(() => "?").join(",");
  const rows = queryAll(`SELECT key, value FROM itemTable WHERE key IN (${placeholders})`, desiredKeys);

  const tokens = {};
  for (const row of rows) {
    if (ACCESS_TOKEN_KEYS.includes(row.key) && !tokens.accessToken) {
      tokens.accessToken = normalize(row.value);
    } else if (MACHINE_ID_KEYS.includes(row.key) && !tokens.machineId) {
      tokens.machineId = normalize(row.value);
    }
  }

  // Fuzzy fallback
  if (!tokens.accessToken || !tokens.machineId) {
    const fallbackRows = queryAll(
      "SELECT key, value FROM itemTable WHERE key LIKE '%cursorAuth/%' OR key LIKE '%machineId%' OR key LIKE '%serviceMachineId%'"
    );
    for (const row of fallbackRows) {
      const key = row.key || "";
      const value = normalize(row.value);
      if (!tokens.accessToken && key.toLowerCase().includes("accesstoken")) tokens.accessToken = value;
      if (!tokens.machineId && key.toLowerCase().includes("machineid")) tokens.machineId = value;
    }
  }

  db.close();
  return tokens;
}

/**
 * Extract tokens via sqlite3 CLI (fallback for Windows when native addon fails)
 * Queries each key individually and parses output
 */
async function extractTokensViaCLI(dbPath) {
  const normalize = (raw) => {
    const value = raw.trim();
    try {
      const parsed = JSON.parse(value);
      return typeof parsed === "string" ? parsed : value;
    } catch {
      return value;
    }
  };

  const query = async (sql) => {
    const { stdout } = await execFileAsync("sqlite3", [dbPath, sql], { timeout: 10000 });
    return stdout.trim();
  };

  // Try each key in priority order
  let accessToken = null;
  for (const key of ACCESS_TOKEN_KEYS) {
    try {
      const raw = await query(`SELECT value FROM itemTable WHERE key='${key}' LIMIT 1`);
      if (raw) { accessToken = normalize(raw); break; }
    } catch { /* try next */ }
  }

  let machineId = null;
  for (const key of MACHINE_ID_KEYS) {
    try {
      const raw = await query(`SELECT value FROM itemTable WHERE key='${key}' LIMIT 1`);
      if (raw) { machineId = normalize(raw); break; }
    } catch { /* try next */ }
  }

  return { accessToken, machineId };
}

/**
 * GET /api/oauth/cursor/auto-import
 * Auto-detect and extract Cursor tokens from local SQLite database.
 * Strategy: better-sqlite3 (native, fast) → sqlite3 CLI (fallback) → windowsManual
 */
export async function GET() {
  try {
    const platform = process.platform;
    const candidates = getCandidatePaths(platform);

    let dbPath = null;
    for (const candidate of candidates) {
      try {
        await access(candidate, constants.R_OK);
        dbPath = candidate;
        break;
      } catch {
        // Try next candidate
      }
    }

    if (!dbPath) {
      return NextResponse.json({
        found: false,
        error: `Cursor database not found. Checked locations:\n${candidates.join("\n")}\n\nMake sure Cursor IDE is installed and opened at least once.`,
      });
    }

    // Strategy 1: sql.js (pure JS WASM, cross-platform)
    try {
      const tokens = await extractTokens(dbPath);
      if (tokens.accessToken && tokens.machineId) {
        return NextResponse.json({ found: true, accessToken: tokens.accessToken, machineId: tokens.machineId });
      }
    } catch { /* fall through to sqlite3 CLI strategy */ }

    // Strategy 2: sqlite3 CLI (works on Windows if sqlite3 is installed)
    try {
      const tokens = await extractTokensViaCLI(dbPath);
      if (tokens.accessToken && tokens.machineId) {
        return NextResponse.json({ found: true, accessToken: tokens.accessToken, machineId: tokens.machineId });
      }
    } catch { /* sqlite3 CLI not available */ }

    // Strategy 3: ask user to paste manually
    return NextResponse.json({ found: false, windowsManual: true, dbPath });
  } catch (error) {
    console.log("Cursor auto-import error:", error);
    return NextResponse.json({ found: false, error: error.message }, { status: 500 });
  }
}
