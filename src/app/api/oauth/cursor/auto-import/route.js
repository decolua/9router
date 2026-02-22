import { NextResponse } from "next/server";
import { access, constants } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
import Database from "better-sqlite3";

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

  // Linux
  return [
    join(home, ".config/Cursor/User/globalStorage/state.vscdb"),
    join(home, ".config/cursor/User/globalStorage/state.vscdb"),
  ];
}

/** Extract tokens from open db, with fuzzy fallback */
function extractTokens(db, platform) {
  const desiredKeys = [...ACCESS_TOKEN_KEYS, ...MACHINE_ID_KEYS];
  const rows = db.prepare(
    `SELECT key, value FROM itemTable WHERE key IN (${desiredKeys.map(() => "?").join(",")})`
  ).all(...desiredKeys);

  const normalize = (value) => {
    if (typeof value !== "string") return value;
    try {
      const parsed = JSON.parse(value);
      return typeof parsed === "string" ? parsed : value;
    } catch {
      return value;
    }
  };

  const tokens = {};
  for (const row of rows) {
    if (ACCESS_TOKEN_KEYS.includes(row.key) && !tokens.accessToken) {
      tokens.accessToken = normalize(row.value);
    } else if (MACHINE_ID_KEYS.includes(row.key) && !tokens.machineId) {
      tokens.machineId = normalize(row.value);
    }
  }

  // Fuzzy fallback for all platforms when exact keys miss
  if (!tokens.accessToken || !tokens.machineId) {
    const fallbackRows = db.prepare(
      "SELECT key, value FROM itemTable WHERE key LIKE '%cursorAuth/%' OR key LIKE '%machineId%' OR key LIKE '%serviceMachineId%'"
    ).all();

    for (const row of fallbackRows) {
      const key = row.key || "";
      const value = normalize(row.value);
      if (!tokens.accessToken && key.toLowerCase().includes("accesstoken")) {
        tokens.accessToken = value;
      }
      if (!tokens.machineId && key.toLowerCase().includes("machineid")) {
        tokens.machineId = value;
      }
    }
  }

  return tokens;
}

/**
 * GET /api/oauth/cursor/auto-import
 * Auto-detect and extract Cursor tokens from local SQLite database
 */
export async function GET() {
  try {
    const platform = process.platform;
    const candidates = getCandidatePaths(platform);

    // Find first readable db path
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

    let db;
    try {
      db = new Database(dbPath, { readonly: true, fileMustExist: true });
    } catch (error) {
      return NextResponse.json({
        found: false,
        error: `Found Cursor database at:\n${dbPath}\n\nBut could not open it: ${error.message}`,
      });
    }

    try {
      const tokens = extractTokens(db, platform);
      db.close();

      if (!tokens.accessToken || !tokens.machineId) {
        return NextResponse.json({
          found: false,
          error: "Tokens not found in database. Please login to Cursor IDE first.",
        });
      }

      return NextResponse.json({
        found: true,
        accessToken: tokens.accessToken,
        machineId: tokens.machineId,
      });
    } catch (error) {
      db?.close();
      return NextResponse.json({
        found: false,
        error: `Failed to read database: ${error.message}`,
      });
    }
  } catch (error) {
    console.log("Cursor auto-import error:", error);
    return NextResponse.json(
      { found: false, error: error.message },
      { status: 500 }
    );
  }
}
