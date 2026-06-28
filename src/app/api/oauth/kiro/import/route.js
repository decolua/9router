import { NextResponse } from "next/server";
import { KiroService } from "@/lib/oauth/services/kiro";
import { createProviderConnection, getProviderConnections } from "@/models";
import crypto from "crypto";

/**
 * POST /api/oauth/kiro/import
 * Import and validate refresh token from Kiro IDE.
 *
 * Rejects duplicate imports of the same refresh token (matched by SHA-256
 * fingerprint). For IDC (organization) tokens, accepts clientId/clientSecret/region
 * so the token can be refreshed via the regional AWS OIDC endpoint.
 */
export async function POST(request) {
  try {
    const { refreshToken, clientId, clientSecret, region, authMethod, profileArn } = await request.json();

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
      const duplicate = (existing || []).find((c) => {
        // Check stored fingerprint first (new imports have it)
        if (c?.providerSpecificData?.tokenFingerprint === tokenFingerprint) return true;
        // Fallback for pre-migration connections: compute from stored refreshToken
        if (c?.refreshToken) {
          const existingFp = crypto.createHash("sha256").update(c.refreshToken).digest("hex").slice(0, 16);
          return existingFp === tokenFingerprint;
        }
        return false;
      });
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
    const isIdc = !!(clientId && clientSecret);

    // For IDC tokens, refresh via the regional OIDC endpoint with client credentials.
    // For imported desktop tokens, use the standard Kiro import validation path.
    const providerSpecificData = isIdc
      ? { clientId, clientSecret, region: region || "us-east-1", authMethod: "idc" }
      : {};

    const tokenData = isIdc
      ? await kiroService.refreshToken(trimmed, providerSpecificData)
      : await kiroService.validateImportToken(trimmed);

    const email = kiroService.extractEmailFromJWT(tokenData.accessToken);
    const resolvedAuthMethod = isIdc ? "idc" : "imported";
    const providerLabel = isIdc ? "Enterprise" : "Imported";
    const resolvedProfileArn = profileArn || tokenData.profileArn || null;

    const connection = await createProviderConnection({
      provider: "kiro",
      authType: "oauth",
      accessToken: tokenData.accessToken,
      refreshToken: tokenData.refreshToken || refreshToken.trim(),
      expiresAt: new Date(Date.now() + (tokenData.expiresIn || 3600) * 1000).toISOString(),
      email: email || null,
      providerSpecificData: {
        profileArn: resolvedProfileArn,
        authMethod: resolvedAuthMethod,
        provider: providerLabel,
        tokenFingerprint,
        ...(isIdc ? { clientId, clientSecret, region: region || "us-east-1" } : {}),
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
