"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { UsageStats, Button, CardSkeleton, DropdownSelect, SegmentedControl, Toggle, UsageDateRangeControl, getPeriodRange, normalizeUsagePeriod } from "@/shared/components";
import SmartRoutingAnalysis from "./components/SmartRoutingAnalysis";

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
  const [smartRoutingInterval, setSmartRoutingInterval] = useState(60);

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
  const activeTab = tabFromUrl && ["overview", "keys", "providers", "models", "smart-routing"].includes(tabFromUrl)
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
      <div className="flex w-full flex-wrap items-center gap-3">
        <SegmentedControl
          options={[
            { value: "overview", label: "使用概览" },
            { value: "keys", label: "密钥分析" },
            { value: "providers", label: "提供商分析" },
            { value: "models", label: "模型分析" },
            { value: "smart-routing", label: "智能路由分析" },
          ]}
          value={activeTab}
          onChange={handleTabChange}
          className="w-full sm:w-auto"
        />
        <Button className="ml-auto shrink-0" variant="secondary" icon="refresh" onClick={() => setRefreshToken((value) => value + 1)}>刷新</Button>
      </div>
      <div className="flex w-full flex-wrap items-center gap-3">
        <UsageDateRangeControl className="min-w-0" period={period} startDate={startDate} endDate={endDate} onPeriodChange={setPeriod} onStartDateChange={setStartDate} onEndDateChange={setEndDate} todayEndsTomorrow />
        <div className="ml-auto flex shrink-0 items-center gap-3">
          {activeTab === "models" && <Toggle size="sm" label="整合同名模型" checked={mergeModels} onChange={handleMergeModelsChange} />}
          {activeTab === "smart-routing" && <DropdownSelect className="w-40" label="聚合颗粒度" value={smartRoutingInterval} onChange={setSmartRoutingInterval} options={[{ value: 15, label: "15 分钟" }, { value: 30, label: "30 分钟" }, { value: 60, label: "1 小时" }, { value: 1440, label: "1 天" }]} />}
        </div>
      </div>

      {activeTab === "overview" && (
        <Suspense fallback={<CardSkeleton />}>
          <UsageStats key={`overview-${refreshToken}`} period={period} setPeriod={setPeriod} startDate={startDate} endDate={endDate} hidePeriodSelector view="overview" />
        </Suspense>
      )}
      {activeTab !== "overview" && activeTab !== "smart-routing" && (
        <Suspense fallback={<CardSkeleton />}>
          <UsageStats key={`${activeTab}-${refreshToken}`} period={period} setPeriod={setPeriod} startDate={startDate} endDate={endDate} hidePeriodSelector view={activeTab} mergeModels={mergeModels} />
        </Suspense>
      )}
      {activeTab === "smart-routing" && <SmartRoutingAnalysis startDate={startDate} endDate={endDate} intervalMinutes={smartRoutingInterval} refreshToken={refreshToken} />}
    </div>
  );
}
