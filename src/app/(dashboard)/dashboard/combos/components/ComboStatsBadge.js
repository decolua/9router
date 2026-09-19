"use client";

/**
 * CB4 — the compact success chip on a combo card + its in-line breakdown.
 *
 * Deliberately presentational and self-contained (react only): every value it
 * prints comes from comboStats.js (chipLabel / chipTone / sortMembersByFailure
 * / memberRowView), which the model tests cover. It never fetches and never
 * recomputes — the page-level useComboStats feeds it one matched `entry`, so
 * N cards share a single endpoint read. Clicking toggles an IN-LINE expansion
 * (a conditional div, not a route) so no new page is created.
 *
 * Discretion + fail-open: a null rate is "—" in neutral grey; a fetch gap hands
 * in `entry = null`, which renders "—" quietly — no toast, no red error.
 */
import { useState } from "react";
import PropTypes from "prop-types";
import {
  chipLabel,
  chipTone,
  coverageBadgeLabel,
  sortMembersByFailure,
  memberRowView,
} from "./comboStats.js";

export default function ComboStatsBadge({ entry = null, coverage = null, range = "24h" }) {
  const [expanded, setExpanded] = useState(false);

  const partial = coverageBadgeLabel({ coverage }) === "parcial";
  const tone = chipTone(entry ? entry.successRate : null);
  const label = chipLabel(entry);
  const members = sortMembersByFailure(entry ? entry.members : []).map((m) => memberRowView(m));

  return (
    <div className="min-w-0">
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          title={`Combo success rate · last ${range}${partial ? " · parcial (unattributed pre-feature history present)" : ""}`}
          className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-medium transition-colors ${tone}`}
        >
          <span className="material-symbols-outlined text-[13px]">percent</span>
          <span>{label}</span>
          <span className={`material-symbols-outlined text-[12px] transition-transform ${expanded ? "rotate-180" : ""}`}>
            expand_more
          </span>
        </button>
        {partial && (
          <span
            className="inline-flex items-center rounded bg-amber-500/10 px-1.5 py-px text-[10px] text-amber-600 dark:text-amber-400"
            title="Some winning requests in this window predate combo attribution — the rate covers attributed traffic only and may be understated."
          >
            parcial
          </span>
        )}
      </div>

      {expanded && (
        <div className="mt-2 rounded-lg border border-border bg-bg-subtle/40 px-3 py-2">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
              By member · last {range}
            </span>
            <span className="text-[10px] text-text-muted">problematic first</span>
          </div>
          {members.length === 0 ? (
            <p className="py-1 text-[11px] text-text-muted">
              {entry ? "No attributed attempts recorded in this window." : "No data."}
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {members.map((m, i) => (
                <li key={`${m.member || "member"}-${m.model || i}`} className="flex items-start justify-between gap-2 text-[11px]">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span
                      className="size-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ backgroundColor: m.breakerColor }}
                      title={m.breakerLabel}
                    />
                    <span className="min-w-0">
                      <span className="block truncate font-mono text-text-main">{m.label}</span>
                      <span className="block truncate font-mono text-[10px] text-text-muted">{m.errorText}</span>
                    </span>
                  </span>
                  <span className="shrink-0 text-right text-text-muted">
                    <span className="block font-medium text-text-main">
                      {m.failPct} <span className="text-text-muted">({m.failRatio} fail)</span>
                    </span>
                    <span className="block text-[10px]">{m.attempts ?? "—"} attempts</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

ComboStatsBadge.propTypes = {
  entry: PropTypes.object,
  coverage: PropTypes.oneOf(["full", "partial", null]),
  range: PropTypes.string,
};
