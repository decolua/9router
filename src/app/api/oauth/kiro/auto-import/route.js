import { NextResponse } from "next/server";
import { readFile, readdir } from "fs/promises";
import { readFileSync } from "fs";
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
    let files;
    try {
      files = await readdir(cachePath);
    } catch (error) {
      return NextResponse.json({
        found: false,
        error: "AWS SSO cache not found. Please login to Kiro IDE first.",
      });
    }

    // Look for kiro-auth-token.json or any .json file with refreshToken
    let refreshToken = null;
    let clientId = null;
    let clientSecret = null;
    let region = "us-east-1";
    let authMethod = "builder-id";
    let foundFile = null;

    const extractFromData = (data, file) => {
      if (!data.refreshToken?.startsWith("aorAAAAAG")) return false;
      refreshToken = data.refreshToken;
      foundFile = file;
      // Direct clientId/clientSecret (Builder ID flow)
      clientId = data.clientId || null;
      clientSecret = data.clientSecret || null;
      region = data.region || "us-east-1";
      // Preserve authMethod from file (may be "IdC", "builder-id", etc.) — normalize to lowercase
      authMethod = typeof data.authMethod === "string"
        ? data.authMethod.toLowerCase()
        : "builder-id";

      // Enterprise IDC: clientId/clientSecret stored in a separate device registration file
      // referenced by clientIdHash (e.g. ~/.aws/sso/cache/{clientIdHash}.json)
      if (!clientId && data.clientIdHash) {
        try {
          const devRegPath = join(cachePath, `${data.clientIdHash}.json`);
          const devReg = JSON.parse(readFileSync(devRegPath, "utf-8"));
          clientId = devReg.clientId || null;
          clientSecret = devReg.clientSecret || null;
        } catch {
          // device registration file not found or invalid — continue without it
        }
      }

      return true;
    };

    // First try kiro-auth-token.json
    const kiroTokenFile = "kiro-auth-token.json";
    if (files.includes(kiroTokenFile)) {
      try {
        const content = await readFile(join(cachePath, kiroTokenFile), "utf-8");
        extractFromData(JSON.parse(content), kiroTokenFile);
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
          if (extractFromData(JSON.parse(content), file)) break;
        } catch {
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
      clientId,
      clientSecret,
      region,
      authMethod,
      source: foundFile,
    });
  } catch (error) {
    console.log("Kiro auto-import error:", error);
    return NextResponse.json(
      { found: false, error: error.message },
      { status: 500 }
    );
  }
}
