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
 * Extract tokens via better-sqlite3 (bundled dependency).
 * This is the preferred strategy — no external CLI required.
 */
async function extractTokensViaBetterSqlite(dbPath) {
  const { default: Database } = await import("better-sqlite3");
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });

  const runQuery = (sql, params = []) => {
    const stmt = db.prepare(sql);
    if (typeof stmt.all === "function") return stmt.all(...params) || [];
    if (typeof stmt.get === "function") return [stmt.get(...params)].filter(Boolean);
    return [];
  };

  const queryValue = (exactKeys, fuzzyPatterns) => {
    const exactPlaceholders = exactKeys.map(() => "?").join(", ");
    const exactRows = runQuery(
      `SELECT key, value FROM itemTable WHERE key IN (${exactPlaceholders}) LIMIT 50`,
      exactKeys,
    );
    for (const key of exactKeys) {
      const match = exactRows.find((row) => row?.key === key);
      if (match?.value !== undefined && match?.value !== null) return match.value;
    }

    const fuzzyConditions = fuzzyPatterns.map(() => "key LIKE ?").join(" OR ");
    const fuzzyRows = runQuery(
      `SELECT key, value FROM itemTable WHERE ${fuzzyConditions} LIMIT 50`,
      fuzzyPatterns,
    );

    for (const pattern of fuzzyPatterns) {
      const normalized = String(pattern).replace(/^%|%$/g, "").toLowerCase();
      const match = fuzzyRows.find((row) => String(row?.key || "").toLowerCase().includes(normalized));
      if (match?.value !== undefined && match?.value !== null) return match.value;
    }

    return null;
  };

  const normalize = (value) => {
    if (typeof value !== "string") return value;
    try {
      const parsed = JSON.parse(value);
      return typeof parsed === "string" ? parsed : value;
    } catch {
      return value;
    }
  };

  let accessToken = null;
  accessToken = queryValue(ACCESS_TOKEN_KEYS, ["%accessToken%", "%token%"]);
  if (accessToken) accessToken = normalize(accessToken);

  let machineId = null;
  machineId = queryValue(MACHINE_ID_KEYS, ["%machineId%", "%serviceMachineId%"]);
  if (machineId) machineId = normalize(machineId);

  db.close();
  return { accessToken, machineId };
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
    if (!["darwin", "linux", "win32"].includes(platform)) {
      return NextResponse.json({ found: false, error: "Unsupported platform" }, { status: 400 });
    }

    if (platform === "linux") {
      return NextResponse.json({
        found: false,
        error: "Cursor database not found. Make sure Cursor IDE is installed and you are logged in.",
      });
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
      const isDarwin = platform === "darwin";
      const notFoundMessage = isDarwin
        ? `Cursor database not found in known macOS locations`
        : `Cursor database not found. Make sure Cursor IDE is installed and you are logged in.`;

      return NextResponse.json({
        found: false,
        error: isDarwin
          ? `${notFoundMessage}\nChecked locations:\n${candidates.join("\n")}\n\nMake sure Cursor IDE is installed and opened at least once.`
          : notFoundMessage,
      });
    }

    // Strategy 1: better-sqlite3 (bundled — no external tools required)
    try {
      const tokens = await extractTokensViaBetterSqlite(dbPath);
      if (tokens.accessToken && tokens.machineId) {
        return NextResponse.json({
          found: true,
          accessToken: tokens.accessToken,
          machineId: tokens.machineId,
        });
      }
    } catch (error) {
      if (String(error?.message || "").includes("SQLITE_CANTOPEN")) {
        return NextResponse.json({
          found: false,
          error: `Cursor database exists but could not open it: ${error.message}`,
        });
      }
      // Native bindings unavailable — try CLI fallback
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

    // Strategy 3: ask user to paste manually
    return NextResponse.json({
      found: false,
      error: "Please login to Cursor IDE first and reopen the app so the database is created.",
      windowsManual: true,
      dbPath,
    });
  } catch (error) {
    if (String(error?.message || "").includes("SQLITE_CANTOPEN")) {
      return NextResponse.json({
        found: false,
        error: `Cursor database exists but could not open it: ${error.message}`,
      });
    }
    console.log("Cursor auto-import error:", error);
    return NextResponse.json(
      { found: false, error: error.message },
      { status: 500 },
    );
  }
}
