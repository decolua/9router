import { NextResponse } from "next/server";
import { exchangeTokens } from "@/lib/oauth/providers";
import { ANTIGRAVITY_CONFIG } from "@/lib/oauth/constants/oauth";

async function fetchEmail(accessToken) {
  if (!accessToken) return null;
  try {
    const response = await fetch(`${ANTIGRAVITY_CONFIG.userInfoUrl}?alt=json`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "x-request-source": "local",
      },
    });
    if (!response.ok) return null;
    const data = await response.json();
    return data?.email || null;
  } catch {
    return null;
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { code, redirectUri, codeVerifier, state } = body;

    if (!code || !redirectUri || !codeVerifier) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const tokenData = await exchangeTokens(
      "antigravity",
      code,
      redirectUri,
      codeVerifier,
      state,
    );

    const refreshToken = tokenData?.refreshToken;
    if (!refreshToken) {
      return NextResponse.json(
        { error: "No refresh token returned. Re-authenticate and grant full access." },
        { status: 400 },
      );
    }

    const email = tokenData?.email || (await fetchEmail(tokenData?.accessToken)) || "unknown";

    return NextResponse.json({
      success: true,
      email,
      refreshToken,
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
