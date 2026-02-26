import { NextResponse } from "next/server";
import { getChartData } from "@/lib/usageDb";
import { withApiCache } from "@/lib/apiCache";
import { getUsageChartCacheKey } from "@/lib/cacheKeys";

const VALID_PERIODS = new Set(["24h", "7d", "30d", "60d"]);
const USAGE_CHART_CACHE_TTL_MS = Math.max(
  Number.parseInt(process.env.API_CACHE_USAGE_CHART_TTL_MS || "5000", 10) || 0,
  200
);

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const period = searchParams.get("period") || "7d";

    if (!VALID_PERIODS.has(period)) {
      return NextResponse.json({ error: "Invalid period" }, { status: 400 });
    }

    const data = await withApiCache(getUsageChartCacheKey(period), USAGE_CHART_CACHE_TTL_MS, async () => {
      return getChartData(period);
    });

    return NextResponse.json(data);
  } catch (error) {
    console.error("[API] Failed to get chart data:", error);
    return NextResponse.json({ error: "Failed to fetch chart data" }, { status: 500 });
  }
}
