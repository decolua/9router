"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, Badge, Button, Input, CardSkeleton } from "@/shared/components";
import { useLocale, useTranslations } from "next-intl";

function formatNumber(value, locale) {
  return new Intl.NumberFormat(locale).format(value || 0);
}

function formatDate(value, locale) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString(locale);
}

function QuotaItem({ label, icon, used, limit, remaining }) {
  const t = useTranslations();
  const locale = useLocale();
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
          {limited ? t("keyDashboard.percentUsed", { percent }) : t("keyDashboard.unlimited")}
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
          <p className="uppercase tracking-wide">{t("keyDashboard.used")}</p>
          <p className="text-sm font-semibold text-text-main">{formatNumber(used, locale)}</p>
        </div>
        <div>
          <p className="uppercase tracking-wide">{t("keyDashboard.remaining")}</p>
          <p className="text-sm font-semibold text-text-main">
            {limited ? formatNumber(remaining, locale) : t("keyDashboard.unlimited")}
          </p>
        </div>
        <div>
          <p className="uppercase tracking-wide">{t("keyDashboard.limit")}</p>
          <p className="text-sm font-semibold text-text-main">
            {limited ? formatNumber(limit, locale) : "-"}
          </p>
        </div>
      </div>
    </div>
  );
}

export default function KeyDashboardPage() {
  const t = useTranslations();
  const locale = useLocale();
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
           throw new Error(payload?.error || t("keyDashboard.failedUsage"));
        }
        const payload = await res.json();
        if (mounted) setSummary(payload);
      } catch (err) {
        if (mounted) setError(err.message || t("keyDashboard.failedUsage"));
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
         throw new Error(payload?.error || t("keyDashboard.failedLogs"));
      }
      setLogs(Array.isArray(payload?.items) ? payload.items : []);
    } catch (err) {
       setError(err.message || t("keyDashboard.failedLogs"));
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
          {t("keyDashboard.badge")}
        </Badge>
        <h1 className="text-2xl font-semibold text-text-main">{t("keyDashboard.title")}</h1>
        <p className="text-sm text-text-muted">
          {t("keyDashboard.subtitle")}
        </p>
      </div>

      {error && (
        <Card>
          <p className="text-sm text-red-500">{error}</p>
        </Card>
      )}

      <Card
        title={summary?.name ? t("keyDashboard.titleWithName", { name: summary.name }) : t("keyDashboard.summaryTitle")}
        subtitle={t("keyDashboard.createdAt", { date: formatDate(summary?.createdAt, locale) })}
        icon="insights"
        action={
          <Button variant="secondary" size="sm" onClick={() => setRefreshKey((v) => v + 1)}>
            {t("keyDashboard.refresh")}
          </Button>
        }
      >
        <div className="grid md:grid-cols-2 gap-4">
          <QuotaItem
            label={t("keyDashboard.requests")}
            icon="call_made"
            used={summary?.quota?.requestUsed}
            limit={summary?.quota?.requestLimit}
            remaining={summary?.quota?.requestRemaining}
          />
          <QuotaItem
            label={t("keyDashboard.tokens")}
            icon="data_usage"
            used={summary?.quota?.tokenUsed}
            limit={summary?.quota?.tokenLimit}
            remaining={summary?.quota?.tokenRemaining}
          />
        </div>
        <div className="mt-5 text-xs text-text-muted">
          {t("keyDashboard.lastAccessed")}: <span className="text-text-main font-medium">{formatDate(summary?.lastAccessed, locale)}</span>
        </div>
        <div className="mt-6">
          <p className="text-sm font-semibold text-text-main mb-2">{t("keyDashboard.allowedModels")}</p>
          {allowedModels.length === 0 ? (
            <div className="text-sm text-text-muted">{t("keyDashboard.allowedAll")}</div>
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

      <Card title={t("keyDashboard.logsTitle")} subtitle={t("keyDashboard.logsSubtitle")} icon="receipt_long">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col md:flex-row gap-3 md:items-end">
              <Input
                label={t("keyDashboard.filterLabel")}
                placeholder={t("keyDashboard.filterPlaceholder")}
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
                {logsLoading ? t("keyDashboard.loading") : t("keyDashboard.applyFilter")}
              </Button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-bg-subtle/30 text-text-muted uppercase text-xs">
                <tr>
                  <th className="px-4 py-2">{t("keyDashboard.time")}</th>
                  <th className="px-4 py-2">{t("keyDashboard.provider")}</th>
                  <th className="px-4 py-2">{t("keyDashboard.model")}</th>
                  <th className="px-4 py-2">{t("keyDashboard.connection")}</th>
                  <th className="px-4 py-2 text-right">{t("keyDashboard.input")}</th>
                  <th className="px-4 py-2 text-right">{t("keyDashboard.output")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {logs.length === 0 && !logsLoading && (
                  <tr>
                    <td className="px-4 py-6 text-center text-text-muted" colSpan={6}>
                      {t("keyDashboard.noLogs")}
                    </td>
                  </tr>
                )}
                {logs.map((entry, idx) => (
                  <tr key={`${entry.timestamp}-${idx}`} className="hover:bg-bg-subtle/20">
                    <td className="px-4 py-2 text-text-muted whitespace-nowrap">
                      {formatDate(entry.timestamp, locale)}
                    </td>
                    <td className="px-4 py-2">{entry.provider || "-"}</td>
                    <td className="px-4 py-2">{entry.model || "-"}</td>
                    <td className="px-4 py-2 text-text-muted">
                      {entry.connectionId ? entry.connectionId.slice(0, 8) : "-"}
                    </td>
                    <td className="px-4 py-2 text-right text-text-muted">
                      {formatNumber(entry.tokens?.prompt_tokens || entry.tokens?.input_tokens, locale)}
                    </td>
                    <td className="px-4 py-2 text-right text-text-muted">
                      {formatNumber(entry.tokens?.completion_tokens || entry.tokens?.output_tokens, locale)}
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
