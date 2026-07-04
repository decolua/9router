import { NextResponse } from "next/server";
import { getOptimizationSavings } from "@/lib/usageDb";
import { withUsageUser } from "@/lib/auth/runtimeUserContext.js";

const VALID_PERIODS = new Set(["today", "24h", "7d", "30d", "60d", "all"]);

export const dynamic = "force-dynamic";

export const GET = withUsageUser(async (request, _ctx, _user, { filterUserId }) => {
  try {
    const { searchParams } = new URL(request.url);
    const period = searchParams.get("period") || "7d";

    if (!VALID_PERIODS.has(period)) {
      return NextResponse.json({ error: "Invalid period" }, { status: 400 });
    }

    const savings = await getOptimizationSavings(period, filterUserId);
    return NextResponse.json(savings);
  } catch (error) {
    console.error("[API] Failed to get optimization savings:", error);
    return NextResponse.json({ error: "Failed to fetch optimization savings" }, { status: 500 });
  }
});
