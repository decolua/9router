import { NextResponse } from "next/server";
import { MICROSOFT_OAUTH_CONFIG } from "@/lib/auth/microsoft";

/**
 * GET /api/auth/microsoft/config
 * Returns public config for SPA flow (clientId, redirectUri, scope, authorizeUrl).
 * Only used when app is registered as public client (SPA); token exchange must happen in browser.
 */
export async function GET(request) {
  if (!MICROSOFT_OAUTH_CONFIG.isEnabled || !MICROSOFT_OAUTH_CONFIG.isPublicClient) {
    return NextResponse.json({ error: "Not available" }, { status: 404 });
  }
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ||
    `${request.nextUrl.protocol}//${request.nextUrl.host}`;
  const redirectUri =
    process.env.MICROSOFT_REDIRECT_URI || `${baseUrl}/login/callback`;
  return NextResponse.json({
    clientId: MICROSOFT_OAUTH_CONFIG.clientId,
    redirectUri,
    scope: MICROSOFT_OAUTH_CONFIG.scope,
    authorizeUrl: MICROSOFT_OAUTH_CONFIG.authorizeUrl,
    tokenUrl: MICROSOFT_OAUTH_CONFIG.tokenUrl,
  });
}
