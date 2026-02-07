"use client";

import { useState } from "react";
import Link from "next/link";
import { Card, Button, Input, Badge } from "@/shared/components";
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

function QuotaBlock({ title, icon, used, limit, remaining }) {
  const t = useTranslations();
  const locale = useLocale();
  const limited = Number(limit) > 0;
  const percent = limited ? Math.min(100, Math.round((Number(used || 0) / limit) * 100)) : 0;

  return (
    <div className="rounded-xl border border-black/5 dark:border-white/10 bg-white/70 dark:bg-white/5 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px] text-primary">{icon}</span>
          <p className="text-sm font-semibold text-text-main">{title}</p>
        </div>
        <Badge variant={limited ? "primary" : "success"} size="sm">
          {limited ? t("keyStatus.percentUsed", { percent }) : t("keyStatus.unlimited")}
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
          <p className="uppercase tracking-wide">{t("keyStatus.used")}</p>
          <p className="text-sm font-semibold text-text-main">{formatNumber(used, locale)}</p>
        </div>
        <div>
          <p className="uppercase tracking-wide">{t("keyStatus.remaining")}</p>
          <p className="text-sm font-semibold text-text-main">
            {limited ? formatNumber(remaining, locale) : t("keyStatus.unlimited")}
          </p>
        </div>
        <div>
          <p className="uppercase tracking-wide">{t("keyStatus.limit")}</p>
          <p className="text-sm font-semibold text-text-main">
            {limited ? formatNumber(limit, locale) : "-"}
          </p>
        </div>
      </div>
    </div>
  );
}

export default function KeyStatusPage() {
  const t = useTranslations();
  const locale = useLocale();
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState(null);

  const handleSubmit = async (event) => {
    event.preventDefault();
    const trimmed = apiKey.trim();
    if (!trimmed) {
      setError(t("keyStatus.enterKey"));
      setData(null);
      return;
    }

    setLoading(true);
    setError("");
    setData(null);

    try {
      const res = await fetch("/api/public/key-usage", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${trimmed}`,
        },
        body: JSON.stringify({ apiKey: trimmed }),
      });

      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(payload?.error || t("keyStatus.invalidKey"));
        return;
      }

      setData(payload);
    } catch (err) {
      setError(t("keyStatus.serverError"));
    } finally {
      setLoading(false);
    }
  };

  const allowedModels = Array.isArray(data?.allowedModels) ? data.allowedModels : [];

  return (
    <div className="min-h-screen bg-bg relative overflow-hidden">
      <div className="absolute inset-0">
        <div className="absolute -top-32 -right-32 h-80 w-80 rounded-full bg-primary/15 blur-[120px]" />
        <div className="absolute bottom-0 left-1/4 h-72 w-72 rounded-full bg-amber-300/20 blur-[140px]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(217,119,87,0.08),_transparent_45%)]" />
      </div>

      <div className="relative z-10 max-w-5xl mx-auto px-6 py-16">
        <div className="flex flex-col gap-3 max-w-2xl">
          <Badge variant="primary" size="sm" icon="vpn_key">
            {t("keyStatus.badge")}
          </Badge>
          <h1 className="text-3xl md:text-4xl font-bold text-text-main">
            {t("keyStatus.title")}
          </h1>
          <p className="text-text-muted text-sm md:text-base">
            {t("keyStatus.subtitle")}
          </p>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <Link
              href="/login"
              className="inline-flex items-center justify-center gap-2 font-medium transition-all duration-200 cursor-pointer bg-gradient-to-b from-primary to-primary-hover text-white shadow-sm h-9 px-4 text-sm rounded-lg"
            >
              <span className="material-symbols-outlined text-[18px]">login</span>
              {t("keyStatus.dashboardLogin")}
            </Link>
            <span className="text-text-muted">{t("keyStatus.dashboardHint")}</span>
          </div>
        </div>

        <div className="grid lg:grid-cols-[1.2fr_0.8fr] gap-6 mt-10">
          <Card title={t("keyStatus.lookupTitle")} subtitle={t("keyStatus.lookupSubtitle")} icon="visibility">
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <Input
                label={t("keyStatus.apiKeyLabel")}
                icon="key"
                placeholder={t("keyStatus.apiKeyPlaceholder")}
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                error={error}
                required
              />
              <div className="flex items-center gap-3">
                <Button type="submit" loading={loading} icon="search" className="px-6">
                  {loading ? t("keyStatus.checking") : t("keyStatus.checkUsage")}
                </Button>
                <p className="text-xs text-text-muted">
                  {t("keyStatus.tips")}
                </p>
              </div>
            </form>
          </Card>

          <Card title={t("keyStatus.viewTitle")} subtitle={t("keyStatus.viewSubtitle")} icon="verified_user">
            <div className="flex flex-col gap-4 text-sm text-text-muted">
              <div className="flex items-start gap-3">
                <span className="material-symbols-outlined text-[18px] text-primary">query_stats</span>
                <div>
                  <p className="font-semibold text-text-main">{t("keyStatus.viewRequestsTitle")}</p>
                  <p>{t("keyStatus.viewRequestsDesc")}</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <span className="material-symbols-outlined text-[18px] text-primary">tune</span>
                <div>
                  <p className="font-semibold text-text-main">{t("keyStatus.viewModelsTitle")}</p>
                  <p>{t("keyStatus.viewModelsDesc")}</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <span className="material-symbols-outlined text-[18px] text-primary">lock</span>
                <div>
                  <p className="font-semibold text-text-main">{t("keyStatus.viewPrivacyTitle")}</p>
                  <p>{t("keyStatus.viewPrivacyDesc")}</p>
                </div>
              </div>
            </div>
          </Card>
        </div>

        {data && (
          <Card
            className="mt-8"
            title={data?.name ? t("keyStatus.summaryWithName", { name: data.name }) : t("keyStatus.summaryTitle")}
            subtitle={t("keyStatus.summarySubtitle", { date: formatDate(data?.createdAt, locale) })}
            icon="insights"
          >
            <div className="grid md:grid-cols-2 gap-4">
              <QuotaBlock
                title={t("keyStatus.requests")}
                icon="call_made"
                used={data?.quota?.requestUsed}
                limit={data?.quota?.requestLimit}
                remaining={data?.quota?.requestRemaining}
              />
              <QuotaBlock
                title={t("keyStatus.tokens")}
                icon="data_usage"
                used={data?.quota?.tokenUsed}
                limit={data?.quota?.tokenLimit}
                remaining={data?.quota?.tokenRemaining}
              />
            </div>

            <div className="mt-5 text-xs text-text-muted">
              {t("keyStatus.lastAccessed")}: <span className="text-text-main font-medium">{formatDate(data?.lastAccessed, locale)}</span>
            </div>

            <div className="mt-6">
              <p className="text-sm font-semibold text-text-main mb-2">{t("keyStatus.allowedModels")}</p>
              {allowedModels.length === 0 ? (
                <div className="text-sm text-text-muted">{t("keyStatus.allowedAll")}</div>
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
        )}
      </div>
    </div>
  );
}
