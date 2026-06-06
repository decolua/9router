"use client";

import { useState, useEffect, useMemo } from "react";
import { CardSkeleton, SegmentedControl, EmptyState } from "@/shared/components";
import { CLI_TOOLS, MITM_TOOLS } from "@/shared/constants/cliTools";
import { isCliToolConfigured } from "@/shared/components/ConfigStatusBadge";
import { MitmLinkCard } from "./components";
import ToolSummaryCard from "./components/ToolSummaryCard";

const ALL_STATUSES_URL = "/api/cli-tools/all-statuses";

const FILTER_OPTIONS = [
  { value: "all", label: "All" },
  { value: "configured", label: "Configured" },
  { value: "unconfigured", label: "Not configured" },
];

export default function CLIToolsPageClient({ machineId }) {
  const [loading, setLoading] = useState(true);
  const [toolStatuses, setToolStatuses] = useState({});
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await fetch(ALL_STATUSES_URL);
        if (res.ok && mounted) setToolStatuses(await res.json());
      } catch (error) {
        console.log("Error fetching tool statuses:", error);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  const regularTools = useMemo(() => {
    return Object.entries(CLI_TOOLS).filter(([toolId]) => {
      if (filter === "all") return true;
      if (filter === "configured") return isCliToolConfigured(toolStatuses[toolId]);
      return !isCliToolConfigured(toolStatuses[toolId]);
    });
  }, [filter, toolStatuses]);

  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  const mitmTools = Object.entries(MITM_TOOLS);
  const toolIds = Object.keys(CLI_TOOLS);
  const configuredCount = toolIds.filter((id) => isCliToolConfigured(toolStatuses[id])).length;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-1 sm:px-0">
      <div className="flex flex-col gap-3 px-1 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-text-muted">
          <span className="font-medium text-text-main">{configuredCount}/{toolIds.length}</span> CLI tools configured
        </p>
        <SegmentedControl
          options={FILTER_OPTIONS}
          value={filter}
          onChange={setFilter}
          size="sm"
          className="w-full sm:w-auto"
        />
      </div>

      {regularTools.length === 0 ? (
        <EmptyState
          borderless
          icon="filter_alt"
          title="No tools match this filter"
          description="Try a different filter or configure a tool from the All view."
          action={{ label: "Show all", onClick: () => setFilter("all") }}
          className="py-8"
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
          {regularTools.map(([toolId, tool]) => (
            <ToolSummaryCard key={toolId} toolId={toolId} tool={tool} status={toolStatuses[toolId]} />
          ))}
        </div>
      )}

      <div className="flex flex-col gap-3 sm:gap-4">
        <div className="flex items-center gap-2 px-1">
          <span className="material-symbols-outlined text-[18px] text-primary">security</span>
          <h2 className="text-sm font-semibold text-text-main">MITM Tools</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
          {mitmTools.map(([toolId, tool]) => (
            <MitmLinkCard key={toolId} tool={tool} />
          ))}
        </div>
      </div>
    </div>
  );
}
