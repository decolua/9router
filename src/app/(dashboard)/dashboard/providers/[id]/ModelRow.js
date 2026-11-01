import PropTypes from "prop-types";
import { CapacityBadges, ModelTierBadge } from "@/shared/components";

export default function ModelRow({ model, fullModel, alias, copied, onCopy, testStatus, isCustom, isFree, onDeleteAlias, onTest, isTesting, onDisable, caps, thinkingSuffix }) {
  const displayModel = thinkingSuffix ? `${fullModel}(${thinkingSuffix})` : fullModel;
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

  return (
    <div className={`group w-full sm:w-auto min-w-0 max-w-full rounded-lg border px-3 py-2 ${borderColor} hover:bg-sidebar/50`}>
      <div className="flex min-w-0 items-center gap-2">
        <span
          className="material-symbols-outlined shrink-0 text-base leading-none select-none"
          style={iconColor ? { color: iconColor } : undefined}
        >
          {testStatus === "ok" ? "check_circle" : testStatus === "error" ? "cancel" : "smart_toy"}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <code className="w-fit max-w-full break-all rounded bg-sidebar px-1.5 py-0.5 font-mono text-xs text-text-muted sm:max-w-[360px] sm:truncate leading-normal">{displayModel}</code>
          <span className="flex min-w-0 items-center text-[9px] gap-1.5 pl-0.5 flex-wrap leading-none">
            {model.name && <span className="break-all sm:truncate text-[9px] italic text-text-muted/70 leading-none">{model.name}</span>}
            <ModelTierBadge model={model} providerId={fullModel?.split("/")?.[0] || ""} isFree={isFree} />
            <CapacityBadges caps={caps} colorOverride="text-text-muted/70" size={12} />
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {onTest && (
            <div className="relative shrink-0 group/btn">
              <button
                onClick={onTest}
                disabled={isTesting}
                className={`rounded p-1 text-text-muted transition-opacity hover:bg-sidebar hover:text-primary inline-flex items-center justify-center ${isTesting ? "opacity-100" : "opacity-100 sm:opacity-0 sm:group-hover:opacity-100"}`}
              >
                <span className="material-symbols-outlined text-sm leading-none" style={isTesting ? { animation: "spin 1s linear infinite" } : undefined}>
                  {isTesting ? "progress_activity" : "science"}
                </span>
              </button>
              <span className="pointer-events-none absolute mt-1 top-5 left-1/2 -translate-x-1/2 text-[10px] text-text-muted whitespace-nowrap opacity-0 group-hover/btn:opacity-100 transition-opacity">
                {isTesting ? "Testing..." : "Test"}
              </span>
            </div>
          )}
          <button
            onClick={() => onCopy(displayModel, `model-${model.id}`)}
            title={copied === `model-${model.id}` ? "Copied" : "Copy"}
            className="p-1 hover:bg-surface-2 rounded text-text-muted hover:text-primary transition-all shrink-0"
          >
            <span className="material-symbols-outlined text-[14px] leading-none">
              {copied === `model-${model.id}` ? "check" : "content_copy"}
            </span>
          </button>
          {isCustom ? (
            <button
              onClick={onDeleteAlias}
              className="rounded p-1 text-text-muted opacity-100 transition-opacity hover:bg-red-500/10 hover:text-red-500 sm:opacity-0 sm:group-hover:opacity-100 inline-flex items-center justify-center"
              title="Remove custom model"
            >
              <span className="material-symbols-outlined text-sm leading-none">close</span>
            </button>
          ) : onDisable ? (
            <button
              onClick={onDisable}
              className="rounded p-1 text-text-muted opacity-100 transition-opacity hover:bg-red-500/10 hover:text-red-500 sm:opacity-0 sm:group-hover:opacity-100 inline-flex items-center justify-center"
              title="Disable this model"
            >
              <span className="material-symbols-outlined text-sm leading-none">close</span>
            </button>
          ) : null}
        </div>
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
  caps: PropTypes.object,
  thinkingSuffix: PropTypes.string,
};
