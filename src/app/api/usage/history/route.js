import { NextResponse } from "next/server";
import { getUsageStats, getUsageHistory } from "@/lib/usageDb";

export async function GET(request) {
  try {
    const requestId = request?.url && new URL(request.url).searchParams.get("requestId");
    if (requestId) return NextResponse.json(await getUsageHistory({ requestId }));
    const stats = await getUsageStats();
    return NextResponse.json(stats);
  } catch (error) {
    console.error("Error fetching usage stats:", error);
    return NextResponse.json({ error: "Failed to fetch usage stats" }, { status: 500 });
  }
}
