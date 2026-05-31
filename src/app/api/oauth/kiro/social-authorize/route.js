import { NextResponse } from "next/server";
import { generatePKCE } from "@/lib/oauth/utils/pkce";
import { KiroService } from "@/lib/oauth/services/kiro";

/**
 * GET /api/oauth/kiro/social-authorize
 * Generate Google/GitHub social login URL for manual callback flow.
 * The generated URL uses Kiro's desktop auth backend + localhost:3128 callback.
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const provider = searchParams.get("provider");

    if (!provider || !["google", "github"].includes(provider)) {
      return NextResponse.json(
        { error: "Invalid provider. Use 'google' or 'github'" },
        { status: 400 }
      );
    }

    const { codeVerifier, codeChallenge, state } = generatePKCE();
    const kiroService = new KiroService();
    const authUrl = kiroService.buildSocialLoginUrl(provider, codeChallenge, state);

    return NextResponse.json({
      authUrl,
      state,
      codeVerifier,
      codeChallenge,
      provider,
    });
  } catch (error) {
    console.error("Kiro social authorize error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
