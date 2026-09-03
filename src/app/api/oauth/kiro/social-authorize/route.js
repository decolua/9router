import { NextResponse } from "next/server";
import { sanitizeOAuthError } from "open-sse/utils/oauthError.js";
import { generatePKCE } from "@/lib/oauth/utils/pkce";
import { KiroService } from "@/lib/oauth/services/kiro";
import { ensureOutboundProxyInitialized } from "@/lib/network/initOutboundProxy";
import { proxyOptionsForPool } from "@/lib/oauth/proxyOptions";
import { registerAuthorizationFlow } from "@/lib/oauth/utils/server";

/**
 * GET /api/oauth/kiro/social-authorize
 * Generate Google/GitHub social login URL for manual callback flow
 * Uses kiro:// custom protocol as required by AWS Cognito
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const provider = searchParams.get("provider"); // "google" or "github"
    const proxyPoolId = searchParams.get("proxyPoolId");

    if (!provider || !["google", "github"].includes(provider)) {
      return NextResponse.json(
        { error: "Invalid provider. Use 'google' or 'github'" },
        { status: 400 }
      );
    }

    await ensureOutboundProxyInitialized();
    const proxyOptions = await proxyOptionsForPool(proxyPoolId);

    // Generate PKCE for social auth
    const { codeVerifier, codeChallenge, state } = generatePKCE();

    const kiroService = new KiroService();
    const authUrl = kiroService.buildSocialLoginUrl(
      provider,
      codeChallenge,
      state
    );

    if (!registerAuthorizationFlow({
      kind: "kiro-social",
      provider,
      state,
      codeVerifier,
      proxyPoolId: proxyPoolId || "",
      proxyOptions,
    })) {
      return NextResponse.json({ error: "OAuth flow capacity reached; retry later" }, { status: 503 });
    }

    return NextResponse.json({
      authUrl,
      state,
      provider,
    });
  } catch (error) {
    const publicError = sanitizeOAuthError(error);
    console.log("Kiro social authorize error:", publicError);
    return NextResponse.json({ error: publicError }, { status: 500 });
  }
}
