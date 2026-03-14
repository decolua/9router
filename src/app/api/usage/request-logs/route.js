import { NextResponse } from "next/server";
import { requireAuth, unauthorizedResponse } from "@/lib/apiAuth.js";
import { getRecentLogs } from "@/lib/usageDb";

export async function GET(request) {
  // Require authentication
  const auth = await requireAuth(request);
  if (!auth.authenticated) {
    return unauthorizedResponse();
  }
  try {
    const logs = await getRecentLogs(200);
    return NextResponse.json(logs);
  } catch (error) {
    console.error("[API ERROR] /api/usage/logs failed:", error);
    console.error("[API ERROR] Stack:", error?.stack);
    return NextResponse.json({ error: "Failed to fetch logs" }, { status: 500 });
  }
}
