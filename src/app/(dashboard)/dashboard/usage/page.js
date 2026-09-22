"use client";

import { Suspense, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { UsageStats, RequestLogger, CardSkeleton, SegmentedControl } from "@/shared/components";
import { USAGE_PERIOD_OPTIONS } from "@/lib/usagePeriods.js";
import RequestDetailsTab from "./components/RequestDetailsTab";

const PERIODS = USAGE_PERIOD_OPTIONS;

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

  const tabFromUrl = searchParams.get("tab");
  const activeTab = tabFromUrl && ["overview", "logs", "details"].includes(tabFromUrl)
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
      {/* Keep tabs left and periods right on one line without overlap */}
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className="relative z-20 shrink-0">
          <SegmentedControl
            options={[
              { value: "overview", label: "Overview" },
              { value: "details", label: "Details" },
            ]}
            value={activeTab}
            onChange={handleTabChange}
            className="w-auto shrink-0"
          />
        </div>
        {activeTab === "overview" && (
          <div className="flex min-w-0 flex-1 justify-end overflow-hidden">
            <div className="overflow-x-auto">
              <SegmentedControl
                options={PERIODS}
                value={period}
                onChange={setPeriod}
                size="sm"
                className="min-w-max"
              />
            </div>
          </div>
        )}
      </div>

      {activeTab === "overview" && (
        <Suspense fallback={<CardSkeleton />}>
          <UsageStats period={period} setPeriod={setPeriod} hidePeriodSelector />
        </Suspense>
      )}
      {activeTab === "logs" && <RequestLogger />}
      {activeTab === "details" && <RequestDetailsTab />}
    </div>
  );
}
