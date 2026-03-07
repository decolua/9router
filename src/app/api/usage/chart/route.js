import { NextResponse } from "next/server";
import { getChartData } from "@/lib/usageDb";
import { getUserFromRequest } from "@/lib/auth/helpers";

const VALID_PERIODS = new Set(["24h", "7d", "30d", "60d"]);

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const period = searchParams.get("period") || "7d";

    if (!VALID_PERIODS.has(period)) {
      return NextResponse.json({ error: "Invalid period" }, { status: 400 });
    }

    // Get user from request (set by dashboard guard)
    const user = getUserFromRequest(request);
    const userId = user?.id || null;

    const data = await getChartData(period, userId);
    return NextResponse.json(data);
  } catch (error) {
    console.error("[API] Failed to get chart data:", error);
    return NextResponse.json({ error: "Failed to fetch chart data" }, { status: 500 });
  }
}
