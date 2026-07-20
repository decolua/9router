"use client";

import { useMemo, useState } from "react";
import {
  formatResetTime,
  getDayBarValue,
  getRemainingPercentage,
} from "./utils";

const PAGE_SIZE = 10;

function formatResetTimeDisplay(resetTime) {
  if (!resetTime) return null;
  try {
    const date = new Date(resetTime);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    let dayStr = "";
    if (date >= today && date < tomorrow) dayStr = "Today";
    else if (date >= tomorrow && date < new Date(tomorrow.getTime() + 86400000)) {
      dayStr = "Tomorrow";
    } else {
      dayStr = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    }
    const timeStr = date.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
    return `${dayStr}, ${timeStr}`;
  } catch {
    return null;
  }
}

function getColorClasses(remainingPercentage) {
  if (remainingPercentage > 70) {
    return {
      text: "text-green-600 dark:text-green-400",
      bg: "bg-green-500",
      emoji: "🟢",
    };
  }
  if (remainingPercentage >= 30) {
    return {
      text: "text-yellow-600 dark:text-yellow-400",
      bg: "bg-yellow-500",
      emoji: "🟡",
    };
  }
  return {
    text: "text-red-600 dark:text-red-400",
    bg: "bg-red-500",
    emoji: "🔴",
  };
}

function sortQuotas(quotas, sortMode) {
  if (sortMode === "remaining-asc") {
    return [...quotas].sort(
      (a, b) => a.remaining - b.remaining || a.name.localeCompare(b.name),
    );
  }
  if (sortMode === "remaining-desc") {
    return [...quotas].sort(
      (a, b) => b.remaining - a.remaining || a.name.localeCompare(b.name),
    );
  }
  return quotas;
}

/** Real last-N-hour usage bars (tokens per hour), scaled by global max. */
function DayBars({ bars, usageMax = 1 }) {
  if (!bars?.length) return null;
  const max = Math.max(1, Number(usageMax) || 1);
  const graphHeight = 36;
  return (
    <div
      className="quota-daybars-bg-9r"
      aria-hidden="true"
      title={`Actual token usage · last ${bars.length} hourly slots`}
    >
      {bars.map((bar, index) => {
        const val = getDayBarValue(bar);
        const ratio = Math.max(0, Math.min(1, val / max));
        const height =
          val <= 0 ? 1 : Math.max(3, Math.round(3 + Math.sqrt(ratio) * (graphHeight - 3)));
        return (
          <i
            key={index}
            className={val > 0 ? "on" : "off"}
            style={{ height: `${height}px`, ["--h"]: `${height}px` }}
            title={`${bar.label || ""} · ${val ? val.toLocaleString() : "0"} tokens`}
          />
        );
      })}
    </div>
  );
}

export default function QuotaTable({
  quotas = [],
  compact = false,
  sortMode = "default",
  showSortLabel = false,
  onHideQuota = null,
  dayBars = null,
  usageMax = 1,
}) {
  const [page, setPage] = useState(1);

  const normalizedQuotas = useMemo(
    () =>
      quotas.map((quota, index) => ({
        ...quota,
        index,
        remaining: getRemainingPercentage(quota),
      })),
    [quotas],
  );

  const sortedQuotas = useMemo(
    () => sortQuotas(normalizedQuotas, sortMode),
    [normalizedQuotas, sortMode],
  );

  const totalPages = Math.max(1, Math.ceil(sortedQuotas.length / PAGE_SIZE));

  if (!quotas || quotas.length === 0) return null;

  const currentPage = Math.min(page, totalPages);
  const currentPageRows = sortedQuotas.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );
  const pageStart = sortedQuotas.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const pageEnd = Math.min(currentPage * PAGE_SIZE, sortedQuotas.length);
  const hasHideAction = typeof onHideQuota === "function";
  const rowPad = compact ? "px-2 py-1.5" : "px-2.5 py-2";
  const nameText = compact ? "text-[11px]" : "text-xs";
  const metaText = compact ? "text-[10px]" : "text-[11px]";

  return (
    <div className="min-w-0 space-y-1.5">
      {showSortLabel && (
        <div className="flex justify-end">
          <div className="rounded-md border border-black/10 bg-black/[0.02] px-2 py-0.5 text-[10px] text-text-muted dark:border-white/10 dark:bg-white/[0.03]">
            Sorted by account remaining
          </div>
        </div>
      )}

      <div className="relative min-w-0 overflow-hidden rounded-md">
        <DayBars bars={dayBars} usageMax={usageMax} />

        <div className="relative z-[1] min-w-0 space-y-1.5">
          {currentPageRows.map((quota) => {
            const colors = getColorClasses(quota.remaining);
            const countdown = formatResetTime(quota.resetAt);
            const resetDisplay = formatResetTimeDisplay(quota.resetAt);
            const recurring = quota.recurring !== false;
            const countdownLabel =
              countdown !== "-"
                ? recurring
                  ? `in ${countdown}`
                  : `expires in ${countdown}`
                : resetDisplay || "—";
            const usedLabel = `${Number(quota.used || 0).toLocaleString()} / ${
              quota.total > 0 ? Number(quota.total).toLocaleString() : "∞"
            }`;
            const remainingWidth = Math.max(0, Math.min(Number(quota.remaining) || 0, 100));

            return (
              <div
                key={`${quota.name}-${quota.index}`}
                className={`relative min-w-0 overflow-hidden rounded-md border border-black/5 dark:border-white/5 ${rowPad}`}
              >
                <div className="quota-remain-track-9r pointer-events-none" aria-hidden="true">
                  <div
                    className={`quota-remain-fill-9r ${colors.bg}`}
                    style={{ width: `${remainingWidth}%` }}
                    title={`${remainingWidth}% remaining`}
                  />
                </div>

                <div className="relative z-[1] flex min-w-0 items-center gap-1.5 pb-1">
                  <span className="shrink-0 text-[10px] leading-none">{colors.emoji}</span>
                  <span
                    className={`${nameText} min-w-0 flex-1 truncate font-medium text-text-primary`}
                    title={quota.name}
                  >
                    {quota.name}
                  </span>
                  <span
                    className={`${metaText} shrink-0 tabular-nums text-text-muted`}
                    title={usedLabel}
                  >
                    {usedLabel}
                  </span>
                  <span
                    className={`${metaText} shrink-0 text-right font-semibold tabular-nums ${colors.text}`}
                  >
                    {quota.remaining}%
                  </span>
                  <span
                    className={`${metaText} max-w-[4.5rem] shrink-0 truncate text-right font-medium text-text-primary`}
                    title={resetDisplay || countdownLabel}
                  >
                    {countdownLabel}
                  </span>
                  {hasHideAction && (
                    <button
                      type="button"
                      onClick={() => onHideQuota(quota)}
                      className="quota-eye-9r inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-text-muted transition-colors hover:bg-black/5 hover:text-text-primary dark:hover:bg-white/5"
                      title="Hide this quota row"
                      aria-label={`Hide quota ${quota.name}`}
                    >
                      <span className="material-symbols-outlined text-[11px] leading-none">
                        visibility_off
                      </span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {totalPages > 1 && (
        <div className="rounded-md border border-black/10 bg-black/[0.02] px-2 py-1 dark:border-white/10 dark:bg-white/[0.03]">
          <div className="flex items-center justify-between gap-2 text-[10px] text-text-muted">
            <span>
              Showing {pageStart}-{pageEnd} of {sortedQuotas.length}
            </span>
            <span>
              Page {currentPage} / {totalPages}
            </span>
          </div>
          <div className="mt-1 flex items-center justify-end gap-1">
            <button
              type="button"
              onClick={() => setPage(Math.max(1, currentPage - 1))}
              disabled={currentPage === 1}
              className="flex h-6 items-center rounded-md border border-black/10 px-2 text-[10px] text-text-primary transition-colors hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10 dark:hover:bg-white/5"
            >
              Prev
            </button>
            <button
              type="button"
              onClick={() => setPage(Math.min(totalPages, currentPage + 1))}
              disabled={currentPage === totalPages}
              className="flex h-6 items-center rounded-md border border-black/10 px-2 text-[10px] text-text-primary transition-colors hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10 dark:hover:bg-white/5"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
