import { NextResponse } from "next/server";
import { getAdapter } from "@/lib/db/driver.js";

export const dynamic = "force-dynamic";

const PERIOD_MS = { "24h": 86400000, "7d": 604800000, "30d": 2592000000, "60d": 5184000000 };
// Statuses stored for a request that answered normally. Anything else (an HTTP
// code like 429) is a failure, which is what saveFailedUsage writes.
const OK_STATUSES = new Set(["ok", "success", "200"]);

function cutoffFor(period) {
  if (period === "today") {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    return startOfDay.toISOString();
  }
  if (period === "all") return null;
  const ms = PERIOD_MS[period] || PERIOD_MS["7d"];
  return new Date(Date.now() - ms).toISOString();
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const period = searchParams.get("period") || "7d";
    const cutoff = cutoffFor(period);

    const db = await getAdapter();
    const rows = db.all(
      `SELECT status, model, COUNT(*) as count,
        SUM(promptTokens + completionTokens) as totalTokens
       FROM usageHistory
       ${cutoff ? "WHERE timestamp >= ?" : ""}
       GROUP BY status, model ORDER BY count DESC`,
      cutoff ? [cutoff] : []
    );

    const byStatus = {};
    const byModel = {};
    let total = 0;
    let errors = 0;

    for (const row of rows) {
      const status = String(row.status || "ok").trim();
      const count = Number(row.count) || 0;
      const tokens = Number(row.totalTokens) || 0;
      total += count;

      if (OK_STATUSES.has(status.toLowerCase())) continue;

      errors += count;
      if (!byStatus[status]) byStatus[status] = { count: 0, totalTokens: 0 };
      byStatus[status].count += count;
      byStatus[status].totalTokens += tokens;

      const model = row.model || "unknown";
      if (!byModel[model]) byModel[model] = { errors: 0, totalTokens: 0 };
      byModel[model].errors += count;
      byModel[model].totalTokens += tokens;
    }

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
