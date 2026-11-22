"use client";

import PropTypes from "prop-types";
import Card from "@/shared/components/Card";
import Badge from "@/shared/components/Badge";
import { Sparkline } from "./UsageChartsBits";

const fmt = (n) => new Intl.NumberFormat().format(n || 0);
const fmtCost = (n) => `$${(n || 0).toFixed(2)}`;

/**
 * Summary cards.
 *
 * Every card reserves the same vertical space for its label and its footnote
 * slot. Without that, a label that wraps to two lines ("Total Input Tokens" on
 * a narrow screen) pushes its number below the other four, and the cache-hit
 * badge appearing or disappearing changes card height mid-render - the row
 * visibly jumps. Fixed slots keep all five numbers on one baseline whatever
 * the label length or period.
 */
function TrendCard({ label, value, title, icon, tone = "", footnote, trend }) {
  return (
    <Card className="flex min-w-0 flex-col gap-2 p-3 sm:p-4 bg-surface border border-border-subtle hover:border-border transition-colors">
      <div className="flex items-center justify-between gap-2">
        <span className="text-text-muted text-xs font-semibold uppercase tracking-wider truncate">
          {label}
        </span>
        {icon && (
          <span className="material-symbols-outlined text-lg text-text-subtle select-none">
            {icon}
          </span>
        )}
      </div>

      <div className="flex items-baseline justify-between gap-2">
        <span className={`truncate text-xl sm:text-2xl font-bold tracking-tight ${tone || "text-text-main"}`} title={title}>
          {value}
        </span>
      </div>

      {trend && Array.isArray(trend) && trend.length >= 2 ? (
        <div className="w-full h-6 my-0.5">
          <Sparkline values={trend} height={24} stroke={tone ? undefined : "var(--color-primary)"} />
        </div>
      ) : (
        <div className="w-full h-6 my-0.5 flex items-center">
          <div className="w-full h-[1px] bg-border-subtle" />
        </div>
      )}

      <div className="flex min-h-[1.25rem] items-center text-xs text-text-muted mt-auto pt-1.5 border-t border-border-subtle">
        {footnote || <span className="text-transparent select-none">-</span>}
      </div>
    </Card>
  );
}

TrendCard.propTypes = {
  label: PropTypes.string.isRequired,
  value: PropTypes.node.isRequired,
  title: PropTypes.string,
  icon: PropTypes.string,
  tone: PropTypes.string,
  footnote: PropTypes.node,
  trend: PropTypes.arrayOf(PropTypes.number),
};

TrendCard.defaultProps = { title: "", icon: "", tone: "", footnote: null, trend: null };

export default function OverviewCards({ stats, trends }) {
  const cacheHitRate = stats.totalPromptTokens > 0
    ? ((stats.totalCachedTokens || 0) / stats.totalPromptTokens) * 100
    : 0;

  const t = trends?.totals || {};

  return (
    <div className="grid min-w-0 grid-cols-1 gap-2.5 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 sm:gap-3">
      <TrendCard
        label="Total Requests"
        value={fmt(stats.totalRequests)}
        title={fmt(stats.totalRequests)}
        icon="query_stats"
        trend={t.requests}
        footnote={<span>{stats.totalRequests ? "Global volume" : "Zero requests"}</span>}
      />
      <TrendCard
        label="Input Tokens"
        value={fmt(stats.totalPromptTokens)}
        title={fmt(stats.totalPromptTokens)}
        icon="north"
        tone="text-text-main"
        trend={t.input}
        footnote={<span>Context payload</span>}
      />
      <TrendCard
        label="Cached Tokens"
        value={fmt(stats.totalCachedTokens)}
        title={fmt(stats.totalCachedTokens)}
        icon="electric_bolt"
        tone="text-info"
        trend={t.cached}
        footnote={cacheHitRate > 0 ? (
          <Badge variant="info" size="sm" className="font-mono text-[10px]">{cacheHitRate.toFixed(1)}% cache hit</Badge>
        ) : (
          <span className="text-text-muted/70">No cache reads</span>
        )}
      />
      <TrendCard
        label="Output Tokens"
        value={fmt(stats.totalCompletionTokens)}
        title={fmt(stats.totalCompletionTokens)}
        icon="south"
        tone="text-success"
        trend={t.output}
        footnote={<span>Generated completion</span>}
      />
      <TrendCard
        label="Est. Cost"
        value={`~${fmtCost(stats.totalCost)}`}
        title={`~${fmtCost(stats.totalCost)}`}
        icon="account_balance_wallet"
        tone="text-warning"
        trend={t.cost}
        footnote={<span className="text-text-muted/70">Rate estimate, not billing</span>}
      />
    </div>
  );
}

OverviewCards.propTypes = {
  stats: PropTypes.object.isRequired,
  trends: PropTypes.object,
};