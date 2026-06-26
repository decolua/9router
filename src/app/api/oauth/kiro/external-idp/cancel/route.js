import { NextResponse } from "next/server";
import { cancelKiroHostedSsoSession } from "@/lib/oauth/services/kiroHostedSso";
import { getActiveCapture, dropActiveCapture } from "../captureStore";

/**
 * POST /api/oauth/kiro/external-idp/cancel
 *
 * Releases the transient localhost:3128 listener when the user closes/cancels the
 * hosted Kiro SSO modal before the browser flow completes.
 */
export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const sessionId = body?.sessionId;
  if (sessionId) {
    const stored = getActiveCapture(sessionId);
    if (stored?.session) {
      cancelKiroHostedSsoSession(stored.session);
    }
    dropActiveCapture(sessionId);
  }
  return NextResponse.json({ success: true });
}
