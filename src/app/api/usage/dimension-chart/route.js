import { NextResponse } from "next/server";
import { getDimensionChartData } from "@/lib/usageDb";

const VALID_PERIODS = new Set(["today", "24h", "7d", "30d", "custom"]);

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const period = searchParams.get("period") || "7d";
    if (!VALID_PERIODS.has(period)) return NextResponse.json({ error: "无效的时间范围" }, { status: 400 });
    const data = await getDimensionChartData(period, {
      startDate: searchParams.get("startDate"),
      endDate: searchParams.get("endDate"),
    }, searchParams.get("dimension") || "apiKey", searchParams.get("metric") || "tokens", {
      mergeModels: searchParams.get("mergeModels") !== "false",
    });
    return NextResponse.json(data);
  } catch (error) {
    console.error("[API] Failed to get dimension chart:", error);
    return NextResponse.json({ error: "获取流量曲线失败" }, { status: 500 });
  }
}
