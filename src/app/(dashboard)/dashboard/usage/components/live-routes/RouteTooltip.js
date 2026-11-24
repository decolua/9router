"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { maskEmail } from "@/shared/utils/liveRoutes";

const STATUS_CLASS = { ok: "text-success", running: "text-warning", error: "text-danger", aborted: "text-text-muted" };
const OFFSET = 12;
const MARGIN = 8;

function ms(value) {
  if (value == null) return "—";
  return value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${Math.round(value)}ms`;
}

function count(value) {
  return value == null ? "—" : Number(value).toLocaleString();
}

function Row({ label, value }) {
  return (
    <>
      <span>{label}</span>
      <strong className="truncate text-right font-medium text-text-main" data-i18n-skip>{value}</strong>
    </>
  );
}

// One request on hover. Kept inside the viewport: flips left/up near the edges.
export default function RouteTooltip({ record, x = 0, y = 0, reveal = false }) {
  const ref = useRef(null);
  const [position, setPosition] = useState({ left: x + OFFSET, top: y + OFFSET });

  useLayoutEffect(() => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    const left = x + OFFSET + box.width + MARGIN > window.innerWidth ? x - OFFSET - box.width : x + OFFSET;
    const top = y + OFFSET + box.height + MARGIN > window.innerHeight ? y - OFFSET - box.height : y + OFFSET;
    setPosition({ left: Math.max(MARGIN, left), top: Math.max(MARGIN, top) });
  }, [x, y, record]);

  if (!record) return null;
  const client = [record.client?.name, record.client?.version].filter(Boolean).join(" ") || "Unknown client";
  const account = record.connectionId ? maskEmail(record.accountLabel || record.connectionId, reveal) : "Unassigned";

  return (
    <div
      ref={ref}
      role="tooltip"
      className="pointer-events-none fixed z-50 w-72 rounded-xl border border-border bg-surface p-3 text-xs shadow-xl"
      style={position}
    >
      <div className="mb-2 flex items-center justify-between gap-2 font-semibold text-text-main">
        <span className="truncate" data-i18n-skip>{record.model || record.requestedModel || "Unknown model"}</span>
        <span className={STATUS_CLASS[record.status] || "text-text-muted"}>{record.status}</span>
      </div>
      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-text-muted">
        <Row label="Account" value={account} />
        <Row label="Client" value={client} />
        <Row label="Session" value={record.sessionId || "—"} />
        <Row label="API key" value={record.keyName || "—"} />
        <Row label="Latency" value={record.status === "running" ? "…" : ms(record.latencyMs)} />
        <Row label="First token" value={ms(record.ttftMs)} />
        <Row label="Tokens in / out" value={`${count(record.inputTokens)} / ${count(record.outputTokens)}`} />
        {record.fallbacks > 0 && <Row label="Fallbacks" value={record.fallbacks} />}
      </div>
    </div>
  );
}
