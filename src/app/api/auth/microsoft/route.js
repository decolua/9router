import { NextResponse } from "next/server";
import { MICROSOFT_OAUTH_CONFIG } from "@/lib/auth/microsoft";
import { generatePKCE } from "@/lib/oauth/utils/pkce";

const COOKIE_OPTS = (request) => ({
  httpOnly: true,
  secure: process.env.AUTH_COOKIE_SECURE === "true" || request.nextUrl.protocol === "https:",
  sameSite: "lax",
  maxAge: 600, // 10 minutes
  path: "/",
});

export async function GET(request) {
  try {
    // Check if Microsoft OAuth is enabled
    if (!MICROSOFT_OAUTH_CONFIG.isEnabled) {
      return NextResponse.json(
        { error: "Microsoft OAuth is not enabled" },
        { status: 400 }
      );
    }
    
    // Get base URL from env or request
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 
      `${request.nextUrl.protocol}//${request.nextUrl.host}`;
    
    // PKCE required by Microsoft for cross-origin authorization code redemption (AADSTS9002325)
    const { codeVerifier, codeChallenge, state } = generatePKCE();
    
    // Build authorization URL with code_challenge
    const authUrl = MICROSOFT_OAUTH_CONFIG.getAuthorizationUrl(state, baseUrl, codeChallenge);
    
    const response = NextResponse.redirect(authUrl);
    
    response.cookies.set("oauth_state", state, COOKIE_OPTS(request));
    response.cookies.set("oauth_code_verifier", codeVerifier, COOKIE_OPTS(request));
    
    return response;
  } catch (error) {
    console.error("Microsoft OAuth initiation error:", error);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}
