import { NextResponse } from "next/server";
import { resetUsageHistory } from "@/lib/usageDb";

const VALID_PERIODS = new Set(["5m", "1h", "3h", "6h", "12h", "1d", "7d", "30d", "all"]);

export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const body = await request.json();
    const { period } = body;

    if (!period || !VALID_PERIODS.has(period)) {
      return NextResponse.json({ error: "Invalid period. Must be one of: 5m, 1h, 3h, 6h, 12h, 1d, 7d, 30d, all" }, { status: 400 });
    }

    await resetUsageHistory(period);
    return NextResponse.json({ success: true, message: `Usage data for the last ${period} has been reset.` });
  } catch (error) {
    console.error("[API] Failed to reset usage stats:", error);
    return NextResponse.json({ error: "Failed to reset usage stats" }, { status: 500 });
  }
}