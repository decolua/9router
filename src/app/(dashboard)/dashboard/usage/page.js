"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { UsageStats, Button, CardSkeleton, SegmentedControl, Toggle, UsageDateRangeControl, getPeriodRange, normalizeUsagePeriod } from "@/shared/components";

const MERGE_MODELS_STORAGE_KEY = "9router:usage-merge-models";

export default function UsagePage() {
  return (
    <Suspense fallback={<CardSkeleton />}>
      <UsageContent />
    </Suspense>
  );
}

function UsageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [period, setPeriod] = useState("today");
  const initialRange = getPeriodRange("today", new Date(), true);
  const [startDate, setStartDate] = useState(initialRange.startDate);
  const [endDate, setEndDate] = useState(initialRange.endDate);
  const [refreshToken, setRefreshToken] = useState(0);
  const [mergeModels, setMergeModels] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/settings", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((settings) => {
        if (cancelled || !settings) return;
        const defaultPeriod = normalizeUsagePeriod(settings.usageDefaultPeriod);
        const range = getPeriodRange(defaultPeriod, new Date(), true);
        setPeriod(defaultPeriod);
        setStartDate(range.startDate);
        setEndDate(range.endDate);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const timeout = setTimeout(() => {
      try {
        const stored = window.localStorage.getItem(MERGE_MODELS_STORAGE_KEY);
        if (stored !== null) setMergeModels(stored !== "false");
      } catch {}
    }, 0);
    return () => clearTimeout(timeout);
  }, []);

  const tabFromUrl = searchParams.get("tab");
  const activeTab = tabFromUrl && ["overview", "keys", "providers", "models"].includes(tabFromUrl)
    ? tabFromUrl
    : "overview";

  const handleTabChange = (value) => {
    if (value === activeTab) return;
    const params = new URLSearchParams(searchParams);
    params.set("tab", value);
    router.push(`/dashboard/usage?${params.toString()}`, { scroll: false });
  };

  const handleMergeModelsChange = (checked) => {
    setMergeModels(checked);
    try { window.localStorage.setItem(MERGE_MODELS_STORAGE_KEY, String(checked)); } catch {}
  };

  return (
    <div className="flex min-w-0 flex-col gap-6 px-1 sm:px-0">
      <div>
        <SegmentedControl
          options={[
            { value: "overview", label: "使用概览" },
            { value: "keys", label: "密钥分析" },
            { value: "providers", label: "提供商分析" },
            { value: "models", label: "模型流量" },
          ]}
          value={activeTab}
          onChange={handleTabChange}
          className="w-full sm:w-auto"
        />
      </div>
      <div className="flex w-full flex-wrap items-center gap-3">
        <UsageDateRangeControl className="min-w-0" period={period} startDate={startDate} endDate={endDate} onPeriodChange={setPeriod} onStartDateChange={setStartDate} onEndDateChange={setEndDate} todayEndsTomorrow />
        <div className="ml-auto flex shrink-0 items-center gap-3">
          {activeTab === "models" && <Toggle size="sm" label="整合同名模型" checked={mergeModels} onChange={handleMergeModelsChange} />}
          <Button className="shrink-0" variant="secondary" icon="refresh" onClick={() => setRefreshToken((value) => value + 1)}>刷新</Button>
        </div>
      </div>

      {activeTab === "overview" && (
        <Suspense fallback={<CardSkeleton />}>
          <UsageStats key={`overview-${refreshToken}`} period={period} setPeriod={setPeriod} startDate={startDate} endDate={endDate} hidePeriodSelector view="overview" />
        </Suspense>
      )}
      {activeTab !== "overview" && (
        <Suspense fallback={<CardSkeleton />}>
          <UsageStats key={`${activeTab}-${refreshToken}`} period={period} setPeriod={setPeriod} startDate={startDate} endDate={endDate} hidePeriodSelector view={activeTab} mergeModels={mergeModels} />
        </Suspense>
      )}
    </div>
  );
}
