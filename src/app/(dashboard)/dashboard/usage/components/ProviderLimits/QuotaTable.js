"use client";

import { useEffect, useMemo, useState } from "react";
import { formatResetTime, getRemainingPercentage } from "./utils";

const PAGE_SIZE = 10;

/**
 * Format reset time display (Today, 12:00 PM)
 */
function formatResetTimeDisplay(resetTime) {
  if (!resetTime) return null;

  try {
    const date = new Date(resetTime);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    let dayStr = "";
    if (date >= today && date < tomorrow) {
      dayStr = "Today";
    } else if (date >= tomorrow && date < new Date(tomorrow.getTime() + 24 * 60 * 60 * 1000)) {
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

/**
 * Get color classes based on remaining percentage
 */
function getColorClasses(remainingPercentage) {
  if (remainingPercentage > 70) {
    return {
      text: "text-green-600 dark:text-green-400",
      bg: "bg-green-500",
      bgLight: "bg-green-500/10",
      emoji: "🟢",
    };
  }

  if (remainingPercentage >= 30) {
    return {
      text: "text-yellow-600 dark:text-yellow-400",
      bg: "bg-yellow-500",
      bgLight: "bg-yellow-500/10",
      emoji: "🟡",
    };
  }

  return {
    text: "text-red-600 dark:text-red-400",
    bg: "bg-red-500",
    bgLight: "bg-red-500/10",
    emoji: "🔴",
  };
}

function sortQuotas(quotas, sortMode) {
  if (sortMode === "remaining-asc") {
    return [...quotas].sort((a, b) => a.remaining - b.remaining || a.name.localeCompare(b.name));
  }

  if (sortMode === "remaining-desc") {
    return [...quotas].sort((a, b) => b.remaining - a.remaining || a.name.localeCompare(b.name));
  }

  return quotas;
}

/**
 * Quota Table Component - Table-based display for quota data
 */
export default function QuotaTable({
  quotas = [],
  compact = false,
  sortMode = "default",
  showSortLabel = false,
  onHideQuota = null,
}) {
  const [page, setPage] = useState(1);

  const normalizedQuotas = useMemo(
    () => quotas.map((quota, index) => ({
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

  useEffect(() => {
    setPage(1);
  }, [sortMode, quotas]);

  useEffect(() => {
    setPage((currentPage) => Math.min(currentPage, totalPages));
  }, [totalPages]);

  if (!quotas || quotas.length === 0) {
    return null;
  }

  const currentPageRows = sortedQuotas.slice(
    (page - 1) * PAGE_SIZE,
    page * PAGE_SIZE,
  );
  const pageStart = sortedQuotas.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const pageEnd = Math.min(page * PAGE_SIZE, sortedQuotas.length);

  const cellPad = compact ? "py-1 px-1.5" : "py-2.5 px-3";
  const nameText = compact ? "text-[11px]" : "text-sm";
  const resetPrimary = compact ? "text-[11px]" : "text-sm";
  const resetSecondary = compact ? "text-[10px] leading-tight" : "text-xs";
  const sortLabel = "Sorted by account remaining";
  const hasHideAction = typeof onHideQuota === "function";

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] text-text-muted">
          {sortedQuotas.length} quota{sortedQuotas.length > 1 ? "s" : ""}
        </div>
        {showSortLabel && (
          <div className="rounded-md border border-black/10 bg-black/[0.02] px-2 py-1 text-[10px] text-text-muted dark:border-white/10 dark:bg-white/[0.03]">
            {sortLabel}
          </div>
        )}
      </div>

      <div className="space-y-1.5">
        {currentPageRows.map((quota) => {
          const isUnlimited = quota.unlimited === true;
          const isCreditBalance = quota.isCreditBalance === true;
          const colors = isCreditBalance
            ? { text: "text-blue-600 dark:text-blue-400", bg: "bg-blue-500", bgLight: "bg-blue-500/10", emoji: "💰" }
            : getColorClasses(quota.remaining);
          const countdown = formatResetTime(quota.resetAt);
          const resetDisplay = formatResetTimeDisplay(quota.resetAt);
          // recurring defaults true: a missing flag means the quota
          // refreshes at resetAt. Bonus/one-shot packs set recurring:false
          // and their resetAt is a hard expiry, so word it as "expires".
          const recurring = quota.recurring !== false;
          const countdownLabel = recurring ? `in ${countdown}` : `expires in ${countdown}`;
          const resetWord = recurring ? "Reset" : "Expires";

          return (
            <div
              key={`${quota.name}-${quota.index}`}
              className={`rounded-lg border border-border-subtle bg-bg/50 px-3 py-2 transition-colors hover:border-brand-500/15 hover:bg-surface-2/30 ${cellPad}`}
            >
              <div className="flex flex-col gap-2">
                {/* Name row */}
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="text-[11px] shrink-0">{colors.emoji}</span>
                    <span className={`${nameText} font-medium text-text-main truncate`}>
                      {quota.name}
                    </span>
                  </div>
                  <span className={`shrink-0 text-xs font-semibold tabular-nums ${colors.text}`}>
                    {isUnlimited ? "Unlimited" : `${quota.remaining}%`}
                  </span>
                </div>

                {/* Progress bar */}
                {!isUnlimited && !isCreditBalance && (
                  <div className={`h-1.5 rounded-full overflow-hidden ${colors.bgLight}`}>
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${colors.bg}`}
                      style={{ width: `${Math.min(quota.remaining, 100)}%` }}
                    />
                  </div>
                )}

                {/* Meta: used/total + reset */}
                <div className="flex items-center justify-between gap-2">
                  <span
                    className="truncate text-[11px] text-text-muted"
                    title={
                      isUnlimited
                        ? `${quota.used.toLocaleString()} used · Unlimited`
                        : isCreditBalance
                        ? `Credit balance: ${quota.total.toFixed(2)} ${quota.currency || ""}`
                        : `${quota.used.toLocaleString()} / ${quota.total > 0 ? quota.total.toLocaleString() : "∞"}`
                    }
                  >
                    {isUnlimited
                      ? `${quota.used.toLocaleString()} used · Unlimited`
                      : isCreditBalance
                      ? `Credit: ${quota.total.toFixed(2)} ${quota.currency || ""}`
                      : `${quota.used.toLocaleString()} / ${quota.total > 0 ? quota.total.toLocaleString() : "∞"}`}
                  </span>
                  <div className="flex items-center gap-2">
                    {countdown !== "-" && (
                      <span className={`${resetPrimary} font-medium text-text-main`}>
                        {countdownLabel}
                      </span>
                    )}
                    {hasHideAction && (
                      <button
                        type="button"
                        onClick={() => onHideQuota(quota)}
                        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-text-muted transition-colors hover:bg-black/5 hover:text-text-primary dark:hover:bg-white/5"
                        title="Hide this quota row"
                        aria-label={`Hide quota ${quota.name}`}
                      >
                        <span className="material-symbols-outlined text-[13px]">
                          visibility_off
                        </span>
                      </button>
                    )}
                  </div>
                </div>

                {resetDisplay && (
                  <div className="text-[10px] text-text-muted/70">
                    {resetWord} at {resetDisplay}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {totalPages > 1 && (
        <div className="rounded-lg border border-border-subtle bg-bg/50 px-3 py-2 dark:border-white/10 dark:bg-white/[0.03]">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] text-text-muted">
              Showing {pageStart}-{pageEnd} of {sortedQuotas.length}
            </span>
            <span className="text-[10px] text-text-muted">
              Page {page} / {totalPages}
            </span>
          </div>
          <div className="mt-1.5 flex items-center justify-end gap-1">
            <button
              type="button"
              onClick={() => setPage((currentPage) => Math.max(1, currentPage - 1))}
              disabled={page === 1}
              className="flex h-6 items-center rounded-md border border-black/10 px-2 text-[10px] text-text-primary transition-colors hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10 dark:hover:bg-white/5"
            >
              Prev
            </button>
            <button
              type="button"
              onClick={() => setPage((currentPage) => Math.min(totalPages, currentPage + 1))}
              disabled={page === totalPages}
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
