"use client";

import { Suspense, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { UsageStats, CardSkeleton, SegmentedControl, UsageDateRangeControl, getPeriodRange } from "@/shared/components";

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
      {/* Tabs + period selector on same row */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
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
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <UsageDateRangeControl period={period} startDate={startDate} endDate={endDate} onPeriodChange={setPeriod} onStartDateChange={setStartDate} onEndDateChange={setEndDate} />
        </div>
      </div>

      {activeTab === "overview" && (
        <Suspense fallback={<CardSkeleton />}>
          <UsageStats key="overview" period={period} setPeriod={setPeriod} startDate={startDate} endDate={endDate} hidePeriodSelector view="overview" />
        </Suspense>
      )}
      {activeTab !== "overview" && (
        <Suspense fallback={<CardSkeleton />}>
          <UsageStats key={activeTab} period={period} setPeriod={setPeriod} startDate={startDate} endDate={endDate} hidePeriodSelector view={activeTab} />
        </Suspense>
      )}
    </div>
  );
}
