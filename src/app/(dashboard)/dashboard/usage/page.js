"use client";

import { Suspense, useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { UsageStats, RequestLogger, CardSkeleton, SegmentedControl } from "@/shared/components";
import RequestDetailsTab from "./components/RequestDetailsTab";
import ApiKeyUsageTable from "./components/ApiKeyUsageTable";

const VALID_TABS = ["overview", "logs", "details", "api-keys"];

const PERIODS = [
  { value: "today", label: "Today" },
  { value: "24h", label: "24h" },
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "60d", label: "60D" },
];

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
  const urlTab = tabFromUrl && VALID_TABS.includes(tabFromUrl) ? tabFromUrl : "overview";
  const [activeTab, setActiveTab] = useState(urlTab);

  useEffect(() => {
    setActiveTab(urlTab);
  }, [urlTab]);

  const handleTabChange = (value) => {
    if (value === activeTab) return;
    setActiveTab(value);
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
            { value: "overview", label: "Overview" },
            { value: "details", label: "Details" },
            { value: "api-keys", label: "API Keys" },
          ]}
          value={activeTab}
          onChange={handleTabChange}
          className="w-full sm:w-auto"
        />
        {(activeTab === "overview" || activeTab === "api-keys") && (
          <SegmentedControl
            options={PERIODS}
            value={period}
            onChange={setPeriod}
            size="sm"
            className="w-full sm:w-auto"
          />
        )}
      </div>

      {/* Use CSS visibility to preserve component state across tab switches */}
      <div style={{ display: activeTab === "overview" ? undefined : "none" }}>
        <Suspense fallback={<CardSkeleton />}>
          <UsageStats period={period} setPeriod={setPeriod} hidePeriodSelector />
        </Suspense>
      </div>
      <div style={{ display: activeTab === "logs" ? undefined : "none" }}>
        <RequestLogger />
      </div>
      <div style={{ display: activeTab === "details" ? undefined : "none" }}>
        <RequestDetailsTab />
      </div>
      <div style={{ display: activeTab === "api-keys" ? undefined : "none" }}>
        <ApiKeyUsageTable period={period} />
      </div>
    </div>
  );
}
