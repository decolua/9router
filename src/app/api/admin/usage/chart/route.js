import { NextResponse } from "next/server";
import { getChartData } from "@/lib/usageDb";
import { requireAdmin } from "@/lib/auth/helpers";

const VALID_PERIODS = new Set(["24h", "7d", "30d", "60d"]);

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    requireAdmin(request);

    const { searchParams } = new URL(request.url);
    const period = searchParams.get("period") || "7d";

    if (!VALID_PERIODS.has(period)) {
      return NextResponse.json({ error: "Invalid period" }, { status: 400 });
    }

    const data = await getChartData(period, null);
    return NextResponse.json(data);
  } catch (error) {
    console.error("[API] Failed to get admin chart data:", error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch chart data" },
      { status: error.message === "Admin access required" || error.message === "Authentication required" ? 401 : 500 }
    );
  }
}
