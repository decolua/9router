import { NextResponse } from "next/server";
import { readFile, readdir } from "fs/promises";
import { homedir } from "os";
import { join } from "path";

/**
 * GET /api/oauth/kiro/auto-import
 * Auto-detect and extract Kiro refresh token from AWS SSO cache.
 * For IDC (organization) tokens, also resolves clientId/clientSecret from the
 * linked client registration file so token refresh works.
 */
export async function GET() {
  try {
    const cachePath = join(homedir(), ".aws/sso/cache");

    let files;
    try {
      files = await readdir(cachePath);
    } catch (error) {
      return NextResponse.json({
        found: false,
        error: "AWS SSO cache not found. Please login to Kiro IDE first.",
      });
    }

    let refreshToken = null;
    let foundFile = null;
    let tokenData = null;

    // First try kiro-auth-token.json
    const kiroTokenFile = "kiro-auth-token.json";
    if (files.includes(kiroTokenFile)) {
      try {
        const content = await readFile(join(cachePath, kiroTokenFile), "utf-8");
        const data = JSON.parse(content);
        if (data.refreshToken && data.refreshToken.startsWith("aorAAAAAG")) {
          refreshToken = data.refreshToken;
          foundFile = kiroTokenFile;
          tokenData = data;
        }
      } catch (error) {
        // Continue to search other files
      }
    }

    // If not found, search all .json files
    if (!refreshToken) {
      for (const file of files) {
        if (!file.endsWith(".json")) continue;
        try {
          const content = await readFile(join(cachePath, file), "utf-8");
          const data = JSON.parse(content);
          if (data.refreshToken && data.refreshToken.startsWith("aorAAAAAG")) {
            refreshToken = data.refreshToken;
            foundFile = file;
            tokenData = data;
            break;
          }
        } catch (error) {
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

    // For IDC/organization tokens, resolve clientId and clientSecret from
    // the linked client registration file (referenced by clientIdHash).
    let clientId = null;
    let clientSecret = null;
    const region = tokenData?.region || null;
    const authMethod = tokenData?.authMethod || null;

    if (tokenData?.clientIdHash) {
      const clientFile = `${tokenData.clientIdHash}.json`;
      try {
        const clientContent = await readFile(join(cachePath, clientFile), "utf-8");
        const clientData = JSON.parse(clientContent);
        if (clientData.clientId && clientData.clientSecret) {
          clientId = clientData.clientId;
          clientSecret = clientData.clientSecret;
        }
      } catch (error) {
        // Client registration file not found - continue without it
      }
    }

    // Read profileArn from Kiro IDE's profile.json.
    // Important: the runtime gateway requires us-east-1 in the ARN regardless
    // of the IDC region, so we normalize the region in the ARN to us-east-1.
    let profileArn = null;
    const kiroProfilePaths = [
      join(process.env.APPDATA || join(homedir(), "AppData", "Roaming"), "Kiro", "User", "globalStorage", "kiro.kiroagent", "profile.json"),
      join(homedir(), ".config", "Kiro", "User", "globalStorage", "kiro.kiroagent", "profile.json"),
    ];
    for (const profilePath of kiroProfilePaths) {
      try {
        const profileContent = await readFile(profilePath, "utf-8");
        const profileData = JSON.parse(profileContent);
        if (profileData.arn) {
          // Normalize region to us-east-1 for the runtime gateway
          profileArn = profileData.arn.replace(/arn:aws:codewhisperer:[^:]+:/, "arn:aws:codewhisperer:us-east-1:");
          break;
        }
      } catch (error) {
        continue;
      }
    }

    return NextResponse.json({
      found: true,
      refreshToken,
      source: foundFile,
      clientId,
      clientSecret,
      region,
      authMethod,
      profileArn,
    });
  } catch (error) {
    console.log("Kiro auto-import error:", error);
    return NextResponse.json(
      { found: false, error: error.message },
      { status: 500 }
    );
  }
}
