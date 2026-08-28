import {
  getStatsFilters,
  getStatsSummary,
  getStatsSeries,
  getStatsItems,
} from "@/lib/db/repos/requestStatsRepo.js";
import StatisticsContent from "./StatisticsContent";

// Server-rendered initial data. A pure client page that fetches after mount
// freezes on this route: every async setState following a client-side
// navigation is silently dropped and the summary cards stay on "…" (root cause
// is below React's visible API — hook state updates land but the async-lane
// render is never scheduled). Rendering the payload server-side sidesteps that
// pipeline entirely.
export const dynamic = "force-dynamic";

async function computeStats(searchParams) {
  const provider = searchParams.get?.("provider")?.split(",").filter(Boolean) || undefined;
  const connectionId = searchParams.get?.("connectionId")?.split(",").filter(Boolean) || undefined;
  const model = searchParams.get?.("model")?.split(",").filter(Boolean) || undefined;
  const startRaw = searchParams.get?.("startDate");
  const start = startRaw ? new Date(startRaw) : undefined;
  const end = start ? new Date() : undefined;

  const filter = {
    provider,
    connectionId,
    model,
    startDate: start && !Number.isNaN(start.getTime()) ? start.toISOString() : undefined,
    endDate: end ? end.toISOString() : undefined,
  };

  const [filters, summary, series, itemsResult] = await Promise.all([
    getStatsFilters(),
    getStatsSummary(filter),
    getStatsSeries(filter),
    getStatsItems({ ...filter, page: 1, pageSize: 50 }),
  ]);

  return {
    filters,
    summary,
    series,
    items: itemsResult.items,
    pagination: itemsResult.pagination,
  };
}

export default async function StatisticsPage({ searchParams }) {
  const sp = (await searchParams) || new URLSearchParams();
  const data = await computeStats(sp);
  return <StatisticsContent initialData={data} />;
}
