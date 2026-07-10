import { NextResponse } from "next/server";
import { buildModelsList } from "@/app/api/v1/models/route";

const LLM_KIND = "llm";

/**
 * GET /api/dashboard/models - Get models list for dashboard (JWT protected)
 * This endpoint is protected by dashboardGuard.js (PROTECTED_API_PATHS)
 * and internally calls buildModelsList to get dynamic models from providers/combos.
 */
export async function GET() {
  try {
    const data = await buildModelsList([LLM_KIND]);
    return NextResponse.json({ object: "list", data });
  } catch (error) {
    console.log("Error fetching dashboard models:", error);
    return NextResponse.json(
      { error: { message: error.message, type: "server_error" } },
      { status: 500 }
    );
  }
}