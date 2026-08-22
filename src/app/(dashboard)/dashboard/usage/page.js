"use client";

import { Suspense, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { UsageStats, CardSkeleton, SegmentedControl } from "@/shared/components";

const PERIODS = [
  { value: "today", label: "Today" },
  { value: "24h", label: "Last 24h" },
  { value: "7d", label: "1 Week" },
  { value: "30d", label: "1 Month" },
  { value: "custom", label: "Custom" },
];

function toDateInputValue(date) {
  const d = new Date(date);
  const offset = d.getTimezoneOffset();
  return new Date(d.getTime() - offset * 60000).toISOString().slice(0, 16);
}

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
  const [startDate, setStartDate] = useState(() => toDateInputValue(new Date(new Date().setHours(0, 0, 0, 0))));
  const [endDate, setEndDate] = useState(() => toDateInputValue(new Date()));

  const tabFromUrl = searchParams.get("tab");
  const activeTab = tabFromUrl && ["overview", "analysis"].includes(tabFromUrl)
    ? tabFromUrl
    : "overview";

  const handleTabChange = (value) => {
    if (value === activeTab) return;
    const params = new URLSearchParams(searchParams);
    params.set("tab", value);
    router.push(`/dashboard/usage?${params.toString()}`, { scroll: false });
  };

  const handlePeriodChange = (value) => {
    const now = new Date();
    let start = new Date(now);
    if (value === "today") start.setHours(0, 0, 0, 0);
    if (value === "24h") start = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    if (value === "7d") start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    if (value === "30d") start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    if (value !== "custom") {
      setStartDate(toDateInputValue(start));
      setEndDate(toDateInputValue(now));
    }
    setPeriod(value);
  };

  const handleDateChange = (setter) => (event) => {
    setter(event.target.value);
    setPeriod("custom");
  };

  return (
    <div className="flex min-w-0 flex-col gap-6 px-1 sm:px-0">
      {/* Tabs + period selector on same row */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <SegmentedControl
          options={[
            { value: "overview", label: "Overview" },
            { value: "analysis", label: "API Key Analysis" },
          ]}
          value={activeTab}
          onChange={handleTabChange}
          className="w-full sm:w-auto"
        />
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <SegmentedControl
              options={PERIODS}
              value={period}
              onChange={handlePeriodChange}
              size="sm"
              className="w-full sm:w-auto"
            />
            <div className="flex items-center gap-2">
              <input
                type="datetime-local"
                value={startDate}
                onChange={handleDateChange(setStartDate)}
                className="rounded-md border border-border bg-bg-base px-2 py-1 text-xs text-text-main"
                aria-label="开始时间"
              />
              <span className="text-xs text-text-muted">至</span>
              <input
                type="datetime-local"
                value={endDate}
                onChange={handleDateChange(setEndDate)}
                className="rounded-md border border-border bg-bg-base px-2 py-1 text-xs text-text-main"
                aria-label="结束时间"
              />
            </div>
        </div>
      </div>

      {activeTab === "overview" && (
        <Suspense fallback={<CardSkeleton />}>
          <UsageStats key="overview" period={period} setPeriod={setPeriod} startDate={startDate} endDate={endDate} hidePeriodSelector view="overview" />
        </Suspense>
      )}
      {activeTab === "analysis" && (
        <Suspense fallback={<CardSkeleton />}>
          <UsageStats key="analysis" period={period} setPeriod={setPeriod} startDate={startDate} endDate={endDate} hidePeriodSelector view="analysis" />
        </Suspense>
      )}
    </div>
  );
}
