"use client";

import PropTypes from "prop-types";
import Card from "@/shared/components/Card";

const fmt = (n) => new Intl.NumberFormat().format(n || 0);
const fmtCost = (n) => {
  const value = Number(n || 0);
  if (!Number.isFinite(value) || value === 0) return "$0.00";
  const abs = Math.abs(value);
  if (abs < 0.0001) return `$${value.toFixed(6)}`;
  if (abs < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
};

export default function OverviewCards({ stats }) {
  const cachedInput = stats.totalCacheReadTokens || 0;
  const cachePercent = stats.totalPromptTokens > 0 ? Math.round((cachedInput / stats.totalPromptTokens) * 100) : 0;
  const hasTokenBreakdown = (stats.totalUncachedPromptTokens || cachedInput || stats.totalCacheCreationTokens) > 0;
  const uncachedInput = hasTokenBreakdown ? (stats.totalUncachedPromptTokens || 0) : (stats.totalPromptTokens || 0);
  const hasCostBreakdown = [
    stats.totalInputCost,
    stats.totalOutputCost,
    stats.totalCachedInputCost,
    stats.totalCacheCreationCost,
  ].some((value) => Number(value || 0) > 0);
  const totalTokens = (stats.totalPromptTokens || 0) + (stats.totalCompletionTokens || 0);
  const fallbackInputCost = totalTokens > 0 ? (stats.totalPromptTokens || 0) * ((stats.totalCost || 0) / totalTokens) : 0;
  const fallbackOutputCost = totalTokens > 0 ? (stats.totalCompletionTokens || 0) * ((stats.totalCost || 0) / totalTokens) : 0;
  const inputCost = hasCostBreakdown ? (stats.totalInputCost || 0) : fallbackInputCost;
  const outputCost = hasCostBreakdown ? (stats.totalOutputCost || 0) : fallbackOutputCost;

  return (
    <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4 sm:gap-4">
      <Card className="flex min-w-0 flex-col gap-1 px-4 py-3">
        <span className="text-text-muted text-sm uppercase font-semibold">Total Requests</span>
        <span className="truncate text-2xl font-bold">{fmt(stats.totalRequests)}</span>
      </Card>
      <Card className="flex min-w-0 flex-col gap-1 px-4 py-3">
        <span className="text-text-muted text-sm uppercase font-semibold">Total Input Tokens</span>
        <span className="truncate text-2xl font-bold text-primary">{fmt(stats.totalPromptTokens)}</span>
        <span className="text-[10px] text-text-muted">
          {fmt(uncachedInput)} uncached | {fmt(cachedInput)} cached ({cachePercent}%)
        </span>
      </Card>
      <Card className="flex min-w-0 flex-col gap-1 px-4 py-3">
        <span className="text-text-muted text-sm uppercase font-semibold">Output Tokens</span>
        <span className="truncate text-2xl font-bold text-success">{fmt(stats.totalCompletionTokens)}</span>
        <span className="text-[10px] text-text-muted">{fmt(stats.totalReasoningTokens)} reasoning</span>
      </Card>
      <Card className="flex min-w-0 flex-col gap-1 px-4 py-3">
        <span className="text-text-muted text-sm uppercase font-semibold">Est. Cost</span>
        <span className="truncate text-2xl font-bold text-warning">~{fmtCost(stats.totalCost)}</span>
        <span className="text-[10px] text-text-muted">Input {fmtCost(inputCost)} | Output {fmtCost(outputCost)}</span>
        <span className="text-[10px] text-text-muted">Cache saved ~{fmtCost(stats.totalCacheSavings)}</span>
      </Card>
    </div>
  );
}

OverviewCards.propTypes = {
  stats: PropTypes.object.isRequired,
};
