import { NextResponse } from "next/server";
import { getUsageStats } from "@/lib/usageDb";
import { requireAuth, unauthorizedResponse } from "@/lib/apiAuth.js";
import { sanitizeUsageStats } from "@/lib/sanitize.js";

export async function GET(request) {
  // Require authentication
  const auth = await requireAuth(request);
  if (!auth.authenticated) {
    return unauthorizedResponse();
  }

  try {
    const stats = await getUsageStats();
    const sanitized = sanitizeUsageStats(stats);
    return NextResponse.json(sanitized);
  } catch (error) {
    console.error("Error fetching usage stats:", error);
    return NextResponse.json({ error: "Failed to fetch usage stats" }, { status: 500 });
  }
}
