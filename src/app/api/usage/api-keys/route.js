import { NextResponse } from "next/server";
import { getApiKeyUsageSeries } from "@/lib/db/repos/apiKeyUsageRepo.js";
import { getUsageStats } from "@/lib/usageDb";

// The same set /api/usage/stats validates — the page offers one selector.
const VALID_PERIODS = new Set(["today", "24h", "7d", "30d", "60d", "all"]);

export const dynamic = "force-dynamic";

const CSV_COLUMNS = [
  "key", "model", "provider", "requests",
  "promptTokens", "completionTokens", "cachedTokens", "cost", "lastUsed",
];

/** RFC 4180: quote a field that carries a comma, a quote or a newline. */
function csvField(value) {
  const s = value === null || value === undefined ? "" : String(value);
  if (!/[",\n\r]/.test(s)) return s;
  return `"${s.replace(/"/g, '""')}"`;
}

/**
 * The key x model table as CSV, built from the same byApiKey the table renders
 * so the file and the screen cannot disagree.
 *
 * @param {Record<string, object>} byApiKey  from getUsageStats(period)
 * @returns {string}
 */
export function toCsv(byApiKey) {
  const lines = [CSV_COLUMNS.join(",")];
  for (const row of Object.values(byApiKey || {})) {
    lines.push([
      row.keyName, row.rawModel, row.provider, row.requests,
      row.promptTokens, row.completionTokens, row.cachedTokens, row.cost, row.lastUsed,
    ].map(csvField).join(","));
  }
  return `${lines.join("\n")}\n`;
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const period = searchParams.get("period") || "7d";

    if (!VALID_PERIODS.has(period)) {
      return NextResponse.json({ error: "Invalid period" }, { status: 400 });
    }

    if (searchParams.get("format") === "csv") {
      const stats = await getUsageStats(period);
      return new NextResponse(toCsv(stats.byApiKey), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="api-key-usage-${period}.csv"`,
        },
      });
    }

    const { series, keys } = await getApiKeyUsageSeries(period);
    return NextResponse.json({ series, keys });
  } catch (error) {
    console.error("[API] Failed to get API key usage:", error);
    return NextResponse.json({ error: "Failed to fetch API key usage" }, { status: 500 });
  }
}
