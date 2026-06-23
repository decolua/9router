import { NextResponse } from "next/server";
import type { JsonValue } from "open-sse/types/executor.js";
import { readFile, readdir } from "fs/promises";
import { homedir } from "os";
import { join } from "path";

/**
 * GET /api/oauth/kiro/auto-import
 * Auto-detect and extract Kiro refresh token from AWS SSO cache
 */
export async function GET() {
  try {
    const cachePath = join(homedir(), ".aws/sso/cache");

    // Try to read cache directory
    let files: string[];
    try {
      files = await readdir(cachePath);
    } catch {
      return NextResponse.json({
        found: false,
        error: "AWS SSO cache not found. Please login to Kiro IDE first.",
      });
    }

    // Look for kiro-auth-token.json or any .json file with refreshToken
    let refreshToken: string | null = null;
    let foundFile: string | null = null;

    // First try kiro-auth-token.json
    const kiroTokenFile = "kiro-auth-token.json";
    if (files.includes(kiroTokenFile)) {
      try {
        const content = await readFile(join(cachePath, kiroTokenFile), "utf-8");
        const data = JSON.parse(content) as Record<string, JsonValue>;
        if (typeof data.refreshToken === "string" && data.refreshToken.startsWith("aorAAAAAG")) {
          refreshToken = data.refreshToken;
          foundFile = kiroTokenFile;
        }
      } catch {
        // Continue to search other files
      }
    }

    // If not found, search all .json files
    if (!refreshToken) {
      for (const file of files) {
        if (!file.endsWith(".json")) continue;

        try {
          const content = await readFile(join(cachePath, file), "utf-8");
          const data = JSON.parse(content) as Record<string, JsonValue>;

          // Look for Kiro refresh token (starts with aorAAAAAG)
          if (typeof data.refreshToken === "string" && data.refreshToken.startsWith("aorAAAAAG")) {
            refreshToken = data.refreshToken;
            foundFile = file;
            break;
          }
        } catch {
          // Skip invalid JSON files
          continue;
        }
      }
    }

    if (!refreshToken) {
      return NextResponse.json({
        found: false,
        error: "Kiro token not found in AWS SSO cache. Please login to Kiro IDE first.",
      });
    }

    return NextResponse.json({
      found: true,
      refreshToken,
      source: foundFile,
    });
  } catch (error) {
    console.log("Kiro auto-import error:", error);
    return NextResponse.json(
      { found: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
