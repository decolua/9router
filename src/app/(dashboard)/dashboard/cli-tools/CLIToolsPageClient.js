"use client";

import { useState, useEffect } from "react";
import { CardSkeleton } from "@/shared/components";
import { CLI_TOOLS, MITM_TOOLS } from "@/shared/constants/cliTools";
import { MitmLinkCard } from "./components";
import ToolSummaryCard from "./components/ToolSummaryCard";

const ALL_STATUSES_URL = "/api/cli-tools/all-statuses";

export default function CLIToolsPageClient({ machineId }) {
  const [loading, setLoading] = useState(true);
  const [toolStatuses, setToolStatuses] = useState({});

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

  const regularTools = Object.entries(CLI_TOOLS);
  const mitmTools = Object.entries(MITM_TOOLS);

  return (
    <div className="mx-auto grid w-full max-w-5xl grid-cols-1 gap-6 px-1 sm:px-0 lg:grid-cols-12">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:col-span-8">
        {regularTools.map(([toolId, tool]) => (
          <ToolSummaryCard key={toolId} toolId={toolId} tool={tool} status={toolStatuses[toolId]} />
        ))}
      </div>
      <div className="flex flex-col gap-3 sm:gap-4 lg:col-span-4">
        <div className="flex items-center gap-2 px-1">
          <span className="material-symbols-outlined text-[18px] text-primary">shield</span>
          <h2 className="text-sm font-semibold text-text-main">MITM Tools</h2>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-1">
          {mitmTools.map(([toolId, tool]) => (
            <MitmLinkCard key={toolId} tool={tool} />
          ))}
        </div>
      </div>
    </div>
  );
}
