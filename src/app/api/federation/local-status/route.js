import { NextResponse } from "next/server";
import { handleLocalStatus, HttpError } from "@/lib/federation/server";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

// GET /api/federation/local-status
// Token-less LOCAL federation status for the instance's OWN dashboard
// (FED-005, spec §3.5: "token never reaches browser JS"). Deliberately NOT
// wrapped in withFederationAuth: the payload is built from local state only
// (federation_meta + env config) and never exposes central secrets — no
// token, no lease/fencing material, no central data. Standalone mode
// returns the same shape (role 'standalone', no last_state) so the
// FederationStatus banner renders nothing without a 401/403.
export const GET = async function GET() {
  try {
    const payload = await handleLocalStatus();
    return NextResponse.json(payload, { headers: CORS_HEADERS });
  } catch (error) {
    if (error instanceof HttpError) {
      return NextResponse.json({ error: error.message, ...error.extra }, { status: error.status, headers: CORS_HEADERS });
    }
    console.error("[federation] local-status error:", error);
    return NextResponse.json({ error: "Federation local status failed" }, { status: 500, headers: CORS_HEADERS });
  }
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
