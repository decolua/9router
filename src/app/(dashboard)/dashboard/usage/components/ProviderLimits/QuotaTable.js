"use client";

import { useEffect, useMemo, useState } from "react";
import { formatResetTime, calculatePercentage } from "./utils";
import { translate } from "@/i18n/runtime";

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
      dayStr = translate("Today");
    } else if (date >= tomorrow && date < new Date(tomorrow.getTime() + 24 * 60 * 60 * 1000)) {
      dayStr = translate("Tomorrow");
    } else {
      dayStr = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    }

    const timeStr = date.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true
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
      emoji: "🟢"
    };
  }

  if (remainingPercentage >= 30) {
    return {
      text: "text-yellow-600 dark:text-yellow-400",
      bg: "bg-yellow-500",
      bgLight: "bg-yellow-500/10",
      emoji: "🟡"
    };
  }

  return {
    text: "text-red-600 dark:text-red-400",
    bg: "bg-red-500",
    bgLight: "bg-red-500/10",
    emoji: "🔴"
  };
}

function getWarmupErrorMap(warmupState) {
  if (warmupState?.running) {
    return new Map();
  }

  const models = warmupState?.models || {};
  const errorMap = new Map();

  for (const [modelId, state] of Object.entries(models)) {
    if (state?.status === "error" && state?.lastError) {
      errorMap.set(modelId, state);
      if (state.modelName) {
        errorMap.set(state.modelName, state);
      }
    }
  }

  return errorMap;
}

/**
 * Format relative time (e.g., "5 minutes ago", "1 hour ago")
 */
function formatRelativeTime(dateString) {
  if (!dateString) return null;

  try {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffMinutes = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMinutes / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMinutes < 1) return translate("Just now");
    if (diffMinutes < 60) return `${diffMinutes}${translate("m ago")}`;
    if (diffHours < 24) return `${diffHours}${translate("h ago")}`;
    return `${diffDays}${translate("d ago")}`;
  } catch {
    return null;
  }
}

function getWarmupStatusDisplay(warmupState) {
  if (!warmupState) return null;

  const {
    skipped,
    skipReason,
    exhaustedQuotas,
    lastRunAt,
    models,
    running,
    currentModelName,
  } = warmupState;

  if (running) {
    return {
      type: "running",
      icon: "progress_activity",
      color: "text-blue-600 dark:text-blue-400",
      bgColor: "bg-blue-500/10",
      borderColor: "border-blue-500/20",
      message: translate("Refreshing"),
      details: currentModelName || "",
      lastRunAt,
      animate: true,
    };
  }

  if (skipped && typeof skipReason === "string" && skipReason.startsWith("quota_exhausted")) {
    return {
      type: "skipped",
      icon: "pause_circle",
      color: "text-yellow-600 dark:text-yellow-400",
      bgColor: "bg-yellow-500/10",
      borderColor: "border-yellow-500/20",
      message: translate("Quota exhausted"),
      details: exhaustedQuotas?.join(", ") || "",
    };
  }

  const errorModels = Object.values(models || {}).filter((m) => m.status === "error");
  if (errorModels.length > 0) {
    return {
      type: "error",
      icon: "error",
      color: "text-red-600 dark:text-red-400",
      bgColor: "bg-red-500/10",
      borderColor: "border-red-500/20",
      message: translate("Refresh failed"),
      details: "",
    };
  }

  const modelList = Object.values(models || {});
  if (modelList.length > 0 && modelList.every((m) => m.status === "success")) {
    return {
      type: "success",
      icon: "check_circle",
      color: "text-green-600 dark:text-green-400",
      bgColor: "bg-green-500/10",
      borderColor: "border-green-500/20",
      message: translate("Refresh successful"),
      details: "",
      lastRunAt,
      animate: false,
    };
  }

  return null;
}

export default function QuotaTable({ quotas = [], warmupState = null, showWarmupState = true }) {
  const [dismissedErrorKeys, setDismissedErrorKeys] = useState([]);

  const rawWarmupErrorMap = useMemo(
    () => (showWarmupState ? getWarmupErrorMap(warmupState) : new Map()),
    [showWarmupState, warmupState]
  );
  const warmupStatus = showWarmupState ? getWarmupStatusDisplay(warmupState) : null;

  const dedupedWarmupErrors = useMemo(() => {
    const uniqueStates = [];
    const seen = new Set();

    for (const state of rawWarmupErrorMap.values()) {
      const key = `${state.modelName || "unknown"}-${state.lastRunAt || "never"}-${state.lastError || ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      uniqueStates.push({ ...state, __errorKey: key });
    }

    return uniqueStates;
  }, [rawWarmupErrorMap]);

  useEffect(() => {
    if (!showWarmupState) {
      setDismissedErrorKeys([]);
      return;
    }
    setDismissedErrorKeys([]);
  }, [showWarmupState, warmupState?.lastRunAt]);

  useEffect(() => {
    if (!showWarmupState || dedupedWarmupErrors.length === 0) return undefined;

    const timer = setTimeout(() => {
      setDismissedErrorKeys(dedupedWarmupErrors.map((state) => state.__errorKey));
    }, 5000);

    return () => clearTimeout(timer);
  }, [showWarmupState, dedupedWarmupErrors]);

  const visibleWarmupErrors = dedupedWarmupErrors.filter(
    (state) => !dismissedErrorKeys.includes(state.__errorKey)
  );

  if (!quotas || quotas.length === 0) {
    return null;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full table-fixed">
        <colgroup><col className="w-[30%]" /><col className="w-[45%]" /><col className="w-[25%]" /></colgroup>
        <tbody>
          {quotas.map((quota, index) => {
            const remaining = quota.remainingPercentage !== undefined
              ? Math.round(quota.remainingPercentage)
              : calculatePercentage(quota.used, quota.total);

            const colors = getColorClasses(remaining);
            const countdown = formatResetTime(quota.resetAt);
            const resetDisplay = formatResetTimeDisplay(quota.resetAt);
            const warmupError = visibleWarmupErrors.find(
              (state) => state.modelName === quota.modelKey
                || state.modelName === quota.name
            ) || null;

            return (
              <tr
                key={index}
                className="border-b border-black/5 dark:border-white/5 hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors"
              >
                <td className="py-2 px-3 align-middle">
                  <div className="flex items-center gap-2 min-h-[44px]">
                    <span className="text-xs">{colors.emoji}</span>
                    <span className="text-sm font-medium text-text-primary">{quota.name}</span>
                  </div>
                </td>

                <td className="py-2 px-3 align-middle">
                  <div className="space-y-1.5">
                    <div className={`h-1.5 rounded-full overflow-hidden border ${colors.bgLight} ${
                      remaining === 0 ? "border-black/10 dark:border-white/10" : "border-transparent"
                    }`}>
                      <div
                        className={`h-full transition-all duration-300 ${colors.bg}`}
                        style={{ width: `${Math.min(remaining, 100)}%` }}
                      />
                    </div>

                    <div className="flex items-center justify-between text-xs">
                      <span className="text-text-muted">
                        {quota.used.toLocaleString()} / {quota.total > 0 ? quota.total.toLocaleString() : "∞"}
                      </span>
                      <span className={`font-medium ${colors.text}`}>
                        {remaining}%
                      </span>
                    </div>
                  </div>
                </td>

                <td className="py-2 px-3 align-middle">
                  {(countdown !== "-" || resetDisplay || warmupError) ? (
                    <div className="space-y-1 min-h-[44px] flex flex-col justify-center">
                      {countdown !== "-" && (
                        <div className="text-sm text-text-primary font-medium">
                          {translate("in")} {countdown}
                        </div>
                      )}
                      {resetDisplay && (
                        <div className="text-xs text-text-muted">
                          {resetDisplay}
                        </div>
                      )}
                      {warmupError && (
                        <div className="flex items-center gap-1.5 text-xs">
                          <span className="material-symbols-outlined text-[14px] text-red-500 shrink-0">error</span>
                          <span className="text-red-600 dark:text-red-400 leading-relaxed">
                            {warmupError.lastError}
                          </span>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="text-sm text-text-muted italic min-h-[44px] flex items-center">{translate("N/A")}</div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {warmupStatus && (
        <div className={`mt-3 rounded-lg border ${warmupStatus.borderColor} ${warmupStatus.bgColor} p-3`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className={`material-symbols-outlined text-[18px] ${warmupStatus.color} ${warmupStatus.animate ? "animate-spin" : ""}`}>{warmupStatus.icon}</span>
              <div className="flex items-center gap-2">
                <span className={`text-sm font-medium ${warmupStatus.color}`}>{warmupStatus.message}</span>
                {warmupStatus.details && (
                  <span className="text-xs text-text-muted">({warmupStatus.details})</span>
                )}
              </div>
            </div>
            {warmupStatus.lastRunAt && (
              <span className="text-xs text-text-muted">
                {formatRelativeTime(warmupStatus.lastRunAt)}
              </span>
            )}
          </div>
        </div>
      )}

      {visibleWarmupErrors.length > 0 && (
        <div className="mt-3 rounded-lg border border-red-500/20 bg-red-500/5 p-3">
          <div className="flex items-center gap-2 min-h-[44px]">
            <span className="material-symbols-outlined text-[16px] text-red-500 shrink-0">error_outline</span>
            <div className="space-y-1">
              {visibleWarmupErrors.map((state) => (
                <div key={state.__errorKey} className="text-xs text-red-600 dark:text-red-400">
                  <span className="font-medium">{state.modelName || translate("Unknown model")}:</span>{" "}
                  <span className="opacity-90">{state.lastError}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
