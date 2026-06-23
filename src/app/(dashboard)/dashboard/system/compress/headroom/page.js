"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, Toggle, Input, CardSkeleton, Button, Badge } from "@/shared/components";

const DEFAULT_URL = "http://localhost:8787";
const STATS_POLL_MS = 30_000;

// ── formatters ────────────────────────────────────────────────────────────────
const fmtNum = (v) =>
  v == null || v === "" ? "—" : new Intl.NumberFormat().format(v);

const fmtUSD = (v) =>
  v == null || v === ""
    ? "—"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(v);

const fmtPct = (v) =>
  v == null || v === "" ? "—" : `${Number(v).toFixed(2)}%`;

const sourceLabel = (src, ready) => {
  if (!src) return "unavailable";
  if (src === "native" && ready === false) return "unavailable";
  return src;
};

// ── MetricCard ────────────────────────────────────────────────────────────────
function MetricCard({ label, value, hint }) {
  return (
    <Card padding="sm" className="flex flex-col gap-1 min-w-0">
      <p className="text-xs text-text-muted font-medium uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-semibold text-text-main truncate">{value}</p>
      {hint && <p className="text-xs text-text-muted">{hint}</p>}
    </Card>
  );
}

// ── ProjectCard ───────────────────────────────────────────────────────────────
function ProjectCard({ name, data }) {
  return (
    <Card padding="sm" className="flex flex-col gap-0.5 min-w-0">
      <p className="font-medium text-sm text-text-main truncate">{name}</p>
      <p className="text-xs text-text-muted">
        {fmtNum(data.tokens_saved)} tokens saved
      </p>
      <p className="text-xs text-text-muted">
        {fmtUSD(data.compression_savings_usd)} · {fmtPct(data.savings_percent)}
      </p>
      <p className="text-xs text-text-muted">{fmtNum(data.requests)} requests</p>
    </Card>
  );
}

// ── HeadroomMetrics ───────────────────────────────────────────────────────────
function HeadroomMetrics() {
  const [stats, setStats] = useState(null); // null = loading, false = error
  const [statsLoading, setStatsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetch("/api/headroom/stats")
        .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
        .then((data) => { if (!cancelled) { setStats(data); setStatsLoading(false); } })
        .catch(() => { if (!cancelled) { setStats(false); setStatsLoading(false); } });
    };
    load();
    const id = setInterval(load, STATS_POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  if (statsLoading) {
    return <CardSkeleton />;
  }

  // ── Error state ──────────────────────────────────────────────────────────
  if (stats === false) {
    return (
      <Card padding="md">
        <div className="flex items-center gap-3 text-text-muted">
          <span className="material-symbols-outlined text-[20px] text-amber-500">warning</span>
          <p className="text-sm">Headroom unavailable — could not read router stats</p>
        </div>
      </Card>
    );
  }

  const { health = {}, summary = {}, savings = {}, source } = stats;
  const isHealthy = health.status === "healthy";
  const perProject = savings.per_project || {};
  const projectKeys = Object.keys(perProject);

  // Detect if there's a real dashboard URL to link to
  const dashboardUrl =
    source === "custom" || source === "detected" ? stats._dashboardUrl || null : null;

  return (
    <div className="flex flex-col gap-4">
      {/* ── Status row ──────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 flex-wrap">
        <Badge variant={isHealthy ? "success" : "error"} dot>
          {isHealthy ? "healthy" : "fetch-error"}
        </Badge>
        {health.version && (
          <span className="text-xs text-text-muted font-mono">v{health.version}</span>
        )}
        <span className="text-xs text-text-muted">
          Using: <span className="font-medium text-text-main">{sourceLabel(source, health.ready)}</span>
        </span>
        {dashboardUrl && (
          <a
            href={dashboardUrl}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-primary underline hover:opacity-80"
          >
            Open UI ↗
          </a>
        )}
      </div>

      {/* ── Four metric cards ───────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MetricCard
          label="API Requests"
          value={fmtNum(summary.api_requests)}
          hint={summary.primary_model ? `Model: ${summary.primary_model}` : "Model: —"}
        />
        <MetricCard
          label="Tokens Saved"
          value={fmtNum(savings.total_tokens)}
          hint={
            summary.compression?.avg_compression_pct != null
              ? `avg ${fmtPct(summary.compression.avg_compression_pct)} compression`
              : "avg — compression"
          }
        />
        <MetricCard
          label="Est. Savings"
          value={fmtUSD(summary.cost?.total_saved_usd)}
          hint={
            summary.cost?.savings_pct != null
              ? `${fmtPct(summary.cost.savings_pct)} savings`
              : "— savings"
          }
        />
        <MetricCard
          label="Mode"
          value={summary.mode || "—"}
          hint="Compression strategy"
        />
      </div>

      {/* ── Per-project savings grid ─────────────────────────────────────── */}
      {projectKeys.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium text-text-muted uppercase tracking-wide">Per-project savings</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {projectKeys.map((k) => (
              <ProjectCard key={k} name={k} data={perProject[k]} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function HeadroomCompressPage() {
  const [enabled, setEnabled] = useState(false);
  const [url, setUrl] = useState(DEFAULT_URL);
  const [loading, setLoading] = useState(true);
  const [probing, setProbing] = useState(false);
  const [probeResult, setProbeResult] = useState(null); // { ok, url, detected, error?, message? }

  useEffect(() => {
    let cancelled = false;
    fetch("/api/settings")
      .then((r) => (r.ok ? r.json() : {}))
      .then((data) => {
        if (cancelled) return;
        setEnabled(!!data.headroomEnabled);
        setUrl(data.headroomUrl || DEFAULT_URL);
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, []);

  const patch = async (patch) => {
    try {
      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
    } catch (e) {
      console.log("Error updating headroom settings:", e);
    }
  };

  const probe = useCallback(async (probeUrl) => {
    setProbing(true);
    setProbeResult(null);
    try {
      const target = probeUrl || undefined;
      const probeEndpoint = target
        ? `/api/headroom/probe?url=${encodeURIComponent(target)}`
        : "/api/headroom/probe";
      const r = await fetch(probeEndpoint);
      const body = await r.json().catch(() => ({}));
      setProbeResult(body);
      // Auto-apply the detected URL if no custom URL was probed
      if (!target && body.ok && body.url) {
        setUrl(body.url);
        await patch({ headroomUrl: body.url });
      }
    } catch (e) {
      setProbeResult({ ok: false, error: e?.message || "probe failed" });
    } finally {
      setProbing(false);
    }
  }, []);

  // Auto-probe on mount to surface already-running servers
  useEffect(() => {
    if (!loading) Promise.resolve().then(() => probe());
  }, [loading, probe]);

  const handleToggle = (value) => {
    const nextUrl = url.trim() || DEFAULT_URL;
    setUrl(nextUrl);
    setEnabled(value);
    patch({ headroomEnabled: value, headroomUrl: nextUrl });
  };

  const handleUrlBlur = () => {
    const next = url.trim() || DEFAULT_URL;
    setUrl(next);
    patch({ headroomUrl: next });
  };

  const handleProbeCustom = () => {
    if (url.trim()) probe(url.trim());
  };

  if (loading) {
    return (
      <div className="flex min-w-0 flex-col gap-6 px-1 sm:px-0">
        <CardSkeleton />
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-6 px-1 sm:px-0">
      <div>
        <h2 className="text-xl font-semibold">Headroom</h2>
        <p className="text-sm text-text-muted">
          Context compression via a local Headroom service. If a server is already running on this machine, it is detected automatically.
        </p>
      </div>

      {/* ── Settings / probe controls (KEPT INTACT) ───────────────────── */}
      <Card>
        <div className="flex items-center justify-between pt-2 pb-4 gap-4 flex-wrap">
          <div className="min-w-0 flex-1">
            <p className="font-medium">
              Compress context{" "}
              <a
                href="https://github.com/chopratejas/headroom"
                target="_blank"
                rel="noreferrer"
                className="text-xs font-normal text-primary underline hover:opacity-80"
              >
                (Headroom)
              </a>
            </p>
            <p className="text-sm text-text-muted">
              Run Headroom separately → compress via /v1/compress before provider routing
            </p>
          </div>
          <Toggle checked={enabled} onChange={() => handleToggle(!enabled)} />
        </div>

        {/* Detection panel */}
        <div className="border-t border-border-subtle pt-4 mt-2 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              icon="radar"
              onClick={() => probe()}
              loading={probing}
            >
              Auto-detect
            </Button>
            <span className="text-xs text-text-muted">Probe default ports (localhost:8787, 127.0.0.1:8787)</span>
          </div>

          {probeResult && (
            <div
              className={`rounded-lg border px-3 py-2 text-sm ${
                probeResult.ok
                  ? "border-green-500/40 bg-green-500/10 text-green-700 dark:text-green-300"
                  : "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
              }`}
            >
              {probeResult.ok ? (
                <>
                  ✓ Detected headroom server at <code className="font-mono">{probeResult.url}</code>
                  {probeResult.detected && " (auto-applied)"}
                </>
              ) : (
                <>
                  {probeResult.message || probeResult.error || "No headroom server detected."}
                  {probeResult.url && ` (probed: ${probeResult.url})`}
                </>
              )}
            </div>
          )}

          {/* Custom URL */}
          <div className="flex items-center gap-2">
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onBlur={handleUrlBlur}
              placeholder={DEFAULT_URL}
              className="flex-1 font-mono text-sm"
            />
            <Button
              size="sm"
              variant="outline"
              icon="network_check"
              onClick={handleProbeCustom}
              loading={probing}
              disabled={!url.trim()}
            >
              Test
            </Button>
          </div>
          <p className="text-xs text-text-muted">
            Custom URL overrides auto-detection. If a server is found via Auto-detect, the URL field updates automatically.
          </p>

          {enabled && (
            <p className="text-xs text-primary">
              Active — requests will be compressed through <code className="font-mono">{url}</code>
            </p>
          )}
        </div>
      </Card>

      {/* ── Metrics view (added below settings) ───────────────────────── */}
      <div>
        <h3 className="text-base font-semibold mb-3">Compression Metrics</h3>
        <HeadroomMetrics />
      </div>
    </div>
  );
}
