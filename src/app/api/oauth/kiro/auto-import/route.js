import { NextResponse } from "next/server";
import { resolveKiroCredentialsFromCache } from "@/lib/oauth/kiroSsoCache";

/**
 * GET /api/oauth/kiro/auto-import
 * Auto-detect and extract Kiro refresh token from AWS SSO cache.
 * For IDC (organization) tokens, also resolves clientId/clientSecret from the
 * linked client registration file so token refresh works.
 */
export async function GET() {
  try {
    const credentials = await resolveKiroCredentialsFromCache();

    return NextResponse.json({
      found: true,
      refreshToken: credentials.refreshToken,
      source: credentials.source,
      clientId: credentials.clientId,
      clientSecret: credentials.clientSecret,
      region: credentials.region,
      authMethod: credentials.authMethod,
      profileArn: credentials.profileArn,
      ...(credentials.rawAuth ? { rawAuth: credentials.rawAuth } : {}),
    });
  } catch (error) {
    console.log("Kiro auto-import error:", error);
    return NextResponse.json(
      { found: false, error: error.message },
      { status: 500 }
    );
  }
}
