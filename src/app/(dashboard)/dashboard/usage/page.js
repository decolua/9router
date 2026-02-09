"use client";

import { useState, Suspense } from "react";
import { UsageStats, RequestLogger, CardSkeleton, SegmentedControl } from "@/shared/components";
import ProviderLimits from "./components/ProviderLimits";
import RequestDetailsTab from "./components/RequestDetailsTab";

export default function UsagePage() {
  const [activeTab, setActiveTab] = useState("overview");

  return (
    <div className="flex flex-col gap-6">
      <SegmentedControl
        options={[
          { value: "overview", label: "Overview" },
          { value: "logs", label: "Logger" },
          { value: "limits", label: "Limits" },
          { value: "details", label: "Details" },
        ]}
        value={activeTab}
        onChange={setActiveTab}
      />

      {/* Content */}
      {activeTab === "overview" && (
        <Suspense fallback={<CardSkeleton />}>
          <UsageStats />
        </Suspense>
      )}
      {activeTab === "logs" && <RequestLogger />}
      {activeTab === "limits" && (
        <Suspense fallback={<CardSkeleton />}>
          <ProviderLimits />
        </Suspense>
      )}
      {activeTab === "details" && <RequestDetailsTab />}
    </div>
  );
}
