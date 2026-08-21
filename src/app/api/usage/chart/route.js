import { NextResponse } from "next/server";
import { getChartData } from "@/lib/usageDb";

const VALID_PERIODS = new Set(["today", "24h", "7d", "30d", "60d", "custom"]);

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const period = searchParams.get("period") || "7d";

    if (!VALID_PERIODS.has(period)) {
      return NextResponse.json({ error: "Invalid period" }, { status: 400 });
    }

    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");
    if (period === "custom" && !startDate) {
      return NextResponse.json({ error: "startDate is required for custom period" }, { status: 400 });
    }
    const data = await getChartData(period, { startDate, endDate });
    return NextResponse.json(data);
  } catch (error) {
    console.error("[API] Failed to get chart data:", error);
    return NextResponse.json({ error: "Failed to fetch chart data" }, { status: 500 });
  }
}
