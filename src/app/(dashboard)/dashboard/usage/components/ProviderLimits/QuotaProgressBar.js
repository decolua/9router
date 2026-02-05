"use client";

import { cn } from "@/shared/utils/cn";

// Helper function to calculate time until reset
const getResetTimeText = (resetTime) => {
  if (!resetTime) return null;
  
  const now = new Date();
  const reset = new Date(resetTime);
  const diffMs = reset - now;
  
  if (diffMs <= 0) return "Reset now";
  
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  
  if (hours > 0) {
    return `Reset in ${hours}h`;
  }
  return `Reset in ${minutes}m`;
};

// Calculate color based on remaining percentage
const getColorClasses = (percentage) => {
  if (percentage === 0) {
    return {
      text: "text-gray-400",
      bg: "bg-gray-400",
      bgLight: "bg-gray-400/10"
    };
  }
  
  const remaining = 100 - percentage;
  
  if (remaining > 70) {
    return {
      text: "text-green-500",
      bg: "bg-green-500",
      bgLight: "bg-green-500/10"
    };
  }
  
  if (remaining >= 30) {
    return {
      text: "text-yellow-500",
      bg: "bg-yellow-500",
      bgLight: "bg-yellow-500/10"
    };
  }
  
  return {
    text: "text-red-500",
    bg: "bg-red-500",
    bgLight: "bg-red-500/10"
  };
};

export default function QuotaProgressBar({
  percentage = 0,
  label = "",
  used = 0,
  total = 0,
  unlimited = false,
  resetTime = null
}) {
  const colors = getColorClasses(percentage);
  const resetText = getResetTimeText(resetTime);
  
  return (
    <div className="space-y-2">
      {/* Label and usage info */}
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-text-primary dark:text-white">
          {label}
        </span>
        <div className="flex items-center gap-2 text-text-muted">
          {unlimited ? (
            <span>Unlimited</span>
          ) : (
            <span>
              {used.toLocaleString()}/{total.toLocaleString()} ({percentage}%)
            </span>
          )}
          {resetText && (
            <>
              <span>•</span>
              <span className="text-xs">{resetText}</span>
            </>
          )}
        </div>
      </div>

      {/* Progress bar */}
      {!unlimited && (
        <div className={cn("h-2 rounded-full overflow-hidden", colors.bgLight)}>
          <div
            className={cn("h-full transition-all duration-300", colors.bg)}
            style={{ width: `${Math.min(percentage, 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}
