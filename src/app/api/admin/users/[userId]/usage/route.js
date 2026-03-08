import { NextResponse } from "next/server";
import { getUsageStats } from "@/lib/usageDb";
import { requireAdmin } from "@/lib/auth/helpers";

const VALID_PERIODS = new Set(["24h", "7d", "30d", "60d", "all"]);

export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  try {
    requireAdmin(request);

    const { userId } = await params;

    if (!userId) {
      return NextResponse.json({ error: "userId is required" }, { status: 400 });
    }

    const { searchParams } = new URL(request.url);
    const period = searchParams.get("period") || "all";

    if (!VALID_PERIODS.has(period)) {
      return NextResponse.json({ error: "Invalid period" }, { status: 400 });
    }

    const stats = await getUsageStats(period, userId);
    return NextResponse.json(stats);
  } catch (error) {
    console.error("[API] Failed to get user usage:", error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch user usage" },
      { status: error.message === "Admin access required" || error.message === "Authentication required" ? 401 : 500 }
    );
  }
}
