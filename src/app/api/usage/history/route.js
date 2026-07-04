import { NextResponse } from "next/server";
import { getUsageStats } from "@/lib/usageDb";
import { withUsageUser } from "@/lib/auth/runtimeUserContext.js";

export const GET = withUsageUser(async (_request, _ctx, _user, { filterUserId }) => {
  try {
    const stats = await getUsageStats("all", filterUserId);
    return NextResponse.json(stats);
  } catch (error) {
    console.error("Error fetching usage stats:", error);
    return NextResponse.json({ error: "Failed to fetch usage stats" }, { status: 500 });
  }
});
