import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyDashboardAuthToken } from "@/lib/auth/dashboardSession";
import { getRequestDetailById } from "@/lib/usageDb";

function decodeId(rawId) {
  if (typeof rawId !== "string") return rawId;
  try {
    return decodeURIComponent(rawId);
  } catch {
    // Malformed percent-encoding — fall back to the raw segment so the
    // repository lookup runs instead of the whole request throwing.
    return rawId;
  }
}

/**
 * GET /api/usage/request-details/[id]
 *
 * Returns the complete, unredacted detail for a single request. The list
 * endpoint at /api/usage/request-details redacts conversation payloads, so
 * this endpoint always enforces dashboard auth (even when requireLogin is
 * disabled) and marks the response private/no-store.
 */
export async function GET(request, { params }) {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("auth_token")?.value;

    if (!(await verifyDashboardAuthToken(token))) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const detail = await getRequestDetailById(decodeId(id));

    if (!detail) {
      return NextResponse.json(
        { error: "Request detail not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { detail },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error) {
    console.error("[API] Failed to get request detail:", error);
    return NextResponse.json(
      { error: "Failed to fetch request detail" },
      { status: 500 }
    );
  }
}
