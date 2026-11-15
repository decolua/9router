import { NextResponse } from "next/server";
import { readFile, access, constants } from "fs/promises";
import { homedir } from "os";
import { join } from "path";

function getCandidatePaths() {
  const home = homedir();
  const paths = [
    join(home, ".commandcode", "auth.json"),
  ];

  if (process.platform === "win32") {
    const appData = process.env.APPDATA || join(home, "AppData", "Roaming");
    paths.push(join(appData, "commandcode", "auth.json"));
  }

  return paths;
}

/**
 * GET /api/oauth/commandcode/auto-import
 * Auto-detect Command Code CLI credentials from ~/.commandcode/auth.json
 */
export async function GET() {
  try {
    const candidates = getCandidatePaths();

    let authPath = null;
    for (const candidate of candidates) {
      try {
        await access(candidate, constants.R_OK);
        authPath = candidate;
        break;
      } catch {
        // try next
      }
    }

    if (!authPath) {
      return NextResponse.json({
        found: false,
        error: `Command Code auth file not found. Checked:\n${candidates.join("\n")}\n\nRun 'commandcode login' in your terminal first.`,
      });
    }

    const raw = await readFile(authPath, "utf-8");
    let auth;
    try {
      auth = JSON.parse(raw);
    } catch {
      return NextResponse.json({
        found: false,
        error: "auth.json is not valid JSON. Please run 'commandcode login' again.",
      });
    }

    const apiKey = typeof auth?.apiKey === "string" ? auth.apiKey.trim() : "";
    if (!apiKey) {
      return NextResponse.json({
        found: false,
        error: "No apiKey found in ~/.commandcode/auth.json. Please run 'commandcode login'.",
      });
    }

    return NextResponse.json({
      found: true,
      apiKey,
      userId: auth.userId || null,
      userName: auth.userName || null,
      keyName: auth.keyName || null,
      authenticatedAt: auth.authenticatedAt || null,
      source: authPath,
    });
  } catch (error) {
    console.error("Command Code auto-import error:", error);
    return NextResponse.json(
      { found: false, error: error.message },
      { status: 500 }
    );
  }
}
