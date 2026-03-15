import { NextResponse } from "next/server";
import { getUsageStats } from "@/lib/usageDb";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const range = searchParams.get("range");
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");

    const stats = await getUsageStats({ range, startDate, endDate });
    return NextResponse.json(stats);
  } catch (error) {
    console.error("Error fetching usage stats:", error);
    return NextResponse.json({ error: "Failed to fetch usage stats" }, { status: 500 });
  }
}
