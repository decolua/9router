import { NextResponse } from "next/server";
import { fetchMicrosoftUserProfile } from "@/lib/auth/microsoft";
import { getOrCreateUserByOAuth } from "@/lib/localDb";
import { SignJWT } from "jose";
import { cookies } from "next/headers";

const SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "9router-default-secret-change-me"
);

/**
 * POST /api/auth/microsoft/session
 * SPA flow: client exchanged code for token in browser; sends access_token here to create server session.
 */
export async function POST(request) {
  try {
    const body = await request.json();
    const accessToken = body?.access_token;
    if (!accessToken) {
      return NextResponse.json({ error: "access_token required" }, { status: 400 });
    }
    const profile = await fetchMicrosoftUserProfile(accessToken);
    const user = await getOrCreateUserByOAuth("microsoft", profile.id, {
      email: profile.mail || profile.userPrincipalName,
      displayName: profile.displayName,
      tenantId: profile.tenantId,
    });
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
    const cookieStore = await cookies();
    const forceSecureCookie = process.env.AUTH_COOKIE_SECURE === "true";
    const forwardedProto = request.headers.get("x-forwarded-proto");
    const useSecureCookie = forceSecureCookie || forwardedProto === "https";
    cookieStore.set("auth_token", token, {
      httpOnly: true,
      secure: useSecureCookie,
      sameSite: "lax",
      path: "/",
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Microsoft session error:", error);
    return NextResponse.json(
      { error: error.message || "Session creation failed" },
      { status: 401 }
    );
  }
}
