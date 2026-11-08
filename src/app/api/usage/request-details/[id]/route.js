import { NextResponse } from "next/server";
import { getRequestDetailById } from "@/lib/usageDb";
import { verifyDashboardAuthToken } from "@/lib/auth/dashboardSession";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * GET /api/usage/request-details/:id
 *
 * Full request/response payloads are conversation history, so this endpoint
 * requires an explicit dashboard session (JWT cookie) even when requireLogin is
 * disabled. The list endpoint stays redacted; the dashboard fetches this one
 * only when the user opens a row's Detail drawer.
 */
export async function GET(request, { params }) {
  const { id } = await params;
  const detailId = typeof id === "string" ? id.trim() : "";
  if (!detailId) {
    return NextResponse.json({ error: "Missing request detail id" }, { status: 400, headers: NO_STORE });
  }

  const token = request.cookies.get("auth_token")?.value;
  if (!(await verifyDashboardAuthToken(token))) {
    return NextResponse.json(
      { error: "Dashboard session required", code: "auth_required" },
      { status: 401, headers: NO_STORE }
    );
  }

  try {
    const detail = await getRequestDetailById(detailId);
    if (!detail) {
      return NextResponse.json({ error: "Request detail not found" }, { status: 404, headers: NO_STORE });
    }
    return NextResponse.json({ detail }, { headers: NO_STORE });
  } catch (error) {
    console.error("[API] Failed to get request detail:", error);
    return NextResponse.json({ error: "Failed to fetch request detail" }, { status: 500, headers: NO_STORE });
  }
}
