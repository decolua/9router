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

  if (platform === "linux") {
    return [join(home, ".config/Cursor/User/globalStorage/state.vscdb")];
  }

  return null;
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
  // Dynamic require so the route stays importable even if native bindings fail
  const { default: Database } = await import("better-sqlite3");
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });

  const queryExact = () => {
    const keys = [...ACCESS_TOKEN_KEYS, ...MACHINE_ID_KEYS];
    return db
      .prepare(`SELECT key, value FROM itemTable WHERE key IN (${keys.map(() => "?").join(",")})`)
      .all(...keys);
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

  const rows = queryExact();
  const byKey = new Map(rows.map((row) => [row.key, row.value]));

  let accessToken = ACCESS_TOKEN_KEYS.map((key) => byKey.get(key)).find(Boolean) || null;
  let machineId = MACHINE_ID_KEYS.map((key) => byKey.get(key)).find(Boolean) || null;

  if ((!accessToken || !machineId) && process.platform === "darwin") {
    const fuzzyRows = db
      .prepare("SELECT key, value FROM itemTable WHERE key LIKE '%accessToken%' OR key LIKE '%MachineId%' OR key LIKE '%machineId%'")
      .all();
    accessToken ||= fuzzyRows.find((row) => /accessToken/i.test(row.key))?.value || null;
    machineId ||= fuzzyRows.find((row) => /machineId/i.test(row.key))?.value || null;
  }

  db.close();
  return { accessToken: normalize(accessToken), machineId: normalize(machineId) };
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
    const candidates = getCandidatePaths(platform);

    if (!candidates) {
      return NextResponse.json({ found: false, error: "Unsupported platform" }, { status: 400 });
    }

    if (platform === "linux") {
      const dbPath = candidates[0];
      return NextResponse.json({
        found: false,
        error: "Cursor database not found. Make sure Cursor IDE is installed and you are logged in.",
      });
    }

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
      if (platform === "darwin") {
        return NextResponse.json({
          found: false,
          error: "Cursor database not found in known macOS locations",
        });
      }
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
      if (platform === "darwin") {
        return NextResponse.json({
          found: false,
          error: `Cursor database exists but 9Router could not open it: ${error.message}`,
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
    if (platform === "darwin") {
      return NextResponse.json({
        found: false,
        error: "Please login to Cursor IDE first, then retry auto-import.",
        dbPath,
      });
    }
    return NextResponse.json({ found: false, windowsManual: true, dbPath });
  } catch (error) {
    console.log("Cursor auto-import error:", error);
    return NextResponse.json(
      { found: false, error: error.message },
      { status: 500 },
    );
  }
}
