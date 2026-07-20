import { NextResponse } from "next/server";
import { sanitizeOAuthError } from "open-sse/utils/oauthError.js";
import { KiroService } from "@/lib/oauth/services/kiro";
import { createProviderConnection } from "@/models";
import { ensureOutboundProxyInitialized } from "@/lib/network/initOutboundProxy";
import {
  claimAuthorizationFlow,
  clearAuthorizationFlow,
  isAuthorizationFlowCurrent,
} from "@/lib/oauth/utils/server";

/**
 * POST /api/oauth/kiro/social-exchange
 * Exchange authorization code for tokens (Google/GitHub social login)
 * Callback URL will be in format: kiro://kiro.kiroAgent/authenticate-success?code=XXX&state=YYY
 */
export async function POST(request) {
  try {
    const { code, state, provider } = await request.json();

    if (!code || !state) {
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

    const flow = claimAuthorizationFlow("kiro-social", provider, state);
    if (!flow) {
      return NextResponse.json(
        { error: "OAuth flow state is invalid, expired, or already used" },
        { status: 409 },
      );
    }

    try {
      await ensureOutboundProxyInitialized();
      const kiroService = new KiroService();

      // Exchange code for tokens (redirect_uri handled internally)
      const tokenData = await kiroService.exchangeSocialCode(
        code,
        flow.codeVerifier,
        flow.proxyOptions,
      );

      if (!isAuthorizationFlowCurrent("kiro-social", provider, state, flow.identity)) {
        return NextResponse.json({ error: "OAuth flow was cancelled" }, { status: 409 });
      }

      // Extract email from JWT if available
      const email = kiroService.extractEmailFromJWT(tokenData.accessToken);

      // Save to database
      const connection = await createProviderConnection({
        provider: "kiro",
        authType: "oauth",
        accessToken: tokenData.accessToken,
        refreshToken: tokenData.refreshToken,
        expiresAt: new Date(Date.now() + tokenData.expiresIn * 1000).toISOString(),
        email: email || null,
        providerSpecificData: {
          profileArn: tokenData.profileArn,
          authMethod: provider,
          provider: provider.charAt(0).toUpperCase() + provider.slice(1),
          ...(flow.proxyPoolId && flow.proxyPoolId !== "__none__" ? { proxyPoolId: flow.proxyPoolId } : {}),
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
    } finally {
      clearAuthorizationFlow("kiro-social", provider, state, flow.identity);
    }
  } catch (error) {
    const publicError = sanitizeOAuthError(error);
    console.log("Kiro social exchange error:", publicError);
    return NextResponse.json({ error: publicError }, { status: 500 });
  }
}
