import { NextResponse } from "next/server";
import { KiroService } from "@/lib/oauth/services/kiro";
import { createProviderConnection, getProviderConnections } from "@/models";
import crypto from "crypto";

/**
 * POST /api/oauth/kiro/import
 * Import and validate refresh token from Kiro IDE.
 *
 * Rejects duplicate imports of the same refresh token (matched by SHA-256
 * fingerprint). Importing the same token twice causes Kiro upstream to
 * return 429 "Due to suspicious activity" when both connections are
 * routed and hit the same identity's rate limit.
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

    const trimmed = refreshToken.trim();

    // Guard: reject duplicate refresh token. Same token imported twice
    // creates two connections that share one upstream identity rate limit,
    // triggering 429 "suspicious activity" under load.
    const tokenFingerprint = crypto.createHash("sha256").update(trimmed).digest("hex").slice(0, 16);
    try {
      const existing = await getProviderConnections({ provider: "kiro" });
      const duplicate = (existing || []).find(
        (c) => c?.providerSpecificData?.tokenFingerprint === tokenFingerprint
      );
      if (duplicate) {
        return NextResponse.json(
          {
            error: "This refresh token is already imported. Importing the same token twice causes upstream rate-limit errors.",
            existingConnectionId: duplicate.id,
          },
          { status: 409 }
        );
      }
    } catch (lookupErr) {
      // Lookup failure should not block import — log and continue.
      console.log("Kiro import duplicate-check failed:", lookupErr?.message || lookupErr);
    }

    const kiroService = new KiroService();

    // Validate and refresh token
    const tokenData = await kiroService.validateImportToken(trimmed);

    // Extract email from JWT if available
    const email = kiroService.extractEmailFromJWT(tokenData.accessToken);

    // Save to database
    const connection = await createProviderConnection({
      provider: "kiro",
      authType: "oauth",
      accessToken: tokenData.accessToken,
      refreshToken: tokenData.refreshToken,
      expiresAt: new Date(Date.now() + tokenData.expiresIn * 1000).toISOString(),
      email: email || null,
      providerSpecificData: {
        profileArn: tokenData.profileArn,
        authMethod: "imported",
        provider: "Imported",
        tokenFingerprint,
      },
      testStatus: "active",
    });

    return NextResponse.json({
      success: true,
      connection: {
        id: connection.id,
        provider: connection.provider,
        email: connection.email,
      },
    });
  } catch (error) {
    console.log("Kiro import token error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
