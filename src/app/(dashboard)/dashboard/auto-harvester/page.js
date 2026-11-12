"use client";

import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import Link from "next/link";
import { Badge, Button, Card, CardSkeleton, Input, PageShell, Modal } from "@/shared/components";
import { cn } from "@/shared/utils/cn";

const LOOP_OPTIONS = [
  { value: 0, label: "Manual (Once)" },
  { value: 2, label: "Every 2m (Fast)" },
  { value: 5, label: "Every 5m" },
  { value: 15, label: "Every 15m" },
  { value: 30, label: "Every 30m" },
  { value: 60, label: "Every 1h" },
];

function formatTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export default function AutoHarvesterPage() {
  const [status, setStatus] = useState(null);
  const [pools, setPools] = useState([]);
  const [loading, setLoading] = useState(true);
  const [target, setTarget] = useState(10);
  const [maxScan, setMaxScan] = useState(1000);
  const [loop, setLoop] = useState(0);
  const [customFeedsText, setCustomFeedsText] = useState("");
  const [showFeedsModal, setShowFeedsModal] = useState(false);
  const [busy, setBusy] = useState(false);
  const timerRef = useRef(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/harvester");
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
        if (data.maxCandidates && !maxScan) {
          setMaxScan(data.maxCandidates);
        }
      }
    } catch {}
  }, [maxScan]);

  const fetchPools = useCallback(async () => {
    try {
      const res = await fetch("/api/proxy-pools");
      if (res.ok) {
        const data = await res.json();
        setPools(data.proxyPools || []);
      }
    } catch {}
  }, []);

  const refreshAll = useCallback(async () => {
    await Promise.all([fetchStatus(), fetchPools()]);
    setLoading(false);
  }, [fetchStatus, fetchPools]);

  useEffect(() => {
    refreshAll();
    timerRef.current = setInterval(refreshAll, 3000);
    return () => clearInterval(timerRef.current);
  }, [refreshAll]);

  const send = async (payload) => {
    setBusy(true);
    try {
      const res = await fetch("/api/harvester", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const data = await res.json();
        setStatus((prev) => ({ ...prev, ...data }));
        await fetchPools();
      }
    } catch {}
    finally {
      setBusy(false);
    }
  };

  const start = () => send({
    action: "start",
    target: Number(target) || 10,
    maxCandidates: Number(maxScan) || 1000,
    loopMinutes: Number(loop) || 0,
    customFeeds: customFeedsText.split("\n").map((s) => s.trim()).filter((s) => s.startsWith("http")),
  });
  const stop = () => send({ action: "stop" });

  const running = status?.running;
  const lastAdded = status?.lastAdded ?? 0;
  const lastTested = status?.lastTested ?? 0;
  const targetCount = status?.targetCount ?? target;
  const maxCandidatesCount = status?.maxCandidates ?? maxScan;

  const harvestedPools = useMemo(() => {
    return pools.filter((p) => {
      const n = String(p.name || "");
      return n.startsWith("seren-") || n.startsWith("FreeProxy-");
    });
  }, [pools]);

  const activeHarvested = useMemo(() => {
    return harvestedPools.filter((p) => p.isActive && p.testStatus === "working").length;
  }, [harvestedPools]);

  if (loading) {
    return (
      <PageShell width="reading">
        <div className="flex flex-col gap-4">
          <CardSkeleton />
          <CardSkeleton />
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell width="reading">
      <div className="flex flex-col gap-4 sm:gap-6">
        {/* Header Bar */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold sm:text-2xl">Proxy Harvester</h1>
            </div>
            <p className="text-xs text-text-muted mt-0.5">
              Autonomous background worker discovering and testing public proxy feeds.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Link href="/dashboard/proxy-pools">
              <Button size="sm" variant="secondary" icon="lan">
                View in Pools ({harvestedPools.length})
              </Button>
            </Link>
          </div>
        </div>

        {/* Controller Card */}
        <Card className="p-4 sm:p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3 min-w-0">
              <div className={cn(
                "flex size-10 shrink-0 items-center justify-center rounded-lg border",
                running
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-500"
                  : "border-border bg-surface-2 text-text-muted"
              )}>
                <span className={cn("material-symbols-outlined text-[22px]", running && "animate-spin")}>
                  {running ? "autorenew" : "radar"}
                </span>
              </div>
              <div className="min-w-0 flex flex-col">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-text-main">Harvester Worker</span>
                </div>
                <span className="text-xs text-text-muted truncate mt-0.5">
                  {status?.lastMessage || "Ready to discover and verify proxy feeds"}
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border/50 sm:pt-0 sm:border-t-0">
              <div className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1 text-xs">
                <label className="text-text-muted font-mono whitespace-nowrap">Target:</label>
                <input
                  type="number"
                  min="1"
                  max="500"
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  disabled={running}
                  className="w-14 rounded border border-border bg-surface-2 px-1.5 py-0.5 text-center font-mono text-xs text-text-main focus:border-primary focus:outline-none disabled:opacity-40"
                  title="Target number of working proxies to collect"
                />
              </div>

              <div className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1 text-xs">
                <label className="text-text-muted font-mono whitespace-nowrap">Max Scan:</label>
                <input
                  type="number"
                  min="50"
                  max="50000"
                  step="500"
                  value={maxScan}
                  onChange={(e) => setMaxScan(e.target.value)}
                  disabled={running}
                  className="w-16 rounded border border-border bg-surface-2 px-1.5 py-0.5 text-center font-mono text-xs text-text-main focus:border-primary focus:outline-none disabled:opacity-40"
                  title="Maximum candidate proxies to scan before ending cycle"
                />
              </div>

              <div className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1 text-xs">
                <label className="text-text-muted font-mono whitespace-nowrap">Schedule:</label>
                <select
                  value={loop}
                  onChange={(e) => setLoop(Number(e.target.value))}
                  disabled={running}
                  className="rounded border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-xs text-text-main focus:border-primary focus:outline-none cursor-pointer disabled:opacity-40"
                >
                  {LOOP_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <Button
                size="sm"
                variant="secondary"
                icon="rss_feed"
                onClick={() => setShowFeedsModal(true)}
                title="Configure custom proxy feeds"
              >
                Custom Feeds{status?.customFeeds?.length ? ` (${status.customFeeds.length})` : ""}
              </Button>

              {running ? (
                <Button
                  size="sm"
                  variant="danger"
                  icon="stop_circle"
                  onClick={stop}
                  loading={busy}
                >
                  Stop
                </Button>
              ) : (
                <Button
                  size="sm"
                  icon="play_arrow"
                  onClick={start}
                  loading={busy}
                >
                  Start
                </Button>
              )}
            </div>
          </div>
        </Card>

        {/* Live Metrics Row */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Card className="p-3">
            <span className="text-[11px] font-medium uppercase tracking-wider text-text-muted">Target Batch</span>
            <div className="text-lg font-semibold mt-1 tabular-nums text-text-main">
              {targetCount} <span className="text-xs font-normal text-text-muted">proxies</span>
            </div>
          </Card>
          <Card className="p-3">
            <span className="text-[11px] font-medium uppercase tracking-wider text-text-muted">Cycle Tested</span>
            <div className="text-lg font-semibold mt-1 tabular-nums text-text-main">
              {lastTested} <span className="text-xs font-normal text-text-muted">candidates</span>
            </div>
          </Card>
          <Card className="p-3">
            <span className="text-[11px] font-medium uppercase tracking-wider text-text-muted">Cycle Live</span>
            <div className="text-lg font-semibold mt-1 tabular-nums text-emerald-500">
              +{lastAdded} <span className="text-xs font-normal text-text-muted">imported</span>
            </div>
          </Card>
          <Card className="p-3">
            <span className="text-[11px] font-medium uppercase tracking-wider text-text-muted">Total in Pool</span>
            <div className="text-lg font-semibold mt-1 tabular-nums text-text-main">
              {activeHarvested} <span className="text-xs font-normal text-text-muted">/ {harvestedPools.length}</span>
            </div>
          </Card>
        </div>

        {/* Harvested Proxies Table */}
        <Card className="overflow-hidden">
          <div className="border-b border-border p-3 sm:px-4 sm:py-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                Harvested Proxies
              </span>
              <Badge variant="default" className="font-mono text-[10px]">
                {harvestedPools.length}
              </Badge>
            </div>
            {harvestedPools.length > 0 && (
              <span className="text-xs text-text-muted">
                {activeHarvested} verified working
              </span>
            )}
          </div>

          {harvestedPools.length === 0 ? (
            <div className="p-8 text-center text-xs text-text-muted">
              No proxies harvested yet. Click <span className="font-semibold text-text-main">Start</span> to run a discovery cycle.
            </div>
          ) : (
            <div className="divide-y divide-border/50 max-h-80 overflow-y-auto font-mono text-xs">
              {harvestedPools.map((p) => {
                const locMatch = p.name?.match(/-\[([A-Z]{2})\]$/);
                const loc = locMatch ? locMatch[1] : (p.loc || "—");
                const isWorking = p.testStatus === "working";
                return (
                  <div key={p.id} className="flex items-center justify-between px-3 py-2.5 sm:px-4 hover:bg-surface-2/40 transition-colors">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={cn(
                        "size-2 rounded-full shrink-0",
                        isWorking ? "bg-emerald-500" : "bg-red-500"
                      )} />
                      <span className="text-text-main font-medium truncate">{p.proxyUrl}</span>
                    </div>

                    <div className="flex items-center gap-3 shrink-0 text-text-muted">
                      <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px] font-semibold text-text-main">
                        {loc}
                      </span>
                      <span className="text-[11px] capitalize">
                        {p.testStatus || "unknown"}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        {/* Cycle History Card */}
        {status?.history?.length > 0 && (
          <Card className="p-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-3">
              Recent Harvest Runs
            </div>
            <div className="divide-y divide-border/40 font-mono text-xs">
              {status.history.map((h, i) => (
                <div key={i} className="flex items-center justify-between py-2">
                  <span className="text-text-muted tabular-nums">{formatTime(h.at)}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-emerald-500 font-medium tabular-nums">+{h.added} live</span>
                    <span className="text-text-muted">/</span>
                    <span className="text-text-muted tabular-nums">{h.tested} tested</span>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>

      {/* Proxy Feeds Modal */}
      <Modal
        isOpen={showFeedsModal}
        onClose={() => setShowFeedsModal(false)}
        title="Custom Proxy Feeds"
        size="md"
        footer={
          <Button onClick={() => setShowFeedsModal(false)}>
            Done
          </Button>
        }
      >
        <div className="flex flex-col gap-3 text-xs">
          <div>
            <p className="text-sm font-semibold text-text-main">Custom Feed URLs</p>
            <p className="text-text-muted mt-1 leading-relaxed">
              Add your own raw HTTP or HTTPS proxy list URLs (one URL per line). The harvester will fetch candidates from them alongside the global feed pool.
            </p>
            <textarea
              value={customFeedsText}
              onChange={(e) => setCustomFeedsText(e.target.value)}
              placeholder="https://example.com/proxies.txt&#10;https://raw.githubusercontent.com/user/repo/main/http.txt"
              rows={6}
              className="mt-3 w-full rounded-lg border border-border bg-surface-2 p-3 font-mono text-xs text-text-main focus:border-primary focus:outline-none resize-none"
            />
          </div>
        </div>
      </Modal>
    </PageShell>
  );
}
