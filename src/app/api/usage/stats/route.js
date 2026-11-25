import { NextResponse } from "next/server";
import { dashboardRole } from "@/dashboardGuard";
import { getUsageStats } from "@/lib/usageDb";

const VALID_PERIODS = new Set(["today", "24h", "7d", "30d", "60d", "all"]);

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const period = searchParams.get("period") || "7d";

    if (!VALID_PERIODS.has(period)) {
      return NextResponse.json({ error: "Invalid period" }, { status: 400 });
    }

    const role = await dashboardRole(request);
    if (!role) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const stats = await getUsageStats(period);
    const headers = { "Cache-Control": "no-store" };
    if (role === "admin") return NextResponse.json(stats, { headers });
    // Detailed aggregates include free-text endpoint URLs and account labels.
    const totals = {};
    for (const field of ["totalRequests", "totalPromptTokens", "totalCompletionTokens", "totalCachedTokens", "totalCost"]) {
      totals[field] = Number.isFinite(stats[field]) ? stats[field] : 0;
    }
    return NextResponse.json(totals, { headers });
  } catch (error) {
    console.error("[API] Failed to get usage stats:", error);
    return NextResponse.json({ error: "Failed to fetch usage stats" }, { status: 500 });
  }
}
