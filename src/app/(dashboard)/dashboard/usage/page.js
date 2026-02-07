"use client";

import { useState, Suspense } from "react";
import { useTranslations } from "next-intl";
import { UsageStats, RequestLogger, CardSkeleton, SegmentedControl } from "@/shared/components";
import ProviderLimits from "./components/ProviderLimits";

export default function UsagePage() {
  const [activeTab, setActiveTab] = useState("overview");
  const t = useTranslations();

  return (
    <div className="flex flex-col gap-6">
      <SegmentedControl
        options={[
          { value: "overview", label: t("usage.tabOverview") },
          { value: "logs", label: t("usage.tabLogs") },
          { value: "limits", label: t("usage.tabLimits") },
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
    </div>
  );
}
