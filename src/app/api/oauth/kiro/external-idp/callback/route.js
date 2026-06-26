import { NextResponse } from "next/server";
import { submitKiroHostedSsoCallback } from "@/lib/oauth/services/kiroHostedSso";
import { KIRO_EXTERNAL_IDP_DEFAULTS } from "@/lib/oauth/constants/oauth";
import { getActiveCapture, dropActiveCapture } from "../captureStore";

/**
 * POST /api/oauth/kiro/external-idp/callback
 *
 * Manual fallback for environments where the loopback listener cannot receive
 * localhost:3128 redirects (container, remote browser, blocked port). The user
 * pastes the full callback URL here. If it is the enterprise descriptor leg, the
 * route returns a Microsoft IdP URL to open next; if it is the final code leg,
 * the existing poll route will complete the connection.
 */
export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { sessionId, callbackUrl } = body || {};
    if (!sessionId || !callbackUrl) {
      return NextResponse.json({ error: "sessionId and callbackUrl are required" }, { status: 400 });
    }

    const stored = getActiveCapture(sessionId);
    if (!stored?.session) {
      return NextResponse.json(
        { error: "No pending sign-in for this session. Restart the sign-in." },
        { status: 410 }
      );
    }

    if (Date.now() - (stored.startedAt || 0) > KIRO_EXTERNAL_IDP_DEFAULTS.loopbackTimeoutMs) {
      dropActiveCapture(sessionId);
      return NextResponse.json(
        { error: "This sign-in session expired. Restart the sign-in." },
        { status: 410 }
      );
    }

    const result = await submitKiroHostedSsoCallback(stored.session, callbackUrl);
    if (result.action === "redirect") {
      return NextResponse.json({ success: true, nextUrl: result.location, status: "redirect" });
    }
    if (result.action === "success") {
      return NextResponse.json({ success: true, status: "captured" });
    }
    if (result.action === "failure") {
      return NextResponse.json({ success: false, error: "Callback reported a sign-in failure" }, { status: 400 });
    }
    return NextResponse.json({ success: true, status: "ignored" });
  } catch (error) {
    console.error("Kiro hosted SSO manual callback error:", error.message);
    return NextResponse.json({ error: error.message || "Invalid callback URL" }, { status: 400 });
  }
}
