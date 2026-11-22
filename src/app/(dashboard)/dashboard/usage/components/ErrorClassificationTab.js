"use client";

import { useState, useEffect } from "react";
import EmptyWithAction from "./EmptyWithAction.js";

export default function ErrorClassificationTab({ period }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/usage/errors?period=${period}`)
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [period]);

  if (loading) {
    return <div className="rounded-xl border border-border p-5 text-sm text-text-muted">Loading error data...</div>;
  }
  if (!data || data.total === 0) {
    return <EmptyWithAction icon="task_alt" title="No errors in this period" hint="Nothing failed - pick a wider period to see past errors." actionHref="/dashboard/console-log" actionLabel="Open console log" />;
  }

  return (
    <div className="flex flex-col gap-4">
      <section aria-label="Error summary" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-border bg-surface-2 p-4 sm:p-5">
          <div className="text-xs font-medium uppercase tracking-wide text-text-muted">Total requests</div>
          <div className="mt-2 text-2xl font-semibold tabular-nums text-text-main">{data.total.toLocaleString()}</div>
        </div>
        <div className="rounded-xl border border-border bg-surface-2 p-4 sm:p-5">
          <div className="text-xs font-medium uppercase tracking-wide text-text-muted">Errors</div>
          <div className="mt-2 text-2xl font-semibold tabular-nums text-red-400">{data.errors.toLocaleString()}</div>
        </div>
        <div className="rounded-xl border border-border bg-surface-2 p-4 sm:p-5">
          <div className="text-xs font-medium uppercase tracking-wide text-text-muted">Error rate</div>
          <div className="mt-2 text-2xl font-semibold tabular-nums text-amber-400">{data.errorRate}%</div>
        </div>
      </section>

      <section className="rounded-xl border border-border bg-surface-2 p-4 sm:p-5">
        <div className="mb-4">
          <h3 className="text-sm font-semibold text-text-main">Errors by status</h3>
          <p className="mt-1 text-xs text-text-muted">Counts shown against total requests in this period.</p>
        </div>
        <div className="space-y-3">
          {Object.entries(data.byStatus)
            .sort((a, b) => b[1].count - a[1].count)
            .map(([status, info]) => (
              <div key={status} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2">
                <span className="min-w-0 truncate text-sm text-text-main" title={status}>{status}</span>
                <span className="text-right text-sm tabular-nums text-text-muted">{info.count.toLocaleString()}</span>
                <div className="col-span-2 h-1.5 overflow-hidden rounded-full bg-surface-3">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${(info.count / data.total) * 100}%` }} />
                </div>
              </div>
            ))}
        </div>
      </section>

      {data.topErrorModels.length > 0 && (
        <section className="overflow-hidden rounded-xl border border-border bg-surface-2">
          <div className="border-b border-border px-4 py-3 sm:px-5">
            <h3 className="text-sm font-semibold text-text-main">Top error models</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-sm">
              <thead>
                <tr className="border-b border-border text-xs uppercase tracking-wide text-text-muted">
                  <th className="px-4 py-3 text-left font-medium sm:px-5">Model</th>
                  <th className="px-4 py-3 text-right font-medium sm:px-5">Errors</th>
                  <th className="px-4 py-3 text-right font-medium sm:px-5">Tokens</th>
                </tr>
              </thead>
              <tbody>
                {data.topErrorModels.map((m, i) => (
                  <tr key={i} className="border-b border-border/50 last:border-0 hover:bg-state-hover">
                    <td className="max-w-[240px] truncate px-4 py-3 text-text-main sm:px-5" title={m.model}>{m.model}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-red-400 sm:px-5">{m.errors.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-text-muted sm:px-5">{m.totalTokens.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
