"use client";

import { useState, useEffect } from "react";
import EmptyWithAction from "./EmptyWithAction.js";

export default function ModelLeaderboardTab({ period }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/usage/leaderboard?period=${period}`)
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [period]);

  if (loading) {
    return <div className="rounded-xl border border-border p-5 text-sm text-text-muted">Loading leaderboard...</div>;
  }
  if (!data || !data.leaderboard || data.leaderboard.length === 0) {
    return <EmptyWithAction icon="social_leaderboard" title="No model traffic yet" hint="The leaderboard ranks models by request volume once your first request lands." actionHref="/dashboard/endpoint" actionLabel="Get an API key" secondaryHref="/dashboard/arena" secondaryLabel="Send a test request" />;
  }

  const fmt = (n) => {
    if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
    if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
    return String(n);
  };

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-surface-2" aria-label="Model leaderboard">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-4 py-3 sm:px-5">
        <h2 className="text-sm font-semibold text-text-main">Models by request volume</h2>
        <span className="text-xs text-text-muted">{data.leaderboard.length} models</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-border text-xs uppercase tracking-wide text-text-muted">
              <th className="px-4 py-3 text-left font-medium sm:px-5">#</th>
              <th className="px-4 py-3 text-left font-medium sm:px-5">Model</th>
              <th className="px-4 py-3 text-right font-medium sm:px-5">Requests</th>
              <th className="px-4 py-3 text-right font-medium sm:px-5">Success rate</th>
              <th className="px-4 py-3 text-right font-medium sm:px-5">Prompt tokens</th>
              <th className="px-4 py-3 text-right font-medium sm:px-5">Completion</th>
              <th className="px-4 py-3 text-right font-medium sm:px-5">Avg/req</th>
            </tr>
          </thead>
          <tbody>
            {data.leaderboard.map((m, i) => (
              <tr key={i} className="border-b border-border/50 last:border-0 hover:bg-state-hover">
                <td className="px-4 py-3 tabular-nums text-text-muted sm:px-5">{i + 1}</td>
                <td className="max-w-[280px] truncate px-4 py-3 font-medium text-text-main sm:px-5" title={m.model}>{m.model}</td>
                <td className="px-4 py-3 text-right tabular-nums text-text-main sm:px-5">{fmt(m.requests)}</td>
                <td className="px-4 py-3 text-right tabular-nums sm:px-5">
                  <span className={Number(m.successRate) >= 95 ? "text-emerald-400" : Number(m.successRate) >= 80 ? "text-amber-400" : "text-red-400"}>{m.successRate}%</span>
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-text-muted sm:px-5">{fmt(m.promptTokens)}</td>
                <td className="px-4 py-3 text-right tabular-nums text-text-muted sm:px-5">{fmt(m.completionTokens)}</td>
                <td className="px-4 py-3 text-right tabular-nums text-text-muted sm:px-5">{fmt(m.avgTokensPerRequest)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
