import { NextResponse } from "next/server";
import { getOptimizationSavings } from "@/lib/usageDb";

const VALID_PERIODS = new Set(["today", "24h", "7d", "30d", "60d", "all"]);

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const period = searchParams.get("period") || "7d";

    if (!VALID_PERIODS.has(period)) {
      return NextResponse.json({ error: "Invalid period" }, { status: 400 });
    }

    const savings = await getOptimizationSavings(period);
    return NextResponse.json(savings);
  } catch (error) {
    console.error("[API] Failed to get optimization savings:", error);
    return NextResponse.json({ error: "Failed to fetch optimization savings" }, { status: 500 });
  }
}
