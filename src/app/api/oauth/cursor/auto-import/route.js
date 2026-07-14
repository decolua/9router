import { NextResponse } from "next/server";
import { access, constants } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
import Database from "better-sqlite3";

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
 *
 * Query strategy:
 *   1. Exact-key match on all known keys (IN (...)).
 *   2. Fuzzy LIKE fallback when exact keys are absent.
 */
function extractTokensViaBetterSqlite(dbPath) {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });

  const allKeys = [...ACCESS_TOKEN_KEYS, ...MACHINE_ID_KEYS];
  const exactQuery = `SELECT key, value FROM itemTable WHERE key IN (${allKeys
    .map(() => "?")
    .join(", ")})`;
  const rows = db.prepare(exactQuery).all(...allKeys);

  const byKey = new Map();
  for (const { key, value } of rows) byKey.set(key, normalize(value));

  let accessToken = null;
  for (const key of ACCESS_TOKEN_KEYS) {
    if (byKey.has(key)) {
      accessToken = byKey.get(key);
      break;
    }
  }

  let machineId = null;
  for (const key of MACHINE_ID_KEYS) {
    if (byKey.has(key)) {
      machineId = byKey.get(key);
      break;
    }
  }

  // Fuzzy fallback when exact keys are missing
  if (!accessToken || !machineId) {
    const fuzzyQuery = `SELECT key, value FROM itemTable WHERE key LIKE '%accessToken%' OR key LIKE '%token%' OR key LIKE '%machineId%'`;
    const fuzzyRows = db.prepare(fuzzyQuery).all();
    for (const { key, value } of fuzzyRows) {
      const k = key.toLowerCase();
      if (!machineId && k.includes("machineid")) {
        machineId = normalize(value);
      } else if (
        !accessToken &&
        (k.includes("accesstoken") || k.includes("token"))
      ) {
        accessToken = normalize(value);
      }
    }
  }

  db.close();
  return { accessToken, machineId };
}

/**
 * GET /api/oauth/cursor/auto-import
 * Auto-detect and extract Cursor tokens from local SQLite database.
 */
export async function GET() {
  try {
    const platform = process.platform;

    // Unsupported platforms
    if (!["darwin", "linux", "win32"].includes(platform)) {
      return NextResponse.json(
        { error: "Unsupported platform" },
        { status: 400 },
      );
    }

    // Linux: single hardcoded path, no filesystem probing.
    if (platform === "linux") {
      const dbPath = join(
        homedir(),
        ".config/Cursor/User/globalStorage/state.vscdb",
      );
      try {
        const tokens = extractTokensViaBetterSqlite(dbPath);
        if (tokens.accessToken && tokens.machineId) {
          return NextResponse.json({ found: true, ...tokens });
        }
        return NextResponse.json({
          found: false,
          error: "Please login to Cursor IDE first",
        });
      } catch {
        return NextResponse.json({
          found: false,
          error:
            "Cursor database not found. Make sure Cursor IDE is installed and you are logged in.",
        });
      }
    }

    // macOS / Windows: probe candidate locations for an accessible db.
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
      const error =
        platform === "darwin"
          ? `Cursor database not found in known macOS locations. Make sure Cursor IDE is installed and you are logged in.`
          : `Cursor database not found. Checked locations:\n${candidates.join(
              "\n",
            )}\n\nMake sure Cursor IDE is installed and opened at least once.`;
      return NextResponse.json({ found: false, error });
    }

    try {
      const tokens = extractTokensViaBetterSqlite(dbPath);
      if (tokens.accessToken && tokens.machineId) {
        return NextResponse.json({ found: true, ...tokens });
      }
      return NextResponse.json({
        found: false,
        error: "Please login to Cursor IDE first",
      });
    } catch (error) {
      return NextResponse.json({
        found: false,
        error: `Cursor database found at ${dbPath} but could not open it: ${
          error?.message || error
        }`,
      });
    }
  } catch (error) {
    console.log("Cursor auto-import error:", error);
    return NextResponse.json(
      { found: false, error: error.message },
      { status: 500 },
    );
  }
}
