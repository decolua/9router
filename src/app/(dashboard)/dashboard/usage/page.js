"use client";

import { useState, Suspense } from "react";
import { UsageStats, RequestLogger, CardSkeleton } from "@/shared/components";

export default function UsagePage() {
  const [activeTab, setActiveTab] = useState("overview");

  return (
    <div className="flex flex-col gap-6">
      {/* Tabs */}
      <div className="flex border-b border-border">
        <button
          onClick={() => setActiveTab("overview")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "overview"
              ? "border-primary text-primary"
              : "border-transparent text-text-muted hover:text-text-primary"
          }`}
        >
          Overview
        </button>
        <button
          onClick={() => setActiveTab("logs")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "logs"
              ? "border-primary text-primary"
              : "border-transparent text-text-muted hover:text-text-primary"
          }`}
        >
          Logger
        </button>
      </div>

      {/* Content */}
      {activeTab === "overview" ? (
        <Suspense fallback={<CardSkeleton />}>
          <UsageStats />
        </Suspense>
      ) : (
        <RequestLogger />
      )}
    </div>
  );
}
