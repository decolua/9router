"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CardSkeleton, SegmentedControl } from "@/shared/components";
import {
  API_KEY_COLUMNS, groupDataByKey, sortData,
  renderApiKeyDetailCells, renderApiKeySummaryCells,
} from "@/shared/components/UsageStats";
import UsageTable from "../usage/components/UsageTable";
import ApiKeyUsageChart from "./components/ApiKeyUsageChart";

const PERIODS = [
  { value: "today", label: "Today" },
  { value: "24h", label: "24h" },
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "60d", label: "60D" },
  { value: "all", label: "All" },
];

export default function ApiKeyUsagePage() {
  return (
    <Suspense fallback={<CardSkeleton />}>
      <ApiKeyUsageContent />
    </Suspense>
  );
}

function ApiKeyUsageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [period, setPeriod] = useState("7d");
  const [viewMode, setViewMode] = useState("tokens");
  const [chart, setChart] = useState({ series: [], keys: {} });
  const [byApiKey, setByApiKey] = useState({});
  const [loading, setLoading] = useState(true);

  const sortBy = searchParams.get("sortBy") || "requests";
  const sortOrder = searchParams.get("sortOrder") || "desc";

  // One fetch per period, not the SSE stream UsageStats uses: that stream
  // exists to move `pending` counts live, and the API-key view has no pending
  // data — it passes {} as its pendingMap.
  //
  // The fetch runs from a function declared and invoked inside the effect
  // (rather than a setLoading(true) call sitting directly in the effect body,
  // or a useCallback invoked via the deps array) so the loading update rides
  // along with the fetch instead of firing as a synchronous render-adjacent
  // side effect on its own — see react-hooks/set-state-in-effect.
  useEffect(() => {
    let cancelled = false;

    async function loadApiKeyUsage() {
      setLoading(true);
      try {
        const [chartData, stats] = await Promise.all([
          fetch(`/api/usage/api-keys?period=${period}`).then((r) => r.json()),
          fetch(`/api/usage/stats?period=${period}`).then((r) => r.json()),
        ]);
        if (cancelled) return;
        setChart({ series: chartData.series || [], keys: chartData.keys || {} });
        setByApiKey(stats.byApiKey || {});
      } catch {
        if (!cancelled) { setChart({ series: [], keys: {} }); setByApiKey({}); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadApiKeyUsage();
    return () => { cancelled = true; };
  }, [period]);

  // Same shape UsageTable's onToggleSort expects, and the same URL-param home
  // UsageStats gives it.
  const toggleSort = useCallback((tableType, field) => {
    const params = new URLSearchParams(searchParams.toString());
    if (params.get("sortBy") === field) {
      params.set("sortOrder", params.get("sortOrder") === "asc" ? "desc" : "asc");
    } else {
      params.set("sortBy", field);
      params.set("sortOrder", "asc");
    }
    router.replace(`?${params.toString()}`, { scroll: false });
  }, [searchParams, router]);

  // Same placeholder UsageStats.js:453 uses while its own fetches are in
  // flight, so the two pages don't disagree about what "loading" looks like.
  const spinner = (
    <div className="flex items-center justify-center py-12 text-text-muted">
      <span className="material-symbols-outlined text-[32px] animate-spin">progress_activity</span>
    </div>
  );

  return (
    <div className="flex min-w-0 flex-col gap-6 px-1 sm:px-0">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <SegmentedControl
          options={[{ value: "tokens", label: "Tokens" }, { value: "costs", label: "Costs" }]}
          value={viewMode}
          onChange={setViewMode}
          size="sm"
        />
        <div className="flex items-center gap-2">
          <a
            href={`/api/usage/api-keys?period=${period}&format=csv`}
            className="flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-[13px] hover:bg-bg-subtle"
          >
            <span className="material-symbols-outlined text-[16px]">download</span>
            CSV
          </a>
          <SegmentedControl options={PERIODS} value={period} onChange={setPeriod} size="sm" />
        </div>
      </div>

      <ApiKeyUsageChart series={chart.series} keys={chart.keys} loading={loading} />

      {loading ? spinner : (
        <UsageTable
          title="Usage by API Key"
          columns={API_KEY_COLUMNS}
          groupedData={groupDataByKey(sortData(byApiKey, {}, sortBy, sortOrder), "keyName")}
          tableType="apiKey"
          sortBy={sortBy}
          sortOrder={sortOrder}
          onToggleSort={toggleSort}
          viewMode={viewMode}
          storageKey="api-key-usage:expanded"
          renderSummaryCells={renderApiKeySummaryCells}
          renderDetailCells={renderApiKeyDetailCells}
          emptyMessage="No API key usage recorded yet."
        />
      )}
    </div>
  );
}
