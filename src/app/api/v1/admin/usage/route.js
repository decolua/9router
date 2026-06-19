import { NextResponse } from "next/server";
import { getUsageStats } from "@/lib/localDb";
import { requireKey, requireAdmin } from "../_auth.js";

export const dynamic = "force-dynamic";

// GET /api/v1/admin/usage (admin) — system-wide usage stats.
export async function GET(request) {
  try {
    const { record } = await requireKey(request);
    requireAdmin(record);
    const url = new URL(request.url);
    const period = url.searchParams.get("period") || "30d";
    const stats = await getUsageStats(period);
    return NextResponse.json(stats);
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
}
