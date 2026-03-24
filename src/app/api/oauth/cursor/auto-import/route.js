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

function getPlatformError(platform, candidates) {
  if (platform === "darwin") {
    return `Cursor database not found in known macOS locations:\n${candidates.join("\n")}\n\nMake sure Cursor IDE is installed and opened at least once.`;
  }
  return "Cursor database not found. Make sure Cursor IDE is installed and you are logged in.";
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

/** Extract tokens using better-sqlite3 */
function extractTokens(db) {
  const desiredKeys = [...ACCESS_TOKEN_KEYS, ...MACHINE_ID_KEYS];
  const placeholders = desiredKeys.map(() => "?").join(", ");
  const rows = db
    .prepare(`SELECT key, value FROM itemTable WHERE key IN (${placeholders})`)
    .all(...desiredKeys);

  let accessToken = null;
  let machineId = null;

  for (const { key, value } of rows) {
    const normalized = normalize(value);
    if (!accessToken && ACCESS_TOKEN_KEYS.includes(key)) accessToken = normalized;
    if (!machineId && MACHINE_ID_KEYS.includes(key)) machineId = normalized;
  }

  // Fuzzy fallback when exact keys miss
  if (!accessToken || !machineId) {
    const fuzzyRows = db
      .prepare(
        "SELECT key, value FROM itemTable WHERE key LIKE '%accessToken%' OR key LIKE '%machineId%' OR key LIKE '%MachineId%'",
      )
      .all();

    for (const { key, value } of fuzzyRows) {
      const normalized = normalize(value);
      if (!accessToken && /accesstoken/i.test(key)) accessToken = normalized;
      if (!machineId && /machineid/i.test(key)) machineId = normalized;
    }
  }

  return { accessToken, machineId };
}

/**
 * Extract tokens via sqlite3 CLI.
 * Keeps the route build-safe by avoiding optional sql.js bundling.
 */
async function extractTokensViaCLI(dbPath) {
  const normalizeCLI = (raw) => {
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
        accessToken = normalizeCLI(raw);
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
        machineId = normalizeCLI(raw);
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

    const candidates = getCandidatePaths(platform);

    let dbPath = null;
    if (platform === "darwin" || platform === "win32") {
      for (const candidate of candidates) {
        try {
          await access(candidate, constants.R_OK);
          dbPath = candidate;
          break;
        } catch {
          // Try next candidate
        }
      }
    } else {
      // Linux: use first candidate directly
      [dbPath] = candidates;
    }

    if (!dbPath) {
      return NextResponse.json({
        found: false,
        error: getPlatformError(platform, candidates),
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

    // Strategy 1: better-sqlite3 (synchronous, handles locked dbs)
    let db;
    try {
      const Database = (await import("better-sqlite3")).default;
      db = new Database(dbPath, { readonly: true });
      const tokens = extractTokens(db);
      db.close();

      if (tokens.accessToken && tokens.machineId) {
        return NextResponse.json({ found: true, accessToken: tokens.accessToken, machineId: tokens.machineId });
      }
    } catch (error) {
      db?.close();

      if (platform === "darwin") {
        return NextResponse.json({
          found: false,
          error: `Cursor database found at ${dbPath}, but could not open it: ${error.message}`,
        });
      }
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
    } catch { /* sqlite3 CLI not available */ }

    // Strategy 3: platform-specific fallback
    if (platform === "win32") {
      return NextResponse.json({ found: false, windowsManual: true, dbPath });
    }

    if (platform === "linux") {
      return NextResponse.json({
        found: false,
        error: getPlatformError(platform, candidates),
      });
    }

    return NextResponse.json({
      found: false,
      error: "Please login to Cursor IDE first and then reopen Cursor before retrying auto-import.",
    });
  } catch (error) {
    console.log("Cursor auto-import error:", error);
    return NextResponse.json(
      { found: false, error: error.message },
      { status: 500 },
    );
  }
}
