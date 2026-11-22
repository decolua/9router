"use client";

import { Suspense, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { RequestLogger, CardSkeleton, SegmentedControl } from "@/shared/components";
import UsageStats from "@/shared/components/UsageStats";
import RequestDetailsTab from "./components/RequestDetailsTab";
import ErrorClassificationTab from "./components/ErrorClassificationTab";
import ModelLeaderboardTab from "./components/ModelLeaderboardTab";
import TokenSavingsTab from "./components/TokenSavingsTab";

const PERIODS = [
  { value: "today", label: "Today" },
  { value: "24h", label: "24h" },
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "60d", label: "60D" },
  { value: "all", label: "All" },
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
  const activeTab = tabFromUrl && ["overview", "logs", "details", "errors", "leaderboard", "savings"].includes(tabFromUrl)
    ? tabFromUrl
    : "overview";

  const handleTabChange = (value) => {
    if (value === activeTab) return;
    const params = new URLSearchParams(searchParams);
    params.set("tab", value);
    router.push(`/dashboard/usage?${params.toString()}`, { scroll: false });
  };

  return (
    <div className="grid min-w-0 grid-cols-1 gap-6 px-1 sm:px-0 lg:grid-cols-[220px_minmax(0,1fr)]">
      <aside className="min-w-0">
        <SegmentedControl
          options={[
            { value: "overview", label: "Overview" },
            { value: "details", label: "Details" },
            { value: "errors", label: "Errors" },
            { value: "leaderboard", label: "Leaderboard" },
            { value: "savings", label: "Savings" },
          ]}
          value={activeTab}
          onChange={handleTabChange}
          className="w-full"
        />
      </aside>

      <main className="flex min-w-0 flex-col gap-6">
        {(activeTab === "overview" || activeTab === "errors" || activeTab === "leaderboard" || activeTab === "savings") && (
          <div className="flex justify-start sm:justify-end">
            <SegmentedControl
              options={PERIODS}
              value={period}
              onChange={setPeriod}
              size="sm"
              className="w-full sm:w-auto"
            />
          </div>
        )}

      {activeTab === "overview" && (
        <Suspense fallback={<CardSkeleton />}>
          <UsageStats period={period} setPeriod={setPeriod} hidePeriodSelector />
        </Suspense>
      )}
      {activeTab === "logs" && <RequestLogger />}
      {activeTab === "details" && <RequestDetailsTab />}
      {activeTab === "errors" && <ErrorClassificationTab period={period} />}
      {activeTab === "leaderboard" && <ModelLeaderboardTab period={period} />}
      {activeTab === "savings" && <TokenSavingsTab period={period} />}
      </main>
    </div>
  );
}
