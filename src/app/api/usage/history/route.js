import { NextResponse } from "next/server";
import { getUsageStats } from "@/lib/usageDb";
import { getUserFromRequest } from "@/lib/auth/helpers";

export async function GET(request) {
  try {
    // Get user from request (set by dashboard guard)
    const user = getUserFromRequest(request);
    const userId = user?.id || null;

    const stats = await getUsageStats(undefined, userId);
    return NextResponse.json(stats);
  } catch (error) {
    console.error("Error fetching usage stats:", error);
    return NextResponse.json({ error: "Failed to fetch usage stats" }, { status: 500 });
  }
}
