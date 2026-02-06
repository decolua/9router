"use client";

import { useState } from "react";
import Link from "next/link";
import { Card, Button, Input, Badge } from "@/shared/components";

function formatNumber(value) {
  return new Intl.NumberFormat().format(value || 0);
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
}

function QuotaBlock({ title, icon, used, limit, remaining }) {
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

export default function KeyStatusPage() {
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState(null);

  const handleSubmit = async (event) => {
    event.preventDefault();
    const trimmed = apiKey.trim();
    if (!trimmed) {
      setError("Please enter your API key.");
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
        setError(payload?.error || "Invalid API key.");
        return;
      }

      setData(payload);
    } catch (err) {
      setError("Could not reach the server. Please try again.");
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
            API Key Status
          </Badge>
          <h1 className="text-3xl md:text-4xl font-bold text-text-main">
            Check your API key usage in seconds
          </h1>
          <p className="text-text-muted text-sm md:text-base">
            Paste your API key to see remaining request and token limits. We do not store your key or share any
            personal data.
          </p>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <Link
              href="/login"
              className="inline-flex items-center justify-center gap-2 font-medium transition-all duration-200 cursor-pointer bg-gradient-to-b from-primary to-primary-hover text-white shadow-sm h-9 px-4 text-sm rounded-lg"
            >
              <span className="material-symbols-outlined text-[18px]">login</span>
              Dashboard login
            </Link>
            <span className="text-text-muted">Need full dashboard access? Sign in with password or API key.</span>
          </div>
        </div>

        <div className="grid lg:grid-cols-[1.2fr_0.8fr] gap-6 mt-10">
          <Card title="Look up your quota" subtitle="Read-only view for API key owners" icon="visibility">
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <Input
                label="API Key"
                icon="key"
                placeholder="sk-xxxxxxxxxxxxxxxx"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                error={error}
                required
              />
              <div className="flex items-center gap-3">
                <Button type="submit" loading={loading} icon="search" className="px-6">
                  {loading ? "Checking..." : "Check usage"}
                </Button>
                <p className="text-xs text-text-muted">
                  Tips: Use the key exactly as provided. This page is read-only.
                </p>
              </div>
            </form>
          </Card>

          <Card title="What you can view" subtitle="Safe, limited data only" icon="verified_user">
            <div className="flex flex-col gap-4 text-sm text-text-muted">
              <div className="flex items-start gap-3">
                <span className="material-symbols-outlined text-[18px] text-primary">query_stats</span>
                <div>
                  <p className="font-semibold text-text-main">Request and token usage</p>
                  <p>Track how much quota has been used and what is remaining.</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <span className="material-symbols-outlined text-[18px] text-primary">tune</span>
                <div>
                  <p className="font-semibold text-text-main">Allowed models</p>
                  <p>See which models are currently allowed for your key.</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <span className="material-symbols-outlined text-[18px] text-primary">lock</span>
                <div>
                  <p className="font-semibold text-text-main">Privacy-first</p>
                  <p>No key values or sensitive metadata are exposed or stored.</p>
                </div>
              </div>
            </div>
          </Card>
        </div>

        {data && (
          <Card
            className="mt-8"
            title={data?.name ? `Usage summary for ${data.name}` : "Usage summary"}
            subtitle={`Key created ${formatDate(data?.createdAt)}`}
            icon="insights"
          >
            <div className="grid md:grid-cols-2 gap-4">
              <QuotaBlock
                title="Requests"
                icon="call_made"
                used={data?.quota?.requestUsed}
                limit={data?.quota?.requestLimit}
                remaining={data?.quota?.requestRemaining}
              />
              <QuotaBlock
                title="Tokens"
                icon="data_usage"
                used={data?.quota?.tokenUsed}
                limit={data?.quota?.tokenLimit}
                remaining={data?.quota?.tokenRemaining}
              />
            </div>

            <div className="mt-5 text-xs text-text-muted">
              Last accessed: <span className="text-text-main font-medium">{formatDate(data?.lastAccessed)}</span>
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
        )}
      </div>
    </div>
  );
}
