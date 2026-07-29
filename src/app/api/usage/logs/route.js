import { NextResponse } from "next/server";
import { getRecentLogs } from "@/lib/usageDb";
import { withUsageUser } from "@/lib/auth/runtimeUserContext.js";

export const GET = withUsageUser(async (_request, _ctx, _user, { filterUserId }) => {
  try {
    const logs = await getRecentLogs(200, filterUserId);
    return NextResponse.json(logs);
  } catch (error) {
    console.error("Error fetching logs:", error);
    return NextResponse.json({ error: "Failed to fetch logs" }, { status: 500 });
  }
});
