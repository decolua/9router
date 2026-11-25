"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { UNASSIGNED, accountKeyOf, assignTimelineLanes, barGeometry, chooseTimelineStep, maskEmail, shortId, timelineRecords } from "@/shared/utils/liveRoutes";
import { modelColor } from "./modelPalette";
import RouteTooltip from "./RouteTooltip";

function timeLabel(timestamp) {
  return new Date(timestamp).toLocaleTimeString([], {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function sparkline(records, start, windowMs, now) {
  const buckets = Array.from({ length: 12 }, () => 0);
  for (const record of records) {
    const index = Math.min(11, Math.max(0, Math.floor(((record.startedAt - start) / windowMs) * 12)));
    buckets[index] += 1;
  }
  const max = Math.max(1, ...buckets);
  return buckets.map((value, index) => (
    <span key={`${index}-${value}`} className="w-1 rounded-sm bg-primary/70" style={{ height: `${Math.max(2, (value / max) * 15)}px` }} />
  ));
}

function groupRecords(records) {
  const providers = new Map();
  for (const record of records) {
    const key = record.connectionId ? record.providerName || record.provider || "Live" : "Not routed";
    const account = accountKeyOf(record);
    if (!providers.has(key)) providers.set(key, new Map());
    const accounts = providers.get(key);
    if (!accounts.has(account)) accounts.set(account, []);
    accounts.get(account).push(record);
  }
  return [...providers.entries()].map(([provider, accounts]) => ({
    provider,
    rows: [...accounts.entries()].map(([account, accountRecords]) => ({ account, records: accountRecords })),
  }));
}

export default function RouteTimeline({ records, windowMs, reveal, filter, paused = false, onFilter }) {
  const router = useRouter();
  const scrollRef = useRef(null);
  const [hover, setHover] = useState(null);
  const [pointer, setPointer] = useState({ x: 0, y: 0 });
  const [follow, setFollow] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const frozenNow = useRef(now);

  useEffect(() => {
    if (paused) return undefined;
    let frame;
    const tick = timestamp => {
      if (document.visibilityState !== "hidden") {
        frozenNow.current = Date.now();
        setNow(frozenNow.current);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [paused]);

  const start = now - windowMs;
  // Bars move with time: anything still overlapping the window stays, and slides out on the left.
  const visibleRecords = timelineRecords(records, start, now);
  const groups = groupRecords(visibleRecords);
  const models = useMemo(() => [...new Set(records.map(record => record.model).filter(Boolean))], [records]);
  const step = chooseTimelineStep(windowMs);
  const ticks = useMemo(() => {
    const values = [];
    const first = Math.ceil(start / step) * step;
    for (let timestamp = first; timestamp <= now; timestamp += step) values.push(timestamp);
    return values;
  }, [now, start, step]);
  const tickLeft = timestamp => `${((timestamp - start) / windowMs) * 100}%`;
  // Grid lines sit on the tick timestamps, so they scroll together with the bars and labels.
  const gridLines = ticks.map(timestamp => (
    <span key={timestamp} aria-hidden="true" className="absolute inset-y-0 border-l border-border-subtle" style={{ left: tickLeft(timestamp) }} />
  ));
  const hoverRecord = hover?.record || null;
  const handleBarClick = record => router.push(`/dashboard/usage?tab=details&requestId=${encodeURIComponent(record.id)}`);

  return (
    <div className="overflow-x-auto rounded-xl border border-border-subtle bg-surface" ref={scrollRef} onScroll={() => setFollow(false)}>
      <div className="min-w-[900px]">
        <div className="grid grid-cols-[220px_minmax(680px,1fr)] border-b border-border-subtle bg-surface-2/30 text-[10px] font-semibold uppercase tracking-[0.1em] text-text-muted max-lg:grid-cols-[140px_minmax(680px,1fr)]">
          <div className="p-3">Activity</div>
          <div className="relative min-h-[42px] overflow-hidden p-3">
            {gridLines}
            {ticks.map(timestamp => <span key={timestamp} className="absolute bottom-1 -translate-x-1/2 font-mono text-[9px] normal-case tracking-normal text-text-muted" style={{ left: tickLeft(timestamp) }}>{timeLabel(timestamp)}</span>)}
            <span className="absolute right-2 top-2 normal-case tracking-normal text-primary">Follow · now</span>
            <span className="absolute bottom-0 right-0 top-0 border-l border-primary" />
          </div>
        </div>
        {groups.length ? groups.map(group => (
          <section key={group.provider}>
            <div className="border-b border-border-subtle px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">{group.provider}</div>
            {group.rows.map(({ account, records: accountRecords }) => {
              const lanes = assignTimelineLanes(accountRecords, now);
              const rowHeight = Math.max(44, 20 + Math.max(1, ...lanes.map(item => item.lane + 1)) * 18);
              const dimAccount = filter && !(filter.kind === "account" && filter.id === account);
              return (
                <div key={account} className={`grid grid-cols-[220px_minmax(680px,1fr)] border-b border-border-subtle last:border-0 max-lg:grid-cols-[140px_minmax(680px,1fr)] ${dimAccount ? "opacity-40" : ""}`} style={{ minHeight: rowHeight }}>
                  <button type="button" className="flex min-w-0 flex-col justify-center gap-1 border-r border-border-subtle p-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary hover:bg-surface-2/40" onClick={() => onFilter?.({ kind: "account", id: account })}>
                    <span className="truncate text-xs font-semibold text-text-main">{account === UNASSIGNED ? "Unassigned" : maskEmail(accountRecords[0].accountLabel || account, reveal)}</span>
                    <span className="truncate font-mono text-[10px] text-text-muted">{account === UNASSIGNED ? "—" : shortId(account)}</span>
                    <span className="flex h-4 items-end gap-0.5">{sparkline(accountRecords, start, windowMs, now)}</span>
                  </button>
                  <div className="relative overflow-hidden" onMouseMove={event => hover && setPointer({ x: event.clientX, y: event.clientY })}>
                    {gridLines}
                    <span className="absolute bottom-0 right-0 top-0 border-l border-primary/80" />
                    {lanes.map(({ record, lane }) => {
                      const { left, width } = barGeometry(record, start, now, windowMs);
                      const color = modelColor(record.model, models);
                      const dim = filter && !(filter.kind === "account" && filter.id === account) && !(filter.kind === "model" && filter.id === record.model);
                      return (
                        <button
                          key={record.id}
                          type="button"
                          aria-label={`${record.model || "request"} ${record.status}`}
                          className={`absolute h-2 rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${record.status === "running" ? "route-timeline-running" : ""} ${dim ? "opacity-20" : ""}`}
                          style={{ left: `${left}%`, width: `${width}%`, top: `${12 + lane * 18}px`, backgroundColor: color, backgroundImage: record.status === "running" ? "repeating-linear-gradient(135deg, transparent 0 5px, color-mix(in srgb, var(--color-surface) 45%, transparent) 5px 8px)" : undefined, "--route-model": color }}
                          onMouseEnter={event => { setHover({ record }); setPointer({ x: event.clientX, y: event.clientY }); }}
                          onMouseLeave={() => setHover(null)}
                          onClick={() => handleBarClick(record)}
                        >
                          <span className={`absolute -right-1 top-1/2 size-1.5 -translate-y-1/2 rounded-full ${record.status === "ok" ? "bg-success" : record.status === "error" ? "bg-danger" : "bg-text-muted"}`} />
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </section>
        )) : <div className="p-10 text-center text-sm text-text-muted">No live requests in this window.</div>}
      </div>
      <div className="flex items-center justify-between border-t border-border-subtle px-3 py-2 text-[10px] text-text-muted">
        <span>Local time</span>
        <button type="button" className="focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" onClick={() => { setFollow(true); if (scrollRef.current) scrollRef.current.scrollLeft = scrollRef.current.scrollWidth; }}>{follow ? "Follow · now" : "Follow now"}</button>
      </div>
      {hoverRecord && <RouteTooltip record={hoverRecord} x={pointer.x} y={pointer.y} reveal={reveal} now={now} />}
      <style jsx>{`
        .route-timeline-running { animation: route-scan calc(var(--route-speed, 1.8s) * .7) linear infinite; }
        @keyframes route-scan { to { background-position: 16px 0; } }
        @media (prefers-reduced-motion: reduce) { .route-timeline-running { animation: none; } }
      `}</style>
    </div>
  );
}
