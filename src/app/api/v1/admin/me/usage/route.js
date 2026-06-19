import { NextResponse } from "next/server";
import {
  getMonthlyUsageForKey,
  getMonthlyUsageBreakdownForKey,
} from "@/lib/localDb";
import { requireKey } from "../../_auth.js";

export const dynamic = "force-dynamic";

// GET /api/v1/admin/me/usage (any valid key) — caller's month usage summary
// plus per-model/provider breakdown.
export async function GET(request) {
  try {
    const { rawKey } = await requireKey(request);
    const summary = await getMonthlyUsageForKey(rawKey);
    const breakdown = await getMonthlyUsageBreakdownForKey(rawKey);
    return NextResponse.json({ summary, breakdown });
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
}
