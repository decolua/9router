import { NextResponse } from "next/server";
import {
  getStatsFilters,
  getStatsSummary,
  getStatsSeries,
  getStatsItems,
} from "@/lib/db/repos/requestStatsRepo.js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function toDateParam(value) {
  if (!value) return undefined;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return undefined;
  return d;
}

// GET /api/usage/statistics?provider=&connectionId=&model=&startDate=&endDate=&page=&pageSize=
// All aggregation (filters, summary, series, detail items) comes from the
// requestStats table — the 45-day full-history stats source.
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const provider = searchParams.get("provider")?.split(",").filter(Boolean) || undefined;
    const connectionId = searchParams.get("connectionId")?.split(",").filter(Boolean) || undefined;
    const model = searchParams.get("model")?.split(",").filter(Boolean) || undefined;
    const start = toDateParam(searchParams.get("startDate"));
    // A startDate with no endDate means "from start to now", so the range is
    // well-defined for granularity selection.
    const end = toDateParam(searchParams.get("endDate")) || (start ? new Date() : undefined);

    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
    const pageSizeRaw = parseInt(searchParams.get("pageSize") || "50", 10) || 50;
    const pageSize = Math.min(100, Math.max(1, pageSizeRaw));

    const filter = {
      provider,
      connectionId,
      model,
      startDate: start ? start.toISOString() : undefined,
      endDate: end ? end.toISOString() : undefined,
    };

    const [filters, summary, series, itemsResult] = await Promise.all([
      getStatsFilters(),
      getStatsSummary(filter),
      getStatsSeries(filter),
      getStatsItems({ ...filter, page, pageSize }),
    ]);

    return NextResponse.json(
      {
        filters,
        summary,
        series,
        items: itemsResult.items,
        pagination: itemsResult.pagination,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.log("Error fetching statistics:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
