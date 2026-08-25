import { NextResponse } from "next/server";
import { getSmartRoutingCostAnalysis } from "@/lib/usageDb";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const intervalMinutes = Number(searchParams.get("intervalMinutes") || 60);
    if (![15, 30, 60, 1440].includes(intervalMinutes)) {
      return NextResponse.json({ error: "不支持的聚合颗粒度" }, { status: 400 });
    }
    const data = await getSmartRoutingCostAnalysis({
      startDate: searchParams.get("startDate") || undefined,
      endDate: searchParams.get("endDate") || undefined,
      intervalMinutes,
    });
    return NextResponse.json(data);
  } catch (error) {
    console.error("[API] Failed to get smart-routing analysis:", error);
    return NextResponse.json({ error: "获取智能路由分析失败" }, { status: 500 });
  }
}
