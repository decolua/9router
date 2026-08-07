import { NextResponse } from "next/server";
import { handleDelta, HttpError } from "@/lib/federation/server";
import { withFederationAuth } from "@/lib/federation/roleGuard";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

export const GET = withFederationAuth(async function GET(request) {
  try {
    const payload = await handleDelta(request);
    return NextResponse.json(payload, { headers: CORS_HEADERS });
  } catch (error) {
    if (error instanceof HttpError) {
      return NextResponse.json({ error: error.message, ...error.extra }, { status: error.status, headers: CORS_HEADERS });
    }
    console.error("[federation] delta error:", error);
    return NextResponse.json({ error: "Failed to build delta" }, { status: 500, headers: CORS_HEADERS });
  }
}, { corsHeaders: CORS_HEADERS });

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
