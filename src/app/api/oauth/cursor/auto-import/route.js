import { NextResponse } from "next/server";
import { access, constants } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const ACCESS_TOKEN_KEYS = ["cursorAuth/accessToken", "cursorAuth/token"];
const MACHINE_ID_KEYS = [
  "storage.serviceMachineId",
  "storage.machineId",
  "telemetry.machineId",
];
const SUPPORTED_PLATFORMS = new Set(["darwin", "win32", "linux"]);
const ACCESS_TOKEN_KEY_PATTERN = /accessToken|token/i;
const MACHINE_ID_KEY_PATTERN = /machineId/i;
const FUZZY_ROW_LIMIT = 25;
const SAFE_SQLITE_CODE = /^SQLITE_[A-Z0-9_]{1,40}$/;

/** Get candidate db paths by platform */
function getCandidatePaths(platform) {
  const home = homedir();

  if (platform === "darwin") {
    return [
      join(
        home,
        "Library/Application Support/Cursor/User/globalStorage/state.vscdb",
      ),
      join(
        home,
        "Library/Application Support/Cursor - Insiders/User/globalStorage/state.vscdb",
      ),
    ];
  }

  if (platform === "win32") {
    const appData = process.env.APPDATA || join(home, "AppData", "Roaming");
    const localAppData =
      process.env.LOCALAPPDATA || join(home, "AppData", "Local");
    return [
      join(appData, "Cursor", "User", "globalStorage", "state.vscdb"),
      join(
        appData,
        "Cursor - Insiders",
        "User",
        "globalStorage",
        "state.vscdb",
      ),
      join(localAppData, "Cursor", "User", "globalStorage", "state.vscdb"),
      join(
        localAppData,
        "Programs",
        "Cursor",
        "User",
        "globalStorage",
        "state.vscdb",
      ),
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

/**
 * Pick the first bounded fuzzy match for a token field.
 * Only key/value rows are read; rows are never echoed in errors or responses.
 */
function firstFuzzyValue(db, patterns, keyPattern) {
  const where = patterns.map(() => "key LIKE ?").join(" OR ");
  const rows = db
    .prepare(
      `SELECT key, value FROM itemTable WHERE ${where} ORDER BY rowid LIMIT ${FUZZY_ROW_LIMIT}`,
    )
    .all(...patterns);

  for (const row of rows) {
    if (row && keyPattern.test(row.key) && row.value) {
      return normalize(row.value);
    }
  }

  return null;
}

/**
 * Extract tokens via better-sqlite3 (bundled dependency).
 * This is the preferred strategy — no external CLI required.
 */
function extractTokensViaBetterSqlite(dbPath, platform) {
  // Dynamic require so the route stays importable even if native bindings fail
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require("better-sqlite3");
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });

  try {
    const query = (key) => {
      const row = db
        .prepare("SELECT value FROM itemTable WHERE key=? LIMIT 1")
        .get(key);
      return row?.value || null;
    };

    let accessToken = null;
    for (const key of ACCESS_TOKEN_KEYS) {
      const raw = query(key);
      if (raw) { accessToken = normalize(raw); break; }
    }

    let machineId = null;
    for (const key of MACHINE_ID_KEYS) {
      const raw = query(key);
      if (raw) { machineId = normalize(raw); break; }
    }

    if (platform === "darwin") {
      if (!accessToken) {
        accessToken = firstFuzzyValue(
          db,
          ["%accessToken%", "%token%"],
          ACCESS_TOKEN_KEY_PATTERN,
        );
      }
      if (!machineId) {
        machineId = firstFuzzyValue(
          db,
          ["%machineId%"],
          MACHINE_ID_KEY_PATTERN,
        );
      }
    }

    return { accessToken, machineId };
  } finally {
    db.close();
  }
}

/**
 * Bounded, token-free database error code for diagnostics.
 * Never returns the raw error message, which can contain database contents.
 */
function getSafeDatabaseErrorCode(error) {
  const code = typeof error?.code === "string" ? error.code : "";
  if (SAFE_SQLITE_CODE.test(code)) return code;

  const message = typeof error?.message === "string" ? error.message : "";
  const match = message.match(/^(SQLITE_[A-Z0-9_]{1,40})/);
  return match ? match[1] : null;
}

/**
 * Extract tokens via sqlite3 CLI.
 * Fallback when better-sqlite3 native bindings are unavailable.
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
    const { stdout } = await execFileAsync("sqlite3", [dbPath, sql], {
      timeout: 10000,
    });
    return stdout.trim();
  };

  // Try each key in priority order
  let accessToken = null;
  for (const key of ACCESS_TOKEN_KEYS) {
    try {
      const raw = await query(
        `SELECT value FROM itemTable WHERE key='${key}' LIMIT 1`,
      );
      if (raw) {
        accessToken = normalize(raw);
        break;
      }
    } catch {
      /* try next */
    }
  }

  let machineId = null;
  for (const key of MACHINE_ID_KEYS) {
    try {
      const raw = await query(
        `SELECT value FROM itemTable WHERE key='${key}' LIMIT 1`,
      );
      if (raw) {
        machineId = normalize(raw);
        break;
      }
    } catch {
      /* try next */
    }
  }

  return { accessToken, machineId };
}

/**
 * GET /api/oauth/cursor/auto-import
 * Auto-detect and extract Cursor tokens from local SQLite database.
 * Strategy: better-sqlite3 → sqlite3 CLI → manual fallback
 */
export async function GET() {
  try {
    const platform = process.platform;

    if (!SUPPORTED_PLATFORMS.has(platform)) {
      return NextResponse.json(
        { found: false, error: "Unsupported platform" },
        { status: 400 },
      );
    }

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

    // On Linux, verify Cursor is actually installed (not just leftover config)
    if (platform === "linux") {
      let cursorInstalled = false;
      try {
        await execFileAsync("which", ["cursor"], { timeout: 5000 });
        cursorInstalled = true;
      } catch {
        try {
          const desktopFile = join(homedir(), ".local/share/applications/cursor.desktop");
          await access(desktopFile, constants.R_OK);
          cursorInstalled = true;
        } catch { /* not found */ }
      }
      if (!cursorInstalled) {
        return NextResponse.json({
          found: false,
          error: "Cursor config files found but Cursor IDE does not appear to be installed. Skipping auto-import.",
        });
      }
    }

    // Strategy 1: better-sqlite3 (bundled — no external tools required)
    let databaseErrorCode = null;
    try {
      const tokens = extractTokensViaBetterSqlite(dbPath, platform);
      if (tokens.accessToken && tokens.machineId) {
        return NextResponse.json({
          found: true,
          accessToken: tokens.accessToken,
          machineId: tokens.machineId,
        });
      }
    } catch (error) {
      // Native bindings unavailable or the database could not be opened.
      // Keep only a bounded SQLite code; never echo the raw error.
      databaseErrorCode = getSafeDatabaseErrorCode(error);
    }

    // Strategy 2: sqlite3 CLI
    try {
      const tokens = await extractTokensViaCLI(dbPath);
      if (tokens.accessToken && tokens.machineId) {
        return NextResponse.json({
          found: true,
          accessToken: tokens.accessToken,
          machineId: tokens.machineId,
        });
      }
    } catch {
      // sqlite3 CLI not available either
    }

    if (databaseErrorCode) {
      return NextResponse.json({
        found: false,
        error: `Cursor database was found but could not open it (${databaseErrorCode}). Paste the access token and machine ID manually to continue.`,
      });
    }

    if (platform === "win32") {
      // Strategy 3: ask Windows users to paste manually
      return NextResponse.json({ found: false, windowsManual: true, dbPath });
    }

    return NextResponse.json({
      found: false,
      error: "Please login to Cursor IDE first, then try auto-import again.",
    });
  } catch (error) {
    console.log("Cursor auto-import error:", error);
    return NextResponse.json(
      { found: false, error: error.message },
      { status: 500 },
    );
  }
}
