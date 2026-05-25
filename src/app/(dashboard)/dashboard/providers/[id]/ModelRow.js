import PropTypes from "prop-types";

export default function ModelRow({ model, fullModel, alias, copied, onCopy, testStatus, isCustom, isFree, onDeleteAlias, onTest, isTesting, onDisable, onSpeedTest, isSpeedTesting, speedTestData }) {
  const borderColor = testStatus === "ok"
    ? "border-green-500/40"
    : testStatus === "error"
    ? "border-red-500/40"
    : "border-border";

  const iconColor = testStatus === "ok"
    ? "#22c55e"
    : testStatus === "error"
    ? "#ef4444"
    : undefined;

  const getSpeedStyle = () => {
    if (!speedTestData) return null;
    const { latencyMs, tps } = speedTestData;
    // Poor (Red) - Latency > 15s or TPS < 5
    if (latencyMs > 15000 || tps < 5) {
      return {
        bg: "bg-red-500/10 dark:bg-red-500/15 border border-red-500/20",
        text: "text-red-500 dark:text-red-400",
        glow: "shadow-[0_0_8px_rgba(239,68,68,0.35)]"
      };
    }
    // Moderate (Yellow/Orange) - Latency > 10s or TPS < 10
    if (latencyMs > 10000 || tps < 10) {
      return {
        bg: "bg-amber-500/10 dark:bg-amber-500/15 border border-amber-500/20",
        text: "text-amber-600 dark:text-amber-400",
        glow: "shadow-[0_0_8px_rgba(245,158,11,0.3)]"
      };
    }
    // Excellent (Green) - Latency <= 10s and TPS >= 10
    return {
      bg: "bg-green-500/10 dark:bg-green-500/15 border border-green-500/20",
      text: "text-green-600 dark:text-green-400",
      glow: "shadow-[0_0_8px_rgba(34,197,94,0.4)]"
    };
  };

  const speedStyle = getSpeedStyle();

  return (
    <div className={`group min-w-0 max-w-full rounded-lg border px-3 py-2 ${borderColor} hover:bg-sidebar/50`}>
      <div className="flex min-w-0 items-start gap-2 sm:items-center">
        <span
          className="material-symbols-outlined shrink-0 text-base"
          style={iconColor ? { color: iconColor } : undefined}
        >
          {testStatus === "ok" ? "check_circle" : testStatus === "error" ? "cancel" : "smart_toy"}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <code className="max-w-[72vw] truncate rounded bg-sidebar px-1.5 py-0.5 font-mono text-xs text-text-muted sm:max-w-[360px]">{fullModel}</code>
            {speedTestData && speedStyle && (
              <span className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 font-mono text-[10px] font-bold transition-all duration-300 ${speedStyle.bg} ${speedStyle.text} ${speedStyle.glow}`}>
                <span className="material-symbols-outlined text-[10px] animate-pulse">bolt</span>
                {speedTestData.latencyMs}ms · {speedTestData.tps} TPS
              </span>
            )}
          </div>
          {model.name && <span className="truncate pl-1 text-[9px] italic text-text-muted/70">{model.name}</span>}
        </div>
        {onTest && (
          <div className="relative shrink-0 group/btn">
            <button
              onClick={onTest}
              disabled={isTesting}
              className={`rounded p-0.5 text-text-muted transition-opacity hover:bg-sidebar hover:text-primary ${isTesting ? "opacity-100" : "opacity-100 sm:opacity-0 sm:group-hover:opacity-100"}`}
            >
              <span className="material-symbols-outlined text-sm" style={isTesting ? { animation: "spin 1s linear infinite" } : undefined}>
                {isTesting ? "progress_activity" : "science"}
              </span>
            </button>
            <span className="pointer-events-none absolute mt-1 top-5 left-1/2 -translate-x-1/2 text-[10px] text-text-muted whitespace-nowrap opacity-0 group-hover/btn:opacity-100 transition-opacity">
              {isTesting ? "Testing..." : "Test"}
            </span>
          </div>
        )}
        {onSpeedTest && (
          <div className="relative shrink-0 group/btn">
            <button
              onClick={onSpeedTest}
              disabled={isSpeedTesting}
              className={`rounded p-0.5 text-text-muted transition-opacity hover:bg-sidebar hover:text-primary ${isSpeedTesting ? "opacity-100" : "opacity-100 sm:opacity-0 sm:group-hover:opacity-100"}`}
            >
              <span className="material-symbols-outlined text-sm" style={isSpeedTesting ? { animation: "spin 1s linear infinite" } : undefined}>
                {isSpeedTesting ? "progress_activity" : "speed"}
              </span>
            </button>
            <span className="pointer-events-none absolute mt-1 top-5 left-1/2 -translate-x-1/2 text-[10px] text-text-muted whitespace-nowrap opacity-0 group-hover/btn:opacity-100 transition-opacity">
              {isSpeedTesting ? "Measuring speed..." : "Check Latency & TPS"}
            </span>
          </div>
        )}
        <div className="relative shrink-0 group/btn">
          <button
            onClick={() => onCopy(fullModel, `model-${model.id}`)}
            className="rounded p-0.5 text-text-muted hover:bg-sidebar hover:text-primary"
          >
            <span className="material-symbols-outlined text-sm">
              {copied === `model-${model.id}` ? "check" : "content_copy"}
            </span>
          </button>
          <span className="pointer-events-none absolute mt-1 top-5 left-1/2 -translate-x-1/2 text-[10px] text-text-muted whitespace-nowrap opacity-0 group-hover/btn:opacity-100 transition-opacity">
            {copied === `model-${model.id}` ? "Copied!" : "Copy"}
          </span>
        </div>
        {isCustom ? (
          <button
            onClick={onDeleteAlias}
            className="ml-auto rounded p-0.5 text-text-muted opacity-100 transition-opacity hover:bg-red-500/10 hover:text-red-500 sm:opacity-0 sm:group-hover:opacity-100"
            title="Remove custom model"
          >
            <span className="material-symbols-outlined text-sm">close</span>
          </button>
        ) : onDisable ? (
          <button
            onClick={onDisable}
            className="ml-auto rounded p-0.5 text-text-muted opacity-100 transition-opacity hover:bg-red-500/10 hover:text-red-500 sm:opacity-0 sm:group-hover:opacity-100"
            title="Disable this model"
          >
            <span className="material-symbols-outlined text-sm">close</span>
          </button>
        ) : null}
      </div>
    </div>
  );
}

ModelRow.propTypes = {
  model: PropTypes.shape({
    id: PropTypes.string.isRequired,
  }).isRequired,
  fullModel: PropTypes.string.isRequired,
  alias: PropTypes.string,
  copied: PropTypes.string,
  onCopy: PropTypes.func.isRequired,
  testStatus: PropTypes.oneOf(["ok", "error"]),
  isCustom: PropTypes.bool,
  isFree: PropTypes.bool,
  onDeleteAlias: PropTypes.func,
  onTest: PropTypes.func,
  isTesting: PropTypes.bool,
  onDisable: PropTypes.func,
  onSpeedTest: PropTypes.func,
  isSpeedTesting: PropTypes.bool,
  speedTestData: PropTypes.shape({
    latencyMs: PropTypes.number,
    tps: PropTypes.number,
  }),
};
