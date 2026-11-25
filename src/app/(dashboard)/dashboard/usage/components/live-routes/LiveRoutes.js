"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, Card, SegmentedControl } from "@/shared/components";
import { LIVE_WINDOWS, summarizeLiveRoutes } from "@/shared/utils/liveRoutes";
import useLiveRoutes from "./useLiveRoutes";
import LiveStats from "./LiveStats";
import RouteMap from "./RouteMap";
import RouteTimeline from "./RouteTimeline";

const SPEEDS = ["0.5x", "1x", "2x"];
const WINDOWS = Object.keys(LIVE_WINDOWS);

export default function LiveRoutes() {
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState("1x");
  const [window, setWindow] = useState("30s");
  const [reveal, setReveal] = useState(false);
  const [filter, setFilter] = useState(null);
  const { records, accounts, status } = useLiveRoutes({ paused });
  const accountMap = useMemo(
    () => Object.fromEntries(accounts.map(account => [account.id, account])),
    [accounts],
  );
  const enriched = useMemo(() => records.map(record => ({
    ...record,
    accountLabel: accountMap[record.connectionId]?.label || record.connectionId,
    providerName: accountMap[record.connectionId]?.providerName || record.providerName,
  })), [records, accountMap]);
  // Re-evaluate the window every second, not only when events arrive, so finished
  // requests leave the stats and long ones keep counting while no new events come in.
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    if (paused) return undefined;
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [paused]);
  const summary = useMemo(
    () => summarizeLiveRoutes(enriched, { window, filter, now: clock }),
    [enriched, window, filter, clock],
  );
  const statusLabel = status === "connected" ? "Connected · Live" : status === "paused" ? "Paused" : "Reconnecting…";
  const statusColor = status === "connected" ? "bg-success" : status === "paused" ? "bg-text-muted" : "bg-warning";
  const animationSpeed = speed === "0.5x" ? "3.6s" : speed === "2x" ? "0.9s" : "1.8s";

  return (
    <section className="flex min-w-0 flex-col gap-3" aria-label="Live Routes" style={{ "--route-speed": animationSpeed }}>
      <Card padding="sm" className="overflow-hidden border-border-subtle bg-surface/90">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-bold tracking-tight text-text-main">Live Routes</h2>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border-subtle bg-surface-2 px-2.5 py-1 text-[11px] font-semibold text-text-muted">
              <i className={`size-1.5 rounded-full ${statusColor}`} />
              {statusLabel}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" size="xs" icon={paused ? "play_arrow" : "pause"} onClick={() => setPaused(value => !value)}>
              {paused ? "Resume" : "Pause"}
            </Button>
            <div title="Animation speed">
              <SegmentedControl size="sm" options={SPEEDS.map(value => ({ value, label: value }))} value={speed} onChange={setSpeed} />
            </div>
            <SegmentedControl size="sm" options={WINDOWS.map(value => ({ value, label: value }))} value={window} onChange={setWindow} />
            <Button variant="ghost" size="xs" icon={reveal ? "visibility_off" : "visibility"} aria-label={reveal ? "Mask account emails" : "Show account emails"} onClick={() => setReveal(value => !value)} />
          </div>
        </div>
      </Card>
      <LiveStats summary={summary} />
      <Card padding="sm" className="overflow-hidden border-border-subtle bg-surface/90">
        {filter && (
          <button type="button" className="mb-3 flex w-fit items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-xs text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" onClick={() => setFilter(null)}>
            <span>Filtered:</span> {filter.id} <span aria-hidden="true">×</span>
          </button>
        )}
        <RouteMap summary={summary} reveal={reveal} filter={filter} onFilter={setFilter} />
        <div className="my-3 border-t border-border-subtle" />
        <RouteTimeline records={enriched} windowMs={LIVE_WINDOWS[window]} reveal={reveal} filter={filter} paused={paused} onFilter={setFilter} />
      </Card>
    </section>
  );
}
