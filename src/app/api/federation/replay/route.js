import { NextResponse } from "next/server";
import { handleReplay, HttpError } from "@/lib/federation/server";
import { withFederationAuth } from "@/lib/federation/roleGuard";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

export const POST = withFederationAuth(async function POST(request) {
  try {
    const payload = await handleReplay(request);
    return NextResponse.json(payload, { headers: CORS_HEADERS });
  } catch (error) {
    if (error instanceof HttpError) {
      return NextResponse.json({ error: error.message, ...error.extra }, { status: error.status, headers: CORS_HEADERS });
    }
    console.error("[federation] replay error:", error);
    return NextResponse.json({ error: "Federation replay failed" }, { status: 500, headers: CORS_HEADERS });
  }
}, { corsHeaders: CORS_HEADERS });

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
