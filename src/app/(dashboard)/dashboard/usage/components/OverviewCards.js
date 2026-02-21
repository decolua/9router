"use client";

import PropTypes from "prop-types";
import Card from "@/shared/components/Card";

const fmt = (n) => new Intl.NumberFormat().format(n || 0);
const fmtCost = (n) => `$${(n || 0).toFixed(2)}`;

export default function OverviewCards({ stats }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <Card className="px-4 py-3 flex flex-col gap-1">
        <span className="text-text-muted text-sm uppercase font-semibold">Total Requests</span>
        <span className="text-2xl font-bold">{fmt(stats.totalRequests)}</span>
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
  );
}

OverviewCards.propTypes = {
  stats: PropTypes.object.isRequired,
};
