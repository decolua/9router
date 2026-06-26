import { NextResponse } from "next/server";
import { generateState } from "@/lib/oauth/utils/pkce";
import { startKiroHostedSsoSession } from "@/lib/oauth/services/kiroHostedSso";
import { setActiveCapture, getActiveCapture } from "../captureStore";

/**
 * POST /api/oauth/kiro/external-idp/authorize
 *
 * Starts the Kiro hosted-portal sign-in flow (the same flow as Kiro IDE):
 * app.kiro.dev/signin opens in the browser, detects enterprise SSO tenants,
 * and drives Microsoft Entra ID automatically through localhost:3128.
 */
export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const region = body?.region || "us-east-1";
    const sessionId = generateState();
    const started = startKiroHostedSsoSession({ region });

    setActiveCapture(sessionId, {
      ...started,
      region,
      startedAt: Date.now(),
    });

    // Avoid unhandled rejection if the browser flow errors before the poll route
    // consumes the session result.
    started.session.promise.catch(() => {});

    return NextResponse.json({
      success: true,
      sessionId,
      signInUrl: started.signInUrl,
      interval: 2,
    });
  } catch (error) {
    console.error("Kiro hosted SSO start error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * GET /api/oauth/kiro/external-idp/authorize?sessionId=...
 *
 * Lightweight status endpoint used only by diagnostics/manual checks. The UI uses
 * POST /exchange to poll+persist the connection, mirroring Kiro-Go's poll route.
 */
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get("sessionId") || searchParams.get("state");
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
  }
  const capture = getActiveCapture(sessionId);
  if (!capture) {
    return NextResponse.json({ status: "expired" });
  }
  return NextResponse.json({ status: "pending" });
}
