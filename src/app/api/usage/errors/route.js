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
      `SELECT status, model, provider, COUNT(*) as count, SUM(promptTokens + completionTokens) as totalTokens
       FROM usageHistory WHERE timestamp >= ? GROUP BY status, model ORDER BY count DESC`,
      [cutoff]
    );

    const byStatus = {};
    const byModel = {};
    let total = 0;
    let errors = 0;

    for (const row of rows) {
      const status = row.status || "ok";
      const count = row.count || 0;
      total += count;

      if (!byStatus[status]) byStatus[status] = { count: 0, totalTokens: 0 };
      byStatus[status].count += count;
      byStatus[status].totalTokens += row.totalTokens || 0;

      if (status !== "ok" && status !== "200" && status !== "success") {
        errors += count;
        const model = row.model || "unknown";
        if (!byModel[model]) byModel[model] = { errors: 0, totalTokens: 0 };
        byModel[model].errors += count;
        byModel[model].totalTokens += row.totalTokens || 0;
      }
    }

    // Sort by error count descending
    const topErrorModels = Object.entries(byModel)
      .sort((a, b) => b[1].errors - a[1].errors)
      .slice(0, 20)
      .map(([model, data]) => ({ model, ...data }));

    return NextResponse.json({
      period,
      total,
      errors,
      errorRate: total > 0 ? ((errors / total) * 100).toFixed(1) : "0.0",
      byStatus,
      topErrorModels,
    });
  } catch (error) {
    console.error("Error classification failed:", error);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
