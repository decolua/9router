import { NextResponse } from "next/server";
import { getApiKeyClientActivity } from "@/lib/usageDb";

const VALID_PERIODS = new Set(["today", "24h", "7d", "30d", "60d", "all"]);

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const period = new URL(request.url).searchParams.get("period") || "24h";
    if (!VALID_PERIODS.has(period)) {
      return NextResponse.json({ error: "Invalid period" }, { status: 400 });
    }
    return NextResponse.json(await getApiKeyClientActivity(period));
  } catch (error) {
    console.error("[API] Failed to get API key client activity:", error);
    return NextResponse.json({ error: "Failed to fetch API key client activity" }, { status: 500 });
  }
}
