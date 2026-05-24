import { NextResponse } from "next/server";
import { KiroService } from "@/lib/oauth/services/kiro";
import { createProviderConnection, getProviderConnections } from "@/models";

/**
 * POST /api/oauth/kiro/import
 * Import and validate refresh token from Kiro IDE.
 *
 * Rejects duplicate imports of the same Kiro identity (matched by
 * `profileArn`). Importing the same account twice causes Kiro upstream
 * to return 429 "Due to suspicious activity" because round-robin routing
 * sends concurrent requests from one identity.
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

    // Validate and refresh token
    const tokenData = await kiroService.validateImportToken(refreshToken.trim());

    // Extract email from JWT if available
    const email = kiroService.extractEmailFromJWT(tokenData.accessToken);

    // Guard: reject duplicate profileArn. Same Kiro identity imported twice
    // triggers upstream 429 "suspicious activity" when both connections are
    // routed in parallel.
    if (tokenData.profileArn) {
      try {
        const existing = await getProviderConnections({ provider: "kiro" });
        const duplicate = (existing || []).find(
          (c) => c?.providerSpecificData?.profileArn === tokenData.profileArn
        );
        if (duplicate) {
          return NextResponse.json(
            {
              error: "This Kiro account is already imported (same profileArn). Importing the same account twice causes upstream rate-limit errors.",
              existingConnectionId: duplicate.id,
              existingEmail: duplicate.email || null,
            },
            { status: 409 }
          );
        }
      } catch (lookupErr) {
        // Lookup failure should not block import — log and continue.
        console.log("Kiro import duplicate-check failed:", lookupErr?.message || lookupErr);
      }
    }

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
