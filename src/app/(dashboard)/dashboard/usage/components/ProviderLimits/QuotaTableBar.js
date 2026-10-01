export function getQuotaColorClasses(remainingPercentage) {
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

export default function QuotaTableBar({ remaining, compact = false, colors = getQuotaColorClasses(remaining) }) {
  return (
    <div className={`${compact ? "h-1" : "h-1.5"} rounded-full overflow-hidden border ${colors.bgLight} ${
      remaining === 0 ? "border-black/10 dark:border-white/10" : "border-transparent"
    }`}>
      <div
        className={`h-full transition-all duration-300 ${colors.bg}`}
        style={{ width: `${Math.min(remaining, 100)}%` }}
      />
    </div>
  );
}
