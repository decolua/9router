import { NextResponse } from "next/server";
import { KiroService } from "@/lib/oauth/services/kiro";
import { createProviderConnection } from "@/models";
import { getActiveCapture, dropActiveCapture } from "../captureStore";

/**
 * POST /api/oauth/kiro/external-idp/exchange
 *
 * Completes the external IdP (Microsoft Entra ID) OAuth flow.
 *
 * Body:
 *   - issuerUrl:    tenant issuer URL (echoed from authorize)
 *   - clientId:     Azure App client id (echoed from authorize)
 *   - scopes:       space-separated scope string (echoed from authorize)
 *   - state:        state from authorize, used to look up the captured code
 *   - code:         (optional) authorization code; if absent, the route
 *                   awaits the loopback capture registered during authorize
 *   - codeVerifier: PKCE verifier (kept client-side; never sent in authorize)
 *   - region:       CodeWhisperer region (defaults to "us-east-1")
 *
 * Returns:
 *   - success, connection { id, provider, email }
 *
 * On failure returns a generic 500 message and logs the upstream error
 * server-side to avoid leaking IdP details to the client.
 */
export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const {
      issuerUrl,
      clientId,
      scopes,
      state,
      code: providedCode,
      codeVerifier,
      region = "us-east-1",
    } = body || {};

    if (!issuerUrl || !clientId || !codeVerifier || !state) {
      return NextResponse.json(
        { error: "issuerUrl, clientId, codeVerifier, and state are required" },
        { status: 400 }
      );
    }

    const kiroService = new KiroService();

    // Resolve the authorization code either from the request body (manual paste
    // path) or from the in-flight loopback capture (auto path).
    let code = providedCode;
    if (!code) {
      const capture = getActiveCapture(state);
      if (!capture) {
        return NextResponse.json(
          { error: "No pending OAuth flow for this state. Restart the sign-in." },
          { status: 410 }
        );
      }
      try {
        const captured = await capture.promise;
        code = captured.code;
      } catch (err) {
        dropActiveCapture(state);
        return NextResponse.json(
          { error: err.message || "OAuth capture failed" },
          { status: 400 }
        );
      }
    }

    // Exchange the code for tokens.
    const tokens = await kiroService.exchangeExternalIdpCode({
      issuerUrl,
      clientId,
      code,
      codeVerifier,
      scopes,
    });

    // Resolve a CodeWhisperer profile ARN — the access token must be sent
    // with `tokentype: EXTERNAL_IDP` (handled by open-sse/executors/kiro.js).
    let profileArn = null;
    try {
      profileArn = await kiroService.listAvailableProfiles(tokens.accessToken, region);
    } catch (err) {
      console.error("Kiro external-idp profile resolution failed:", err.message);
      // Continue without profileArn — store still succeeds, refresh on next
      // request will attempt again.
    }

    const email = tokens.idToken ? kiroService.extractEmailFromJWT(tokens.idToken) : null;
    const expiresAt = new Date(Date.now() + (tokens.expiresIn || 3600) * 1000).toISOString();

    const connection = await createProviderConnection({
      provider: "kiro",
      authType: "oauth",
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken || null,
      expiresAt,
      email: email || null,
      providerSpecificData: {
        profileArn,
        region,
        authMethod: "external_idp",
        provider: "External IdP",
        idp: "microsoft-entra-id",
        issuerUrl,
        clientId,
        scopes: scopes || null,
      },
      testStatus: profileArn ? "active" : "untested",
    });

    dropActiveCapture(state);

    return NextResponse.json({
      success: true,
      connection: {
        id: connection.id,
        provider: connection.provider,
        email: connection.email,
      },
    });
  } catch (error) {
    console.error("Kiro external-idp exchange error:", error.message);
    return NextResponse.json(
      { error: "External IdP sign-in failed. Check server logs for details." },
      { status: 500 }
    );
  }
}