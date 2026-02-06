"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, Badge, Button, Input, CardSkeleton } from "@/shared/components";

function formatNumber(value) {
  return new Intl.NumberFormat().format(value || 0);
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
}

function QuotaItem({ label, icon, used, limit, remaining }) {
  const limited = Number(limit) > 0;
  const percent = limited ? Math.min(100, Math.round((Number(used || 0) / limit) * 100)) : 0;

  return (
    <div className="rounded-xl border border-black/5 dark:border-white/10 bg-white/70 dark:bg-white/5 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px] text-primary">{icon}</span>
          <p className="text-sm font-semibold text-text-main">{label}</p>
        </div>
        <Badge variant={limited ? "primary" : "success"} size="sm">
          {limited ? `${percent}% used` : "Unlimited"}
        </Badge>
      </div>
      <div className="h-2 rounded-full bg-black/5 dark:bg-white/10 overflow-hidden">
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: limited ? `${percent}%` : "100%", opacity: limited ? 1 : 0.35 }}
        />
      </div>
      <div className="mt-4 grid grid-cols-3 gap-3 text-xs text-text-muted">
        <div>
          <p className="uppercase tracking-wide">Used</p>
          <p className="text-sm font-semibold text-text-main">{formatNumber(used)}</p>
        </div>
        <div>
          <p className="uppercase tracking-wide">Remaining</p>
          <p className="text-sm font-semibold text-text-main">
            {limited ? formatNumber(remaining) : "Unlimited"}
          </p>
        </div>
        <div>
          <p className="uppercase tracking-wide">Limit</p>
          <p className="text-sm font-semibold text-text-main">
            {limited ? formatNumber(limit) : "-"}
          </p>
        </div>
      </div>
    </div>
  );
}

export default function KeyDashboardPage() {
  const [summary, setSummary] = useState(null);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [logsLoading, setLogsLoading] = useState(false);
  const [error, setError] = useState("");
  const [connectionFilter, setConnectionFilter] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let mounted = true;

    const loadSummary = async () => {
      try {
        const res = await fetch("/api/public/key-usage", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        if (!res.ok) {
          const payload = await res.json().catch(() => ({}));
          throw new Error(payload?.error || "Failed to load usage");
        }
        const payload = await res.json();
        if (mounted) setSummary(payload);
      } catch (err) {
        if (mounted) setError(err.message || "Failed to load usage");
      } finally {
        if (mounted) setLoading(false);
      }
    };

    loadSummary();
    return () => {
      mounted = false;
    };
  }, [refreshKey]);

  const loadLogs = async () => {
    setLogsLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (connectionFilter.trim()) {
        params.set("connectionId", connectionFilter.trim());
      }
      params.set("limit", "200");
      const res = await fetch(`/api/usage/key-logs?${params.toString()}`);
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(payload?.error || "Failed to load logs");
      }
      setLogs(Array.isArray(payload?.items) ? payload.items : []);
    } catch (err) {
      setError(err.message || "Failed to load logs");
    } finally {
      setLogsLoading(false);
    }
  };

  useEffect(() => {
    loadLogs();
  }, [refreshKey]);

  const allowedModels = useMemo(() => {
    return Array.isArray(summary?.allowedModels) ? summary.allowedModels : [];
  }, [summary]);

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Badge variant="primary" size="sm" icon="vpn_key">
          API Key Access
        </Badge>
        <h1 className="text-2xl font-semibold text-text-main">Your API key usage</h1>
        <p className="text-sm text-text-muted">
          Read-only access for your key. Admin features are hidden by design.
        </p>
      </div>

      {error && (
        <Card>
          <p className="text-sm text-red-500">{error}</p>
        </Card>
      )}

      <Card
        title={summary?.name ? `Key: ${summary.name}` : "Key summary"}
        subtitle={`Created ${formatDate(summary?.createdAt)}`}
        icon="insights"
        action={
          <Button variant="secondary" size="sm" onClick={() => setRefreshKey((v) => v + 1)}>
            Refresh
          </Button>
        }
      >
        <div className="grid md:grid-cols-2 gap-4">
          <QuotaItem
            label="Requests"
            icon="call_made"
            used={summary?.quota?.requestUsed}
            limit={summary?.quota?.requestLimit}
            remaining={summary?.quota?.requestRemaining}
          />
          <QuotaItem
            label="Tokens"
            icon="data_usage"
            used={summary?.quota?.tokenUsed}
            limit={summary?.quota?.tokenLimit}
            remaining={summary?.quota?.tokenRemaining}
          />
        </div>
        <div className="mt-5 text-xs text-text-muted">
          Last accessed: <span className="text-text-main font-medium">{formatDate(summary?.lastAccessed)}</span>
        </div>
        <div className="mt-6">
          <p className="text-sm font-semibold text-text-main mb-2">Allowed models</p>
          {allowedModels.length === 0 ? (
            <div className="text-sm text-text-muted">All models are allowed for this key.</div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {allowedModels.map((model) => (
                <Badge key={model} variant="default" size="sm">
                  {model}
                </Badge>
              ))}
            </div>
          )}
        </div>
      </Card>

      <Card title="Request logs" subtitle="Latest 200 requests for this key" icon="receipt_long">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col md:flex-row gap-3 md:items-end">
            <Input
              label="Filter by connectionId"
              placeholder="Optional connectionId"
              value={connectionFilter}
              onChange={(event) => setConnectionFilter(event.target.value)}
            />
            <Button
              variant="secondary"
              size="md"
              onClick={loadLogs}
              loading={logsLoading}
              className="md:w-[180px]"
            >
              {logsLoading ? "Loading" : "Apply filter"}
            </Button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-bg-subtle/30 text-text-muted uppercase text-xs">
                <tr>
                  <th className="px-4 py-2">Time</th>
                  <th className="px-4 py-2">Provider</th>
                  <th className="px-4 py-2">Model</th>
                  <th className="px-4 py-2">Connection</th>
                  <th className="px-4 py-2 text-right">Input</th>
                  <th className="px-4 py-2 text-right">Output</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {logs.length === 0 && !logsLoading && (
                  <tr>
                    <td className="px-4 py-6 text-center text-text-muted" colSpan={6}>
                      No logs yet for this key.
                    </td>
                  </tr>
                )}
                {logs.map((entry, idx) => (
                  <tr key={`${entry.timestamp}-${idx}`} className="hover:bg-bg-subtle/20">
                    <td className="px-4 py-2 text-text-muted whitespace-nowrap">
                      {formatDate(entry.timestamp)}
                    </td>
                    <td className="px-4 py-2">{entry.provider || "-"}</td>
                    <td className="px-4 py-2">{entry.model || "-"}</td>
                    <td className="px-4 py-2 text-text-muted">
                      {entry.connectionId ? entry.connectionId.slice(0, 8) : "-"}
                    </td>
                    <td className="px-4 py-2 text-right text-text-muted">
                      {formatNumber(entry.tokens?.prompt_tokens || entry.tokens?.input_tokens)}
                    </td>
                    <td className="px-4 py-2 text-right text-text-muted">
                      {formatNumber(entry.tokens?.completion_tokens || entry.tokens?.output_tokens)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Card>
    </div>
  );
}
