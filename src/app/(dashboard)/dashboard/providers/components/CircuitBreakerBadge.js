import PropTypes from "prop-types";

/**
 * CircuitBreakerBadge — compact badge showing circuit breaker state for an account.
 * Hidden when status is missing or CLOSED. Integrates into existing connection rows
 * without requiring a new page.
 */
export default function CircuitBreakerBadge({ status, onReset }) {
  if (!status || status.state === "CLOSED") return null;
  const stateConfig = {
    DEGRADED: { color: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400", icon: "warning", label: "Degraded" },
    OPEN: { color: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400", icon: "power", label: "Circuit Open" },
    HALF_OPEN: { color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400", icon: "autorenew", label: "Recovering" },
  };

  const config = stateConfig[status.state] || stateConfig.DEGRADED;
  const retryIn = status.retryAfterMs > 0 ? ` (${Math.ceil(status.retryAfterMs / 1000)}s)` : "";
  // The badge aggregates every per-model breaker of the connection (worst
  // state wins), so when more than the label is known, say which models tripped.
  const modelHint = Array.isArray(status.models) && status.models.length > 0 ? ` — ${status.models.join(", ")}` : "";
  const tooltip = `${config.label}${retryIn}${modelHint}`;

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${config.color}`}
      title={tooltip}
    >
      <span className="material-symbols-outlined text-[12px]">{config.icon}</span>
      {config.label}{retryIn}
      {status.state === "OPEN" && onReset && (
        <button
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onReset(); }}
          className="ml-0.5 hover:opacity-70 transition-opacity"
          title="Reset circuit breaker"
        >
          <span className="material-symbols-outlined text-[12px]">refresh</span>
        </button>
      )}
    </span>
  );
}

CircuitBreakerBadge.propTypes = {
  status: PropTypes.shape({
    state: PropTypes.oneOf(["CLOSED", "DEGRADED", "OPEN", "HALF_OPEN"]),
    retryAfterMs: PropTypes.number,
    models: PropTypes.arrayOf(PropTypes.string),
  }),
  onReset: PropTypes.func,
};
