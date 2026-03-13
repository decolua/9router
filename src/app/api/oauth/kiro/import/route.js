import { NextResponse } from "next/server";
import { KiroService } from "@/lib/oauth/services/kiro";
import { createProviderConnection } from "@/models";

/**
 * POST /api/oauth/kiro/import
 * Import and validate refresh token from Kiro IDE
 */
export async function POST(request) {
  try {
    const { refreshToken, clientId, clientSecret, region, authMethod } = await request.json();

    if (!refreshToken || typeof refreshToken !== "string") {
      return NextResponse.json(
        { error: "Refresh token is required" },
        { status: 400 }
      );
    }

    const kiroService = new KiroService();

    // Normalize authMethod — file may store "IdC", "idc", "builder-id", etc.
    const normalizedAuthMethod = typeof authMethod === "string"
      ? authMethod.toLowerCase()
      : "builder-id";

    // providerSpecificData needed for AWS SSO OIDC refresh (Builder ID / IDC)
    const providerSpecificData = clientId && clientSecret
      ? { clientId, clientSecret, region: region || "us-east-1", authMethod: normalizedAuthMethod }
      : null;

    // Validate and refresh token
    const tokenData = await kiroService.validateImportToken(refreshToken.trim(), providerSpecificData);

    // Extract email from JWT if available
    const email = kiroService.extractEmailFromJWT(tokenData.accessToken);

    // Determine final authMethod and provider label for storage
    const finalAuthMethod = providerSpecificData?.authMethod || tokenData.authMethod || "imported";
    const isIDC = finalAuthMethod === "idc";
    const isBuilderID = finalAuthMethod === "builder-id";
    const providerLabel = isIDC ? "AWS IAM Identity Center" : isBuilderID ? "AWS Builder ID" : "Imported";

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
        authMethod: finalAuthMethod,
        provider: providerLabel,
        // Persist clientId/clientSecret for future token refreshes
        clientId: providerSpecificData?.clientId || tokenData.clientId || null,
        clientSecret: providerSpecificData?.clientSecret || tokenData.clientSecret || null,
        region: providerSpecificData?.region || tokenData.region || "us-east-1",
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
