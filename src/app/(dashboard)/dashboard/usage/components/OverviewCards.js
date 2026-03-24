"use client";

import PropTypes from "prop-types";
import Card from "@/shared/components/Card";

const fmt = (n) => new Intl.NumberFormat().format(n || 0);
const fmtCost = (n) => `$${(n || 0).toFixed(2)}`;

export default function OverviewCards({ stats }) {
  const isTruncated = stats.historyRetained >= stats.maxHistory;

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="px-4 py-3 flex flex-col gap-1">
          <span className="text-text-muted text-sm uppercase font-semibold">Requests</span>
          <span className="text-2xl font-bold">{fmt(stats.totalRequests)}</span>
          {stats.totalRequestsLifetime > stats.totalRequests && (
            <span className="text-[10px] text-text-muted">Lifetime: {fmt(stats.totalRequestsLifetime)}</span>
          )}
        </Card>
        <Card className="px-4 py-3 flex flex-col gap-1">
          <span className="text-text-muted text-sm uppercase font-semibold">Total Input Tokens</span>
          <span className="text-2xl font-bold text-primary">{fmt(stats.totalPromptTokens)}</span>
        </Card>
        <Card className="px-4 py-3 flex flex-col gap-1">
          <span className="text-text-muted text-sm uppercase font-semibold">Output Tokens</span>
          <span className="text-2xl font-bold text-success">{fmt(stats.totalCompletionTokens)}</span>
        </Card>
        <Card className="px-4 py-3 flex flex-col gap-1">
          <span className="text-text-muted text-sm uppercase font-semibold">Est. Cost</span>
          <span className="text-2xl font-bold text-warning">~{fmtCost(stats.totalCost)}</span>
          <span className="text-[10px] text-text-muted">Estimated, not actual billing</span>
        </Card>
      </div>
      {isTruncated && (
        <p className="text-[11px] text-text-muted">
          Stats based on last {fmt(stats.maxHistory)} retained requests. Set <code className="text-[10px]">MAX_USAGE_HISTORY</code> env to increase.
        </p>
      )}
    </div>
  );
}

OverviewCards.propTypes = {
  stats: PropTypes.object.isRequired,
};
