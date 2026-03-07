import { NextResponse } from "next/server";
import { getUsageStats } from "@/lib/usageDb";
import { requireAuth, unauthorizedResponse } from "@/lib/apiAuth.js";
import { sanitizeUsageStats } from "@/lib/sanitize.js";

const VALID_PERIODS = new Set(["24h", "7d", "30d", "60d", "all"]);

export const dynamic = "force-dynamic";

export async function GET(request) {
  // Require authentication
  const auth = await requireAuth(request);
  if (!auth.authenticated) {
    return unauthorizedResponse();
  }

  try {
    const { searchParams } = new URL(request.url);
    const period = searchParams.get("period") || "7d";

    if (!VALID_PERIODS.has(period)) {
      return NextResponse.json({ error: "Invalid period" }, { status: 400 });
    }

    const stats = await getUsageStats(period);
    const sanitized = sanitizeUsageStats(stats);
    return NextResponse.json(sanitized);
  } catch (error) {
    console.error("[API] Failed to get usage stats:", error);
    return NextResponse.json({ error: "Failed to fetch usage stats" }, { status: 500 });
  }
}
