import { NextResponse } from "next/server";
import { getChartData } from "@/lib/usageDb";
import { withUsageUser } from "@/lib/auth/runtimeUserContext.js";

const VALID_PERIODS = new Set(["today", "24h", "7d", "30d", "60d"]);

export const GET = withUsageUser(async (request, _ctx, _user, { filterUserId }) => {
  try {
    const { searchParams } = new URL(request.url);
    const period = searchParams.get("period") || "7d";

    if (!VALID_PERIODS.has(period)) {
      return NextResponse.json({ error: "Invalid period" }, { status: 400 });
    }

    const data = await getChartData(period, filterUserId);
    return NextResponse.json(data);
  } catch (error) {
    console.error("[API] Failed to get chart data:", error);
    return NextResponse.json({ error: "Failed to fetch chart data" }, { status: 500 });
  }
});
