import { NextResponse } from "next/server";
import { access, constants } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
import Database from "better-sqlite3";

/**
 * GET /api/oauth/cursor/auto-import
 * Auto-detect and extract Cursor tokens from local SQLite database
 */
export async function GET() {
  try {
    const platform = process.platform;
    let dbPath;

    if (platform === "darwin") {
      // macOS: probe multiple locations (standard + Insiders)
      const userHome = homedir();
      const candidateDbPaths = [
        join(userHome, "Library/Application Support/Cursor/User/globalStorage/state.vscdb"),
        join(userHome, "Library/Application Support/Cursor - Insiders/User/globalStorage/state.vscdb"),
      ];

      for (const path of candidateDbPaths) {
        try {
          await access(path, constants.R_OK);
          dbPath = path;
          break;
        } catch {
          // Continue probing next candidate.
        }
      }

      if (!dbPath) {
        return NextResponse.json({
          found: false,
          error:
            "Cursor database not found in known macOS locations. Make sure Cursor IDE is installed and opened at least once.",
        });
      }
    } else if (platform === "linux") {
      dbPath = join(homedir(), ".config/Cursor/User/globalStorage/state.vscdb");
    } else if (platform === "win32") {
      dbPath = join(process.env.APPDATA || "", "Cursor/User/globalStorage/state.vscdb");
    } else {
      return NextResponse.json(
        { error: "Unsupported platform", found: false },
        { status: 400 }
      );
    }

    // Try to open database
    let db;
    try {
      db = new Database(dbPath, { readonly: true, fileMustExist: true });
    } catch (error) {
      if (platform === "darwin") {
        return NextResponse.json({
          found: false,
          error: `Found Cursor database at ${dbPath} but could not open it: ${error.message}`,
        });
      }
      return NextResponse.json({
        found: false,
        error: "Cursor database not found. Make sure Cursor IDE is installed and you are logged in.",
      });
    }

    try {
      const accessTokenKeys = [
        "cursorAuth/accessToken",
        "cursorAuth/token",
      ];
      const machineIdKeys = [
        "storage.serviceMachineId",
        "storage.machineId",
        "telemetry.machineId",
      ];
      const desiredKeys = [...accessTokenKeys, ...machineIdKeys];

      const rows = db.prepare(
        `SELECT key, value FROM itemTable WHERE key IN (${desiredKeys.map(() => "?").join(",")})`
      ).all(...desiredKeys);

      const normalizeValue = (value) => {
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
        if (accessTokenKeys.includes(row.key) && !tokens.accessToken) {
          tokens.accessToken = normalizeValue(row.value);
        } else if (machineIdKeys.includes(row.key) && !tokens.machineId) {
          tokens.machineId = normalizeValue(row.value);
        }
      }

      // Fuzzy fallback for newer/changed key names (macOS only, where the
      // issue was originally reported; other platforms use exact keys).
      if (platform === "darwin" && (!tokens.accessToken || !tokens.machineId)) {
        const fallbackRows = db.prepare(
          "SELECT key, value FROM itemTable WHERE key LIKE '%cursorAuth/%' OR key LIKE '%machineId%' OR key LIKE '%serviceMachineId%'"
        ).all();

        for (const row of fallbackRows) {
          const key = row.key || "";
          const value = normalizeValue(row.value);

          if (!tokens.accessToken && key.toLowerCase().includes("accesstoken")) {
            tokens.accessToken = value;
          }

          if (!tokens.machineId && key.toLowerCase().includes("machineid")) {
            tokens.machineId = value;
          }
        }
      }

      db.close();

      // Validate tokens exist
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
