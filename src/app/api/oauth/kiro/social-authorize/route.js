import { NextResponse } from "next/server";
import { generatePKCE } from "@/lib/oauth/utils/pkce";
import { KiroService } from "@/lib/oauth/services/kiro";
import { saveSocialOAuthState } from "@/lib/oauth/socialStateStore";

/**
 * GET /api/oauth/kiro/social-authorize
 * Generate Google/GitHub social login URL for manual callback flow.
 *
 * The PKCE code verifier and CSRF state are stored server-side keyed by
 * `state`, so the verifier is never exposed to the browser. The exchange
 * route consumes the same state to retrieve the verifier and validates the
 * provider matches.
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

    saveSocialOAuthState(state, {
      provider,
      codeVerifier,
      codeChallenge,
    });

    return NextResponse.json({
      authUrl,
      state,
      provider,
    });
  } catch (error) {
    console.error("Kiro social authorize error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
