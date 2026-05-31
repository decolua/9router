import { NextResponse } from "next/server";
import { KiroService } from "@/lib/oauth/services/kiro";
import { createProviderConnection } from "@/models";

/**
 * POST /api/oauth/kiro/social-exchange
 * Exchange Google/GitHub social authorization code for Kiro tokens
 * and persist them as a Kiro connection. The browser captures the
 * code from the localhost:3128 callback page (manual paste or
 * automatic if the callback page is open) and POSTs it here.
 */
export async function POST(request) {
  try {
    const { code, codeVerifier, provider } = await request.json();

    if (!code || !codeVerifier) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    if (!provider || !["google", "github"].includes(provider)) {
      return NextResponse.json(
        { error: "Invalid provider" },
        { status: 400 }
      );
    }

    const kiroService = new KiroService();
    const tokenData = await kiroService.exchangeSocialCode(
      code,
      codeVerifier,
      provider
    );
    const email = kiroService.extractEmailFromJWT(tokenData.accessToken);

    const connection = await createProviderConnection({
      provider: "kiro",
      authType: "oauth",
      accessToken: tokenData.accessToken,
      refreshToken: tokenData.refreshToken,
      expiresAt: new Date(Date.now() + (tokenData.expiresIn || 3600) * 1000).toISOString(),
      email: email || null,
      providerSpecificData: {
        profileArn: tokenData.profileArn,
        authMethod: "social",
        socialProvider: provider,
        provider: provider.charAt(0).toUpperCase() + provider.slice(1),
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
    console.error("Kiro social exchange error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
