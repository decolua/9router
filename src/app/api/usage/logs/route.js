import { NextResponse } from "next/server";
import { getRecentLogs } from "@/lib/usageDb";
import { getUserFromRequest } from "@/lib/auth/helpers";

export async function GET(request) {
  try {
    // Get user from request (set by dashboard guard)
    const user = getUserFromRequest(request);
    const userId = user?.id || null;

    const logs = await getRecentLogs(200, userId);
    return NextResponse.json(logs);
  } catch (error) {
    console.error("Error fetching logs:", error);
    return NextResponse.json({ error: "Failed to fetch logs" }, { status: 500 });
  }
}
