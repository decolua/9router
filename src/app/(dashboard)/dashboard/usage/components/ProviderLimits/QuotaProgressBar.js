"use client";

import { cn } from "@/shared/utils/cn";
import { formatResetTime } from "./utils";

// Calculate color based on remaining percentage
const getColorClasses = (remainingPercentage) => {
  if (remainingPercentage > 70) {
    return {
      text: "text-green-500",
      bg: "bg-green-500",
      bgLight: "bg-green-500/10",
      emoji: "🟢"
    };
  }

  if (remainingPercentage >= 30) {
    return {
      text: "text-yellow-500",
      bg: "bg-yellow-500",
      bgLight: "bg-yellow-500/10",
      emoji: "🟡"
    };
  }

  // 0-29% including 0% (out of quota) - show red
  return {
    text: "text-red-500",
    bg: "bg-red-500",
    bgLight: "bg-red-500/10",
    emoji: "🔴"
  };
};

// Format reset time display
const formatResetTimeDisplay = (resetTime) => {
  if (!resetTime) return null;
  
  try {
    const resetDate = new Date(resetTime);
    const now = new Date();
    const isToday = resetDate.toDateString() === now.toDateString();
    const isTomorrow = resetDate.toDateString() === new Date(now.getTime() + 86400000).toDateString();
    
    const timeStr = resetDate.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
    
    if (isToday) return `Today, ${timeStr}`;
    if (isTomorrow) return `Tomorrow, ${timeStr}`;
    
    return resetDate.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return null;
  }
};

export default function QuotaProgressBar({
  percentage = 0,
  label = "",
  used = 0,
  total = 0,
  unlimited = false,
  resetTime = null,
  recurring = true,
}) {
  const colors = getColorClasses(percentage);
  const countdown = formatResetTime(resetTime);
  const resetDisplay = formatResetTimeDisplay(resetTime);

  // recurring defaults true. One-shot packs (e.g. CodeBuddy CN bonus packs)
  // set recurring:false: resetTime is a hard expiry, so word it as "expires".
  const resetWord = recurring ? "Reset" : "Expires";

  // percentage is already remaining percentage (from ProviderLimitCard)
  const remaining = percentage;

  return (
    <div className="rounded-[12px] border border-border-subtle bg-bg/40 p-3 transition-colors hover:border-brand-500/20">
      {/* Label and percentage */}
      <div className="flex items-center justify-between gap-3">
        <span className="truncate text-sm font-semibold tracking-tight text-text-main">
          {label}
        </span>
        <span
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums",
            colors.bgLight,
            colors.text
          )}
        >
          {remaining}%
        </span>
      </div>

      {/* Progress bar */}
      {!unlimited && (
        <div
          className={cn(
            "mt-2 h-1.5 overflow-hidden rounded-full",
            colors.bgLight
          )}
        >
          <div
            className={cn("h-full rounded-full transition-all duration-500", colors.bg)}
            style={{ width: `${Math.min(remaining, 100)}%` }}
          />
        </div>
      )}

      {/* Usage details and countdown */}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-text-muted">
        <span className="tabular-nums">
          {used.toLocaleString()} / {total.toLocaleString()} requests
        </span>
        {countdown !== "-" && (
          <span className="font-medium text-text-main">
            {resetWord} in {countdown}
          </span>
        )}
      </div>

      {/* Reset time display */}
      {resetDisplay && (
        <div className="mt-1 text-[11px] text-text-muted/70">
          {resetWord} at {resetDisplay}
        </div>
      )}
    </div>
  );
}
