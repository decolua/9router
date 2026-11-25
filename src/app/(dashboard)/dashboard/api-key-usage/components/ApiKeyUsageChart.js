"use client";

import { useMemo } from "react";
import PropTypes from "prop-types";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import Card from "@/shared/components/Card";

// Distinct hues for a realistic number of keys; beyond COLORS.length they
// repeat, which is better than throwing or drawing two keys in the same colour.
const COLORS = [
  "#6366f1", "#14b8a6", "#f59e0b", "#ef4444", "#8b5cf6",
  "#06b6d4", "#10b981", "#f97316", "#ec4899", "#84cc16",
];

const fmtTokens = (n) => {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n || 0);
};

/**
 * Tokens per API key over time, one stacked bar per bucket.
 *
 * `series[].byKey` and `keys` are both keyed on the bucket id
 * getApiKeyUsageSeries (src/lib/db/repos/apiKeyUsageRepo.js) assigns — a live
 * key's UUID, an 8-hex-char hash for a deleted key, or the literal
 * "local-no-key" — never a raw API key. That id can't collide with this
 * component's own "label" field: a UUID has dashes and is 36 chars,
 * "local-no-key" is a fixed literal, and an 8-char hex hash is drawn from
 * 0-9a-f only, which excludes the "l" that "label" starts with.
 */
export default function ApiKeyUsageChart({ series, keys, loading }) {
  // recharts wants one flat object per bucket: { label, <bucketId>: tokens, ... }
  const data = useMemo(
    () => (series || []).map((bucket) => ({ label: bucket.label, ...bucket.byKey })),
    [series]
  );

  const keyIds = useMemo(() => Object.keys(keys || {}), [keys]);

  if (loading) {
    return (
      <Card className="flex min-w-0 flex-col gap-3 p-3 sm:p-4">
        <span className="text-sm font-semibold text-text-muted uppercase tracking-wide">Tokens by API Key</span>
        <div className="h-48 flex items-center justify-center text-text-muted text-sm">Loading...</div>
      </Card>
    );
  }

  if (!keyIds.length) {
    return (
      <Card className="flex min-w-0 flex-col gap-3 p-3 sm:p-4">
        <span className="text-sm font-semibold text-text-muted uppercase tracking-wide">Tokens by API Key</span>
        <div className="h-48 flex items-center justify-center text-text-muted text-sm">
          No API key usage recorded for this period.
        </div>
      </Card>
    );
  }

  return (
    <Card className="flex min-w-0 flex-col gap-3 p-3 sm:p-4">
      <span className="text-sm font-semibold text-text-muted uppercase tracking-wide">Tokens by API Key</span>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.1} vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10, fill: "currentColor", fillOpacity: 0.5 }}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fontSize: 10, fill: "currentColor", fillOpacity: 0.5 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={fmtTokens}
            width={44}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "var(--color-bg)",
              border: "1px solid var(--color-border)",
              borderRadius: "8px",
              fontSize: "12px",
            }}
            formatter={(value, id) => [fmtTokens(value), keys[id] || id]}
          />
          <Legend wrapperStyle={{ fontSize: "11px" }} formatter={(id) => keys[id] || id} />
          {keyIds.map((id, i) => (
            <Bar key={id} dataKey={id} stackId="tokens" fill={COLORS[i % COLORS.length]} fillOpacity={0.85} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </Card>
  );
}

ApiKeyUsageChart.propTypes = {
  series: PropTypes.arrayOf(
    PropTypes.shape({
      label: PropTypes.string,
      byKey: PropTypes.object,
    })
  ),
  keys: PropTypes.object,
  loading: PropTypes.bool,
};
