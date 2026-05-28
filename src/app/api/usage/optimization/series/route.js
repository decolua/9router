import { NextResponse } from "next/server";
import { getOptimizationSeries } from "@/lib/usageDb";

const VALID_PERIODS = new Set(["today", "24h", "7d", "30d", "60d"]);

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const period = searchParams.get("period") || "7d";
    if (!VALID_PERIODS.has(period)) {
      return NextResponse.json({ error: "Invalid period" }, { status: 400 });
    }
    const series = await getOptimizationSeries(period);
    return NextResponse.json(series);
  } catch (error) {
    console.error("[API] Failed to get optimization series:", error);
    return NextResponse.json({ error: "Failed to fetch optimization series" }, { status: 500 });
  }
}
