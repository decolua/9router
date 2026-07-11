import { NextResponse } from "next/server";
import { getTokenSaverStats } from "@/lib/usageDb";

const VALID_PERIODS = new Set(["today", "24h", "7d", "30d", "60d", "365d"]);

export const dynamic = "force-dynamic";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const period = searchParams.get("period") || "7d";

  if (!VALID_PERIODS.has(period)) {
    return NextResponse.json({ error: "Invalid period" }, { status: 400 });
  }

  try {
    const stats = await getTokenSaverStats(period);
    return NextResponse.json(stats);
  } catch (error) {
    console.error("[API] Failed to get token-saver stats:", error);
    return NextResponse.json({ error: "Failed to fetch token-saver stats" }, { status: 500 });
  }
}
