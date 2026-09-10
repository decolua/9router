"use client";

import PropTypes from "prop-types";
import Card from "@/shared/components/Card";
import Tooltip from "@/shared/components/Tooltip";

const fmt = (n) => new Intl.NumberFormat().format(n || 0);
// Compact form for wide token counts so values never overflow narrow cards.
const _compactNf = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const fmtCompact = (n) => ((n || 0) >= 100000 ? _compactNf.format(n) : fmt(n));
const fmtCost = (n) => `$${(n || 0).toFixed(2)}`;

export default function OverviewCards({ stats }) {
  return (
    <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 sm:gap-4">
      <Card className="flex min-w-0 flex-col gap-1 px-4 py-3">
        <span className="text-text-muted text-sm uppercase font-semibold">Total Requests</span>
        <span className="truncate text-2xl font-bold">{fmt(stats.totalRequests)}</span>
      </Card>
      <Card className="flex min-w-0 flex-col gap-1 px-4 py-3">
        <span className="text-text-muted text-sm uppercase font-semibold">Total Input Tokens</span>
        <Tooltip text={`${fmt(stats.totalPromptTokens)} total input tokens`}>
          <span className="truncate text-2xl font-bold text-primary">{fmtCompact(stats.totalPromptTokens)}</span>
        </Tooltip>
      </Card>
      <Card className="flex min-w-0 flex-col gap-1 px-4 py-3">
        <span className="text-text-muted text-sm uppercase font-semibold">Cached Tokens</span>
        <Tooltip text={`${fmt(stats.totalCachedTokens)} cached tokens`}>
          <span className="truncate text-2xl font-bold text-info">{fmtCompact(stats.totalCachedTokens)}</span>
        </Tooltip>
      </Card>
      <Card className="flex min-w-0 flex-col gap-1 px-4 py-3">
        <span className="text-text-muted text-sm uppercase font-semibold">Output Tokens</span>
        <Tooltip text={`${fmt(stats.totalCompletionTokens)} output tokens`}>
          <span className="truncate text-2xl font-bold text-success">{fmtCompact(stats.totalCompletionTokens)}</span>
        </Tooltip>
      </Card>
      <Card className="flex min-w-0 flex-col gap-1 px-4 py-3">
        <span className="text-text-muted text-sm uppercase font-semibold">Est. Cost</span>
        <span className="truncate text-2xl font-bold text-warning">~{fmtCost(stats.totalCost)}</span>
        <span className="text-[10px] text-text-muted">Estimated, not actual billing</span>
      </Card>
    </div>
  );
}

OverviewCards.propTypes = {
  stats: PropTypes.object.isRequired,
};
