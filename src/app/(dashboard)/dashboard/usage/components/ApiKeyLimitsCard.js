"use client";

import { useState, useEffect } from "react";
import PropTypes from "prop-types";
import Card from "@/shared/components/Card";
import { formatNumber, formatUsd, barColor } from "@/app/(dashboard)/dashboard/endpoint/components/ApiKeyLimits";

const POLL_MS = 15000;

function formatReset(resetAt) {
  if (!resetAt) return "Rolling 60s";
  const ms = new Date(resetAt).getTime() - Date.now();
  if (ms <= 0) return "Now";
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  if (hours >= 48) return new Date(resetAt).toLocaleDateString();
  return hours > 0 ? `in ${hours}h ${minutes}m` : `in ${minutes}m`;
}

// Only the limits the user actually filled in, RPM first
function configuredLimits(usage) {
  const rows = [];
  if (usage.rpm?.limit) {
    rows.push({ field: "rpmLimit", label: "Requests / minute", used: usage.rpm.used, limit: usage.rpm.limit, money: false, resetAt: null });
  }
  for (const l of usage.limits || []) if (l.limit) rows.push(l);
  return rows;
}

function LimitRow({ row }) {
  const format = row.money ? formatUsd : formatNumber;
  const ratio = row.limit ? row.used / row.limit : 0;
  const remaining = Math.max(row.limit - row.used, 0);
  const exhausted = row.used >= row.limit;
  return (
    <tr className="border-t border-black/[0.04] dark:border-white/[0.05]">
      <td className="px-4 py-2.5">{row.label}</td>
      <td className="px-4 py-2.5 text-right font-mono whitespace-nowrap">
        {format(row.used)} <span className="text-text-muted">/ {format(row.limit)}</span>
      </td>
      <td className={`px-4 py-2.5 text-right font-mono whitespace-nowrap ${exhausted ? "text-red-500 font-semibold" : ""}`}>
        {exhausted ? "Exhausted" : format(remaining)}
      </td>
      <td className="px-4 py-2.5 min-w-[140px]">
        <div className="flex items-center gap-2">
          <div className="h-1.5 flex-1 rounded-full bg-black/5 dark:bg-white/10 overflow-hidden">
            <div className={`h-full rounded-full ${barColor(ratio)}`} style={{ width: `${Math.min(ratio, 1) * 100}%` }} />
          </div>
          <span className="w-10 text-right text-xs text-text-muted">{Math.min(Math.round(ratio * 100), 999)}%</span>
        </div>
      </td>
      <td className="px-4 py-2.5 text-right text-text-muted whitespace-nowrap">{formatReset(row.resetAt)}</td>
    </tr>
  );
}

LimitRow.propTypes = { row: PropTypes.object.isRequired };

export default function ApiKeyLimitsCard() {
  const [keys, setKeys] = useState(null);
  const [usage, setUsage] = useState({});

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [keysRes, usageRes] = await Promise.all([
          fetch("/api/keys", { cache: "no-store" }),
          fetch("/api/keys/usage", { cache: "no-store" }),
        ]);
        const keysData = keysRes.ok ? (await keysRes.json()).keys || [] : null;
        const usageData = usageRes.ok ? (await usageRes.json()).usage || {} : null;
        if (cancelled) return;
        if (keysData) setKeys(keysData);
        if (usageData) setUsage(usageData);
      } catch { /* keep last data; card is best-effort */ }
    };
    load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  if (!keys || keys.length === 0) return null;

  const withRows = keys
    .map((key) => ({ key, rows: usage[key.id] ? configuredLimits(usage[key.id]) : [] }))
    .sort((a, b) => (b.rows.length > 0) - (a.rows.length > 0));

  return (
    <Card className="flex min-w-0 flex-col gap-3" padding="sm">
      <div className="px-1">
        <h3 className="font-semibold">API Key Limits</h3>
        <p className="text-xs text-text-muted">
          Current usage against each key&apos;s configured limits. Independent of the period selector — daily limits reset at the server&apos;s midnight, monthly on the 1st.
        </p>
      </div>
      <div className="flex flex-col gap-4">
        {withRows.map(({ key, rows }) => (
          <div key={key.id} className="min-w-0">
            <div className="flex items-center gap-2 px-1 pb-1.5">
              <span className="font-medium text-sm">{key.name}</span>
              {key.isActive === false && <span className="text-xs text-orange-500">Paused</span>}
              {rows.some((r) => r.used >= r.limit) && (
                <span className="text-xs rounded bg-red-500/10 text-red-500 px-1.5 py-0.5">Limit reached</span>
              )}
            </div>
            {rows.length === 0 ? (
              <p className="px-1 text-xs text-text-muted">No limits set — edit them on the Endpoint page.</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-black/[0.06] dark:border-white/[0.08]">
                <table className="w-full text-sm">
                  <thead className="text-xs uppercase text-text-muted bg-black/[0.02] dark:bg-white/[0.03]">
                    <tr>
                      <th className="px-4 py-2 text-left font-semibold">Limit</th>
                      <th className="px-4 py-2 text-right font-semibold">Used</th>
                      <th className="px-4 py-2 text-right font-semibold">Remaining</th>
                      <th className="px-4 py-2 text-left font-semibold">Usage</th>
                      <th className="px-4 py-2 text-right font-semibold">Resets</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => <LimitRow key={row.field} row={row} />)}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}
