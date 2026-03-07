import { NextResponse } from "next/server";
import { getUsageHistory } from "@/lib/usageDb";
import { requireAdmin } from "@/lib/auth/helpers";

export async function GET(request, { params }) {
  try {
    // Verify admin access
    requireAdmin(request);
    
    const { userId } = await params;
    
    if (!userId) {
      return NextResponse.json({ error: "userId is required" }, { status: 400 });
    }
    
    // Get usage history for the specific user
    const { searchParams } = new URL(request.url);
    const period = searchParams.get("period") || "all";
    
    const history = await getUsageHistory({ userId, period });
    
    return NextResponse.json(history);
  } catch (error) {
    console.error("[API] Failed to get user usage:", error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch user usage" },
      { status: error.message === "Admin access required" || error.message === "Authentication required" ? 401 : 500 }
    );
  }
}
