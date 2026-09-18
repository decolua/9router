"use client";

import { useCallback, useEffect, useState } from "react";
import Card from "@/shared/components/Card";
import Button from "@/shared/components/Button";
import { cn } from "@/shared/utils/cn";
import LanguageSwitcher from "@/shared/components/LanguageSwitcher";
import { translate, onLocaleChange } from "@/i18n/runtime";
import { useEffect as useLocaleEffect, useState as useLocaleState } from "react";

/** useT — terjemahan reaktif terhadap locale 9Router. */
function useT() {
  const [, force] = useLocaleState(0);
  useLocaleEffect(() => {
    const unsub = onLocaleChange(() => force((n) => n + 1));
    return () => { if (typeof unsub === "function") unsub(); };
  }, []);
  return translate;
}


const REFRESH_MS = 10000;

export default function MonitoringPage() {
  const t = useT();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [auto, setAuto] = useState(true);
  const [lastAt, setLastAt] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/monitoring", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
      setError("");
      setLastAt(new Date());
    } catch (e) {
      setError(e?.message || "Gagal memuat status");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!auto) return undefined;
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, [auto, load]);

  const rt = data?.runtime || {};
  const act = data?.activity || {};
  const today = act.today || {};
  const health = data?.health || [];

  return (
    <div className="flex min-w-0 flex-col gap-6 px-1 sm:px-0">
      {/* Header + kontrol refresh */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-text-main">
            {t("Monitor 9Router via Telegram Bot")}
          </h1>
          <p className="text-sm text-text-muted">
            {t("Runtime status, activity, and provider health — watchable from Telegram.")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Pemilihan bahasa — memakai LanguageSwitcher 9Router, jadi
              daftar & default-nya otomatis mengikuti pengaturan 9Router. */}
          <LanguageSwitcher />
          <button
            onClick={() => setAuto((v) => !v)}
            className={cn(
              "flex items-center gap-2 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors cursor-pointer",
              auto
                ? "bg-primary/10 text-primary"
                : "text-text-muted hover:bg-surface-2 hover:text-text-main"
            )}
          >
            <span
              className={cn("size-2 rounded-full", auto ? "bg-green-500" : "bg-text-muted/40")}
            />
            {auto ? t("Live") : t("Paused")}
          </button>
          <Button variant="secondary" onClick={load} disabled={loading}>
            <span className="flex items-center gap-2">
              <span
                className={cn(
                  "material-symbols-outlined text-[16px]",
                  loading && "animate-spin"
                )}
              >
                progress_activity
              </span>
              {t("Refresh")}
            </span>
          </Button>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-3">
          <span className="material-symbols-outlined mt-0.5 text-[18px] text-red-500">
            warning
          </span>
          <div className="text-sm text-red-500">
            <p className="font-medium">Failed to load monitoring status</p>
            <p className="text-red-500/80">{error}</p>
          </div>
        </div>
      )}

      {/* Kartu ringkas sistem */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon="dns"
          label="Gateway"
          value={error ? "Error" : "Online"}
          tone={error ? "bad" : "good"}
          rows={[
            ["Latency", data ? `${data.latencyMs} ms` : "-"],
            ["Version", data?.version || "-"],
            ["Uptime", formatUptime(rt.processUptimeSec)],
            ["Node", rt.nodeVersion || "-"],
          ]}
        />
        <StatCard
          icon="bar_chart"
          label={t("Activity · 24h")}
          value={formatNum(today.requests)}
          tone="neutral"
          rows={[
            ["Prompt tokens", formatNum(today.promptTokens)],
            ["Completion tokens", formatNum(today.completionTokens)],
            ["Active providers", formatNum(today.providers)],
            ["Models used", formatNum(today.models)],
          ]}
        />
        <StatCard
          icon="bolt"
          label="Gateway Latency"
          value={data ? `${data.latencyMs} ms` : "-"}
          tone={data && data.latencyMs > 1000 ? "warn" : "neutral"}
          rows={[
            ["Version", data?.version || "-"],
            ["Memory", rt.memoryRssMB ? `${rt.memoryRssMB} MB` : "-"],
            ["Error provider", act.errorProvider || "—"],
            ["Updated", lastAt ? lastAt.toLocaleTimeString() : "-"],
          ]}
        />
        <StatCard
          icon="storage"
          label="Penyimpanan"
          value={rt.dbSizeLabel || "-"}
          tone="neutral"
          rows={[
            ["Type", "SQLite"],
            ["File", basename(rt.dbPath) || "-"],
            ["Data dir", basename(rt.dataDir) || "-"],
            ["Providers recorded", formatNum(health.length)],
          ]}
        />
      </div>

      {/* Bot Telegram — input token, kontrol, log */}

    </div>
  );
}

function StatCard({ icon, label, value, rows, tone }) {
  const toneClass =
    {
      good: "text-green-500",
      bad: "text-red-500",
      warn: "text-amber-500",
      neutral: "text-text-main",
    }[tone] || "text-text-main";

  return (
    <Card padding="sm">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px] text-text-muted">
            {icon}
          </span>
          <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">
            {label}
          </span>
        </div>
        <div className={cn("text-2xl font-semibold tabular-nums", toneClass)}>{value}</div>
        <dl className="flex flex-col gap-1">
          {rows.map(([k, v]) => (
            <div key={k} className="flex items-center justify-between gap-2 text-xs">
              <dt className="text-text-muted">{k}</dt>
              <dd className="truncate font-medium text-text-main">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </Card>
  );
}

function formatNum(n) {
  if (n === null || n === undefined) return "0";
  return Number(n).toLocaleString("en-US");
}

function formatUptime(sec) {
  if (!sec || sec < 0) return "-";
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}h ${h}j`;
  if (h > 0) return `${h}j ${m}m`;
  return `${m}m`;
}

function basename(p) {
  if (!p || typeof p !== "string") return "";
  return p.split("/").filter(Boolean).pop() || "";
}
