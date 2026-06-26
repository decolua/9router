import { NextResponse } from "next/server";
import { exchangeKiroHostedSsoCapture } from "@/lib/oauth/services/kiroHostedSso";
import { KiroService } from "@/lib/oauth/services/kiro";
import { createProviderConnection } from "@/models";
import { getActiveCapture, dropActiveCapture } from "../captureStore";

/**
 * POST /api/oauth/kiro/external-idp/exchange
 *
 * Polls a Kiro hosted-portal sign-in session and, once the browser flow
 * completes, exchanges the captured code for tokens and persists the
 * connection. Mirrors Kiro-Go's /auth/kiro-sso/poll route.
 *
 * Body:
 *   - sessionId: id returned by POST /authorize
 *
 * Returns:
 *   - { completed: false }                     while the user is still signing in
 *   - { completed: true, connection }          once the account is created
 *   - { error }                                on terminal failure
 */
export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const sessionId = body?.sessionId;
    if (!sessionId) {
      return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
    }

    const stored = getActiveCapture(sessionId);
    if (!stored) {
      return NextResponse.json(
        { error: "No pending sign-in for this session. Restart the sign-in." },
        { status: 410 }
      );
    }

    // Race the capture against a short tick so the request never blocks the event
    // loop. "tick" => still waiting on the browser; resolved => captured; an Error
    // => the flow failed/cancelled/timed out.
    const tick = new Promise((resolve) => setTimeout(() => resolve("tick"), 250));
    const outcome = await Promise.race([
      stored.session.promise.then((capture) => ({ capture })).catch((err) => err),
      tick,
    ]);

    if (outcome === "tick") {
      return NextResponse.json({ success: true, completed: false, status: "pending" });
    }
    if (outcome instanceof Error) {
      dropActiveCapture(sessionId);
      return NextResponse.json(
        { success: false, error: outcome.message || "Kiro sign-in failed" },
        { status: 400 }
      );
    }

    // Captured — exchange the code for tokens off the loopback result.
    dropActiveCapture(sessionId);
    const region = stored.region || "us-east-1";
    const result = await exchangeKiroHostedSsoCapture(outcome.capture, { region });

    // Resolve a CodeWhisperer profile ARN. For external_idp tokens this requires
    // the EXTERNAL_IDP token type, which the runtime executor adds on data-plane
    // calls; the initial resolution is best-effort and refresh resolves it later.
    let profileArn = result.profileArn || null;
    if (!profileArn) {
      try {
        const kiro = new KiroService();
        profileArn = await kiro.listAvailableProfiles(result.accessToken, region, {
          authMethod: result.authMethod,
        });
      } catch (err) {
        console.error("Kiro hosted SSO profile resolution failed:", err.message);
      }
    }

    const expiresAt = new Date(Date.now() + (result.expiresIn || 3600) * 1000).toISOString();
    const connection = await createProviderConnection({
      provider: "kiro",
      authType: "oauth",
      accessToken: result.accessToken,
      refreshToken: result.refreshToken || null,
      expiresAt,
      email: result.email || null,
      providerSpecificData: {
        profileArn,
        region,
        authMethod: result.authMethod,
        provider: result.provider,
        idp: result.idp,
        ...(result.issuerUrl ? { issuerUrl: result.issuerUrl } : {}),
        ...(result.tokenEndpoint ? { tokenEndpoint: result.tokenEndpoint } : {}),
        ...(result.clientId ? { clientId: result.clientId } : {}),
        ...(result.scopes ? { scopes: result.scopes } : {}),
      },
      testStatus: profileArn ? "active" : "untested",
    });

    return NextResponse.json({
      success: true,
      completed: true,
      connection: {
        id: connection.id,
        provider: connection.provider,
        email: connection.email,
        authMethod: result.authMethod,
      },
    });
  } catch (error) {
    console.error("Kiro hosted SSO exchange error:", error.message);
    return NextResponse.json(
      { error: "Kiro sign-in failed. Check server logs for details." },
      { status: 500 }
    );
  }
}
