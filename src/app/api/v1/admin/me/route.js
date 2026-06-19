import { NextResponse } from "next/server";
import { getMonthlyUsageForKey } from "@/lib/localDb";
import { requireKey, publicKeyView } from "../_auth.js";

export const dynamic = "force-dynamic";

// GET /api/v1/admin/me (any valid key) — caller's own record (no raw key),
// month usage, and computed remaining (limit - used). User read surface.
export async function GET(request) {
  try {
    const { record, rawKey } = await requireKey(request);
    const v = publicKeyView(record);
    const u = await getMonthlyUsageForKey(rawKey);
    v.usageThisMonth = {
      tokens: u.tokens,
      cost: u.cost,
      requests: u.requests,
      monthStart: u.monthStart,
    };
    v.remaining = {
      tokens: record.monthlyTokenLimit > 0 ? Math.max(0, record.monthlyTokenLimit - u.tokens) : null,
      budgetUsd: record.monthlyBudgetUsd > 0 ? Math.max(0, record.monthlyBudgetUsd - u.cost) : null,
    };
    return NextResponse.json({ key: v });
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
}
