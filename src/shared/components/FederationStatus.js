"use client";

import { useEffect, useState } from "react";
import Badge from "./Badge";
import { federationStatusView } from "@/lib/federation/statusView";
import { translate } from "@/i18n/runtime";

// Poll interval for the local federation status (ms). Kept modest — the
// endpoint is a local SQLite read; the banner should feel live across
// LINKED → DEGRADED → RECOVERING transitions without hammering the server.
const POLL_INTERVAL_MS = 5000;

// FederationStatus banner (FED-005, spec §3.5 UX).
//
// Polls the token-less local status endpoint (/api/federation/local-status)
// and renders a badge for the edge's failover state:
//   - LINKED (green) / DEGRADED (red) / RECOVERING (blue)
//   - "behind N revisions" when the local replica lags the central watermark
// Standalone and central instances render NOTHING (zero drift — the banner
// is an edge-only UX). Unknown/error responses hide quietly and retry on the
// next poll. The token never reaches browser JS: this component only ever
// calls the unguarded local-status route.
export default function FederationStatus() {
  const [view, setView] = useState(null);

  useEffect(() => {
    let cancelled = false;
    let timer = null;

    const poll = async () => {
      try {
        const res = await fetch("/api/federation/local-status", { cache: "no-store" });
        if (!res.ok) {
          // Unknown/error → hide quietly, retry next poll.
          if (!cancelled) setView(null);
          return;
        }
        const payload = await res.json();
        if (!cancelled) setView(federationStatusView(payload));
      } catch {
        // Network error → hide quietly, retry next poll.
        if (!cancelled) setView(null);
      }
    };

    poll();
    timer = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, []);

  if (!view) return null;

  return (
    <div className="flex items-center gap-2 shrink-0" title={view.lagText || view.label}>
      <Badge variant={view.variant} size="sm" dot icon={view.icon}>
        {translate(view.label)}
      </Badge>
      {view.lagText ? (
        <span className="hidden sm:inline text-xs text-text-muted whitespace-nowrap">
          {translate(view.lagText)}
        </span>
      ) : null}
    </div>
  );
}
