import { NextResponse } from "next/server";
import { 
  MICROSOFT_OAUTH_CONFIG, 
  exchangeCodeForToken, 
  fetchMicrosoftUserProfile 
} from "@/lib/auth/microsoft";
import { getOrCreateUserByOAuth } from "@/lib/localDb";
import { SignJWT } from "jose";
import { cookies } from "next/headers";

const SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "9router-default-secret-change-me"
);

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get("code");
    const state = searchParams.get("state");
    const error = searchParams.get("error");
    
    // Check for OAuth errors
    if (error) {
      const errorDesc = searchParams.get("error_description") || error;
      return NextResponse.redirect(
        new URL(`/login?error=${encodeURIComponent(errorDesc)}`, request.url)
      );
    }
    
    // Verify state to prevent CSRF
    const cookieStore = await cookies();
    const storedState = cookieStore.get("oauth_state")?.value;
    const codeVerifier = cookieStore.get("oauth_code_verifier")?.value;
    
    if (!state || state !== storedState) {
      return NextResponse.redirect(
        new URL("/login?error=Invalid+state", request.url)
      );
    }
    
    cookieStore.delete("oauth_state");
    cookieStore.delete("oauth_code_verifier");
    
    if (!code) {
      return NextResponse.redirect(
        new URL("/login?error=No+authorization+code", request.url)
      );
    }
    
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 
      `${request.nextUrl.protocol}//${request.nextUrl.host}`;
    
    // Exchange code for access token (PKCE code_verifier required by Microsoft)
    const tokenData = await exchangeCodeForToken(code, baseUrl, codeVerifier);
    const accessToken = tokenData.access_token;
    
    if (!accessToken) {
      return NextResponse.redirect(
        new URL("/login?error=No+access+token", request.url)
      );
    }
    
    // Fetch user profile from Microsoft Graph
    const profile = await fetchMicrosoftUserProfile(accessToken);
    
    // Create or get user
    const user = await getOrCreateUserByOAuth("microsoft", profile.id, {
      email: profile.mail || profile.userPrincipalName,
      displayName: profile.displayName,
      tenantId: profile.tenantId,
    });
    
    // Create JWT with user info
    const token = await new SignJWT({ 
      userId: user.id,
      email: user.email,
      displayName: user.displayName,
      isAdmin: user.isAdmin,
      tenantId: user.tenantId,
    })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("24h")
      .sign(SECRET);
    
    // Set auth cookie
    const forceSecureCookie = process.env.AUTH_COOKIE_SECURE === "true";
    const isHttpsRequest = request.nextUrl.protocol === "https:";
    const useSecureCookie = forceSecureCookie || isHttpsRequest;
    
    cookieStore.set("auth_token", token, {
      httpOnly: true,
      secure: useSecureCookie,
      sameSite: "lax",
      path: "/",
    });
    
    // Redirect to dashboard
    return NextResponse.redirect(new URL("/dashboard", request.url));
  } catch (error) {
    console.error("Microsoft OAuth callback error:", error);
    return NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(error.message)}`, request.url)
    );
  }
}
