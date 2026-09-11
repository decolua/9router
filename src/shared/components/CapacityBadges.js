"use client";

import { CAPACITY_META } from "@/shared/constants/models";
import Tooltip from "./Tooltip";

// Render small icon badges for a model's capabilities (only those set true).
// colorOverride: force a single color class for all badges (default: per-cap color).
// size: icon font-size in px (default 16).
// showContext: also render the context window chip (e.g. "1M"). Shown only
// when a non-default value is known — the 200K floor is a guess, not data,
// so it stays hidden rather than printed as fact.
function kisalt(n) {
  if (!n || n <= 0) return "";
  if (n >= 1000000) return `${parseFloat((n / 1000000).toFixed(1))}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}K`;
  return String(n);
}

export default function CapacityBadges({ caps, className = "", colorOverride, size = 16, showContext = false }) {
  if (!caps) return null;
  const active = Object.keys(CAPACITY_META).filter((k) => caps[k]);
  const ctx = showContext && caps.contextWindow && caps.contextWindow !== 200000
    ? kisalt(caps.contextWindow)
    : "";
  if (active.length === 0 && !ctx) return null;

  return (
    <span className={`inline-flex items-center gap-0.5 ${className}`}>
      {active.map((k) => (
        <Tooltip key={k} text={`${CAPACITY_META[k].label} — ${CAPACITY_META[k].desc}`}>
          <span
            className={`material-symbols-outlined leading-none cursor-help ${colorOverride || CAPACITY_META[k].color}`}
            style={{ fontSize: `${size}px` }}
          >
            {CAPACITY_META[k].icon}
          </span>
        </Tooltip>
      ))}
      {ctx ? (
        <Tooltip key="ctx" text={`Bağlam penceresi: ${caps.contextWindow.toLocaleString("tr-TR")} token`}>
          <span className="rounded border border-border px-1 font-mono leading-none text-text-muted/80" style={{ fontSize: `${Math.max(9, size - 3)}px` }}>
            {ctx}
          </span>
        </Tooltip>
      ) : null}
    </span>
  );
}
