import { NextResponse } from "next/server";
import { readFile, readdir } from "fs/promises";
import { homedir } from "os";
import { join } from "path";

/**
 * GET /api/oauth/kiro/auto-import
 *
 * Auto-detect Kiro refresh token(s) from the AWS SSO cache.
 *
 * Query params:
 *   - all=1 → return every refresh token found across the cache directory
 *
 * Single-token shape (default, backwards compatible):
 *   { found: true, refreshToken, source }
 *   { found: false, error }
 *
 * Multi-token shape (when `?all=1`):
 *   { found: true, count, tokens: [{ refreshToken, source }] }
 *   { found: false, error }
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const wantAll = ["1", "true", "yes"].includes(
      (searchParams.get("all") || "").toLowerCase()
    );

    const cachePath = join(homedir(), ".aws/sso/cache");

    let files;
    try {
      files = await readdir(cachePath);
    } catch {
      return NextResponse.json({
        found: false,
        error: "AWS SSO cache not found. Please login to Kiro IDE first.",
      });
    }

    // Read every JSON file in the cache and collect any Kiro-shaped tokens.
    // Sort `kiro-auth-token.json` first so single-token mode prefers it.
    const sortedFiles = [
      ...files.filter((f) => f === "kiro-auth-token.json"),
      ...files.filter((f) => f !== "kiro-auth-token.json" && f.endsWith(".json")),
    ];

    const tokens = [];
    const seen = new Set();
    for (const file of sortedFiles) {
      try {
        const content = await readFile(join(cachePath, file), "utf-8");
        const data = JSON.parse(content);
        if (
          typeof data?.refreshToken === "string"
          && data.refreshToken.startsWith("aorAAAAAG")
          && !seen.has(data.refreshToken)
        ) {
          seen.add(data.refreshToken);
          tokens.push({ refreshToken: data.refreshToken, source: file });
          if (!wantAll) break;
        }
      } catch {
        // Skip unreadable / non-JSON files.
      }
    }

    if (tokens.length === 0) {
      return NextResponse.json({
        found: false,
        error: "Kiro token not found in AWS SSO cache. Please login to Kiro IDE first.",
      });
    }

    if (wantAll) {
      return NextResponse.json({
        found: true,
        count: tokens.length,
        tokens,
      });
    }

    // Single-token shape — backwards compatible.
    return NextResponse.json({
      found: true,
      refreshToken: tokens[0].refreshToken,
      source: tokens[0].source,
    });
  } catch (error) {
    console.log("Kiro auto-import error:", error);
    return NextResponse.json(
      { found: false, error: error.message },
      { status: 500 }
    );
  }
}
