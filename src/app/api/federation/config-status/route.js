import { NextResponse } from "next/server";
import { handleConfigStatus, HttpError } from "@/lib/federation/server";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

// GET /api/federation/config-status
// Token-less read-only federation CONFIG surface for the instance's own
// dashboard config page (FED-005, spec §3.5). Local env values only; the
// token is reported as a boolean (configured yes/no) and its value NEVER
// leaves the server. The central URL is the edge's own configured
// FEDERATION_CENTRAL_URL (the address the edge proxies to), not a central
// secret. Standalone mode returns the same shape with mode 'standalone'.
export const GET = async function GET() {
  try {
    const payload = await handleConfigStatus();
    return NextResponse.json(payload, { headers: CORS_HEADERS });
  } catch (error) {
    if (error instanceof HttpError) {
      return NextResponse.json({ error: error.message, ...error.extra }, { status: error.status, headers: CORS_HEADERS });
    }
    console.error("[federation] config-status error:", error);
    return NextResponse.json({ error: "Federation config status failed" }, { status: 500, headers: CORS_HEADERS });
  }
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
