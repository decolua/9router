"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { UsageStats, Button, CardSkeleton, SegmentedControl, UsageDateRangeControl, getPeriodRange, normalizeUsagePeriod } from "@/shared/components";

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
  const initialRange = getPeriodRange("today");
  const [startDate, setStartDate] = useState(initialRange.startDate);
  const [endDate, setEndDate] = useState(initialRange.endDate);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/settings", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((settings) => {
        if (cancelled || !settings) return;
        const defaultPeriod = normalizeUsagePeriod(settings.usageDefaultPeriod);
        const range = getPeriodRange(defaultPeriod);
        setPeriod(defaultPeriod);
        setStartDate(range.startDate);
        setEndDate(range.endDate);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const tabFromUrl = searchParams.get("tab");
  const activeTab = tabFromUrl && ["overview", "keys", "providers", "models", "latency"].includes(tabFromUrl)
    ? tabFromUrl
    : "overview";

  const handleTabChange = (value) => {
    if (value === activeTab) return;
    const params = new URLSearchParams(searchParams);
    params.set("tab", value);
    router.push(`/dashboard/usage?${params.toString()}`, { scroll: false });
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
            { value: "latency", label: "模型延迟" },
          ]}
          value={activeTab}
          onChange={handleTabChange}
          className="w-full sm:w-auto"
        />
      </div>
      <div className="flex w-full justify-start">
        <UsageDateRangeControl period={period} startDate={startDate} endDate={endDate} onPeriodChange={setPeriod} onStartDateChange={setStartDate} onEndDateChange={setEndDate} todayEndsTomorrow />
        <Button variant="secondary" icon="refresh" onClick={() => setRefreshToken((value) => value + 1)}>刷新</Button>
      </div>

      {activeTab === "overview" && (
        <Suspense fallback={<CardSkeleton />}>
          <UsageStats key={`overview-${refreshToken}`} period={period} setPeriod={setPeriod} startDate={startDate} endDate={endDate} hidePeriodSelector view="overview" />
        </Suspense>
      )}
      {activeTab !== "overview" && (
        <Suspense fallback={<CardSkeleton />}>
          <UsageStats key={`${activeTab}-${refreshToken}`} period={period} setPeriod={setPeriod} startDate={startDate} endDate={endDate} hidePeriodSelector view={activeTab} />
        </Suspense>
      )}
    </div>
  );
}
