"use client";

import { Suspense, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { UsageStats, RequestLogger, CardSkeleton, SegmentedControl, ConfirmModal, Button } from "@/shared/components";
import RequestDetailsTab from "./components/RequestDetailsTab";

const PERIODS = [
  { value: "today", label: "Today" },
  { value: "24h", label: "24h" },
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "60d", label: "60D" },
];

const RESET_PERIODS = [
  { value: "5m", label: "5 minutes" },
  { value: "1h", label: "1 hour" },
  { value: "3h", label: "3 hours" },
  { value: "6h", label: "6 hours" },
  { value: "12h", label: "12 hours" },
  { value: "1d", label: "1 day" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "all", label: "All time" },
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
  const [resetModalOpen, setResetModalOpen] = useState(false);
  const [resetPeriod, setResetPeriod] = useState("all");
  const [resetting, setResetting] = useState(false);

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

  const handleReset = async () => {
    setResetting(true);
    try {
      const res = await fetch("/api/usage/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ period: resetPeriod }),
      });
      if (!res.ok) throw new Error("Reset failed");
      setResetModalOpen(false);
      // Force a re-render by toggling the period slightly
      setPeriod((p) => p === "today" ? "24h" : "today");
    } catch (e) {
      console.error("Reset failed:", e);
    } finally {
      setResetting(false);
    }
  };

  const openResetModal = () => {
    setResetPeriod("all");
    setResetModalOpen(true);
  };

  return (
    <div className="flex min-w-0 flex-col gap-6 px-1 sm:px-0">
      {/* Tabs + period selector + reset on same row */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <SegmentedControl
          options={[
            { value: "overview", label: "Overview" },
            { value: "details", label: "Details" },
          ]}
          value={activeTab}
          onChange={handleTabChange}
          className="w-full sm:w-auto"
        />
        {activeTab === "overview" && (
          <div className="flex items-center gap-2">
            <SegmentedControl
              options={PERIODS}
              value={period}
              onChange={setPeriod}
              size="sm"
              className="w-full sm:w-auto"
            />
            <Button
              variant="outline"
              size="sm"
              icon="restart_alt"
              onClick={openResetModal}
              className="shrink-0"
            >
              Reset
            </Button>
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

      {/* Reset Confirmation Modal */}
      <ConfirmModal
        isOpen={resetModalOpen}
        onClose={() => !resetting && setResetModalOpen(false)}
        onConfirm={handleReset}
        title="Reset Usage Data"
        message={
          <div className="space-y-3">
            <p className="text-text-muted">
              Select how far back you want to delete usage data. This action cannot be undone.
            </p>
            <select
              value={resetPeriod}
              onChange={(e) => setResetPeriod(e.target.value)}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-red-500/40"
            >
              {RESET_PERIODS.map((rp) => (
                <option key={rp.value} value={rp.value}>
                  {rp.label}
                </option>
              ))}
            </select>
          </div>
        }
        confirmText={resetting ? "Resetting..." : "Reset"}
        variant="danger"
        loading={resetting}
      />
    </div>
  );
}
