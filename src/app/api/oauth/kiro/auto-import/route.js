import { NextResponse } from "next/server";
import { readFile, readdir } from "fs/promises";
import { homedir } from "os";
import { join } from "path";
import { KiroService } from "@/lib/oauth/services/kiro";
import { createProviderConnection, isCloudEnabled } from "@/models";
import { getConsistentMachineId } from "@/shared/utils/machineId";

/**
 * GET /api/oauth/kiro/auto-import
 * Auto-detect and extract Kiro refresh token from AWS SSO cache
 * Returns the refresh token for manual import
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
    let foundFile = null;

    // First try kiro-auth-token.json
    const kiroTokenFile = "kiro-auth-token.json";
    if (files.includes(kiroTokenFile)) {
      try {
        const content = await readFile(join(cachePath, kiroTokenFile), "utf-8");
        const data = JSON.parse(content);
        if (data.refreshToken && data.refreshToken.startsWith("aorAAAAAG")) {
          refreshToken = data.refreshToken;
          foundFile = kiroTokenFile;
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

          // Look for Kiro refresh token (starts with aorAAAAAG)
          if (data.refreshToken && data.refreshToken.startsWith("aorAAAAAG")) {
            refreshToken = data.refreshToken;
            foundFile = file;
            break;
          }
        } catch (error) {
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
      { found: false, error: error.message },
      { status: 500 }
    );
  }
}

/**
 * POST /api/oauth/kiro/auto-import
 * Complete the auto-import by validating token and storing connection with profileArn
 */
export async function POST(request) {
  try {
    const { refreshToken } = await request.json();

    if (!refreshToken || typeof refreshToken !== "string") {
      return NextResponse.json(
        { error: "Refresh token is required" },
        { status: 400 }
      );
    }

    const kiroService = new KiroService();

    // Validate and refresh token to get profileArn
    const tokenData = await kiroService.validateImportToken(refreshToken.trim());

    // Extract email from JWT if available
    const email = kiroService.extractEmailFromJWT(tokenData.accessToken);

    // Save to database with profileArn
    const connection = await createProviderConnection({
      provider: "kiro",
      authType: "oauth",
      accessToken: tokenData.accessToken,
      refreshToken: tokenData.refreshToken,
      expiresAt: new Date(Date.now() + tokenData.expiresIn * 1000).toISOString(),
      email: email || null,
      providerSpecificData: {
        profileArn: tokenData.profileArn,
        authMethod: "auto-import",
        provider: "AWS SSO",
      },
      testStatus: "active",
    });

    // Auto sync to Cloud if enabled
    await syncToCloudIfEnabled();

    return NextResponse.json({
      success: true,
      connection: {
        id: connection.id,
        provider: connection.provider,
        email: connection.email,
      },
    });
  } catch (error) {
    console.log("Kiro auto-import complete error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * Sync to Cloud if enabled
 */
async function syncToCloudIfEnabled() {
  try {
    const cloudEnabled = await isCloudEnabled();
    if (!cloudEnabled) return;

    const machineId = await getConsistentMachineId();
    await fetch(`${process.env.INTERNAL_BASE_URL || "http://localhost:20130"}/api/sync/cloud`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ machineId, action: "sync" }),
    });
  } catch (error) {
    console.log("Error syncing to cloud after Kiro auto-import:", error);
  }
}
