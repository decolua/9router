import { NextResponse } from "next/server";
import { readFile, readdir } from "fs/promises";
import { homedir } from "os";
import { join } from "path";

/**
 * Check whether an AWS SSO cache entry looks like a Kiro token.
 * Accepts Builder ID (aorAAAAAG prefix), external_idp (Microsoft Entra),
 * and organization tokens with codewhisperer scopes.
 */
function isKiroToken(data) {
  if (!data?.refreshToken) return false;
  if (data.refreshToken.startsWith("aorAAAAAG")) return true;
  if (data.authMethod === "external_idp") return true;
  if (Array.isArray(data.scopes) && data.scopes.some(s => s.includes("codewhisperer"))) return true;
  return false;
}

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
        if (isKiroToken(data)) {
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
          if (isKiroToken(data)) {
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

    // For external_idp tokens, build a minimal payload containing only the
    // fields the import-cli-proxy normalizer needs — avoids leaking the full
    // SSO cache (which may include clientSecret, clientIdHash, etc.).
    const rawAuth = authMethod === "external_idp" ? {
      auth_method: tokenData.authMethod,
      access_token: tokenData.accessToken,
      refresh_token: tokenData.refreshToken,
      client_id: tokenData.clientId || clientId,
      token_endpoint: tokenData.tokenEndpoint,
      scopes: tokenData.scopes,
      region: tokenData.region,
      profile_arn: profileArn,
      ...(tokenData.expiresAt ? { expired: tokenData.expiresAt } : {}),
    } : undefined;

    return NextResponse.json({
      found: true,
      refreshToken,
      source: foundFile,
      clientId,
      clientSecret,
      region,
      authMethod,
      profileArn,
      ...(rawAuth ? { rawAuth } : {}),
    });
  } catch (error) {
    console.log("Kiro auto-import error:", error);
    return NextResponse.json(
      { found: false, error: error.message },
      { status: 500 }
    );
  }
}
