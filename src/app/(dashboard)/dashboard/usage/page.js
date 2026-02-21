"use client";

import { useState, Suspense, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { UsageStats, RequestLogger, CardSkeleton, SegmentedControl } from "@/shared/components";
import ProviderLimits from "./components/ProviderLimits";
import RequestDetailsTab from "./components/RequestDetailsTab";

export default function UsagePage() {
  return (
    <Suspense fallback={<CardSkeleton />}>
      <UsagePageContent />
    </Suspense>
  );
}

function UsagePageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState(searchParams.get("tab") || "overview");
  const [tabLoading, setTabLoading] = useState(false);

  useEffect(() => {
    const tabFromUrl = searchParams.get("tab");
    if (tabFromUrl && ["overview", "logs", "limits", "details"].includes(tabFromUrl)) {
      setActiveTab(tabFromUrl);
    }
  }, [searchParams]);

  const handleTabChange = (value) => {
    if (value === activeTab) return;
    setTabLoading(true);
    setActiveTab(value);
    const params = new URLSearchParams(searchParams);
    params.set("tab", value);
    router.push(`/dashboard/usage?${params.toString()}`, { scroll: false });
    // Brief loading flash so user sees feedback
    setTimeout(() => setTabLoading(false), 300);
  };

  return (
    <div className="flex flex-col gap-6">
      <SegmentedControl
        options={[
          { value: "overview", label: "Overview" },
          { value: "limits", label: "Limits" },
          { value: "details", label: "Details" },
        ]}
        value={activeTab}
        onChange={handleTabChange}
      />

      {tabLoading ? (
        <CardSkeleton />
      ) : (
        <>
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
        </>
      )}
    </div>
  );
}
