import { NextResponse } from "next/server";
import { KiroService } from "@/lib/oauth/services/kiro";
import { createProviderConnection } from "@/models";
import { resolveKiroCredentialsFromCache } from "@/lib/oauth/kiroSsoCache";
import { normalizeKiroExternalIdpAuth } from "@/lib/oauth/kiroExternalIdp";

/**
 * POST /api/oauth/kiro/import
 * Import and validate refresh token from Kiro IDE.
 * For IDC (organization) tokens, accepts clientId/clientSecret/region so the
 * token can be refreshed via the regional AWS OIDC endpoint.
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

    const kiroService = new KiroService();
    const isIdc = !!(clientId && clientSecret);

    let resolvedProviderData = isIdc
      ? { clientId, clientSecret, region: region || "us-east-1", authMethod: "idc" }
      : {};

    let resolvedProfileArn = profileArn || null;

    // Try to resolve the token from local SSO cache.
    try {
      const cacheResult = await resolveKiroCredentialsFromCache(refreshToken.trim());
      if (cacheResult.authMethod === "external_idp" && cacheResult.rawAuth) {
        const tokenData = normalizeKiroExternalIdpAuth(cacheResult.rawAuth);
        resolvedProviderData = tokenData.providerSpecificData;
        resolvedProfileArn = tokenData.providerSpecificData.profileArn;
      }
    } catch (cacheError) {
      // Ignore cache errors and proceed with standard flow
    }

    const tokenData = await kiroService.refreshToken(refreshToken.trim(), resolvedProviderData);

    const email = kiroService.extractEmailFromJWT(tokenData.accessToken);
    const resolvedAuthMethod = tokenData.providerSpecificData?.authMethod || (isIdc ? "idc" : "imported");
    const providerLabel = tokenData.providerSpecificData?.provider || (isIdc ? "Enterprise" : "Imported");
    resolvedProfileArn = resolvedProfileArn || tokenData.providerSpecificData?.profileArn || tokenData.profileArn || null;

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
        ...(isIdc ? { clientId, clientSecret, region: region || "us-east-1" } : {}),
        ...(tokenData.providerSpecificData?.authMethod === "external_idp" ? tokenData.providerSpecificData : {})
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
