import { NextResponse } from "next/server";
import { getAdapter } from "@/lib/db/driver.js";
import { parseJson } from "@/lib/db/helpers/jsonCol.js";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const period = searchParams.get("period") || "7d";

    const now = new Date();
    let cutoffDays = 7;
    if (period === "24h") cutoffDays = 1;
    else if (period === "30d") cutoffDays = 30;
    else if (period === "60d") cutoffDays = 60;

    const cutoff = new Date(now.getTime() - cutoffDays * 86400000).toISOString();

    const db = await getAdapter();
    const rows = db.all(
      `SELECT model, provider,
              COUNT(*) as requests,
              SUM(CASE WHEN status IN ('ok','200','success') THEN 1 ELSE 0 END) as successes,
              SUM(promptTokens) as promptTokens,
              SUM(completionTokens) as completionTokens,
              SUM(promptTokens + completionTokens) as totalTokens,
              SUM(cost) as totalCost
       FROM usageHistory WHERE timestamp >= ?
       GROUP BY model ORDER BY requests DESC`,
      [cutoff]
    );

    const leaderboard = rows
      .filter(r => r.model)
      .map((r) => ({
        model: r.model,
        provider: r.provider || "",
        requests: r.requests || 0,
        successes: r.successes || 0,
        successRate: r.requests > 0 ? ((r.successes / r.requests) * 100).toFixed(1) : "0.0",
        promptTokens: r.promptTokens || 0,
        completionTokens: r.completionTokens || 0,
        totalTokens: r.totalTokens || 0,
        avgTokensPerRequest: r.requests > 0 ? Math.round(r.totalTokens / r.requests) : 0,
        totalCost: r.totalCost || 0,
      }))
      .slice(0, 50);

    return NextResponse.json({ period, leaderboard });
  } catch (error) {
    console.error("Model leaderboard failed:", error);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
