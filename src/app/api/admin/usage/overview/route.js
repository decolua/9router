import { NextResponse } from "next/server";
import { getUsageStats } from "@/lib/usageDb";
import { requireAdmin } from "@/lib/auth/helpers";

export async function GET(request) {
  try {
    // Verify admin access
    requireAdmin(request);
    
    const { searchParams } = new URL(request.url);
    const period = searchParams.get("period") || "all";
    
    // Get usage stats without userId filter (show all users)
    const stats = await getUsageStats(period, null);
    return NextResponse.json(stats);
  } catch (error) {
    console.error("[API] Failed to get admin usage overview:", error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch usage overview" },
      { status: error.message === "Admin access required" || error.message === "Authentication required" ? 401 : 500 }
    );
  }
}
