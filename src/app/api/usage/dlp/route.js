import { NextResponse } from "next/server";
import { getDlpStats, getDlpChartData } from "@/lib/db/repos/dlpStatsRepo.js";

const VALID_PERIODS = new Set(["today", "24h", "7d", "30d", "60d"]);

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const period = searchParams.get("period") || "7d";

    if (!VALID_PERIODS.has(period)) {
      return NextResponse.json({ error: "Invalid period" }, { status: 400 });
    }

    const [stats, chart] = await Promise.all([getDlpStats(period), getDlpChartData(period)]);
    return NextResponse.json({ stats, chart });
  } catch (error) {
    console.error("[API] Failed to get DLP stats:", error);
    return NextResponse.json({ error: "Failed to fetch DLP stats" }, { status: 500 });
  }
}