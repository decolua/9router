import PropTypes from "prop-types";
import { cn } from "@/lib/utils";

export default function ModelRow({
  model,
  fullModel,
  alias,
  copied,
  onCopy,
  testStatus,
  isCustom,
  isFree,
  onDeleteAlias,
  onTest,
  isTesting,
}) {
  const borderClass =
    testStatus === "ok"
      ? "border-emerald-500/40"
      : testStatus === "error"
        ? "border-destructive/40"
        : "border-border";

  const iconClass =
    testStatus === "ok"
      ? "text-emerald-600 dark:text-emerald-400"
      : testStatus === "error"
        ? "text-destructive"
        : "text-muted-foreground";

  return (
    <div
      className={cn(
        "group rounded-lg border px-3 py-2 transition-colors",
        borderClass,
        "hover:bg-muted/50",
      )}
    >
      <div className="flex items-center gap-2">
        <span className={cn("material-symbols-outlined text-base", iconClass)}>
          {testStatus === "ok"
            ? "check_circle"
            : testStatus === "error"
              ? "cancel"
              : "smart_toy"}
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
            {fullModel}
          </code>
          {model.name && (
            <span className="pl-1 text-[9px] italic text-muted-foreground/80">
              {model.name}
            </span>
          )}
        </div>
        {onTest && (
          <div className="group/btn relative">
            <button
              type="button"
              onClick={onTest}
              disabled={isTesting}
              className={cn(
                "rounded p-0.5 text-muted-foreground transition-opacity hover:bg-accent hover:text-foreground",
                isTesting ? "opacity-100" : "opacity-0 group-hover:opacity-100",
              )}
            >
              <span
                className="material-symbols-outlined text-sm"
                style={
                  isTesting ? { animation: "spin 1s linear infinite" } : undefined
                }
              >
                {isTesting ? "progress_activity" : "science"}
              </span>
            </button>
            <span className="pointer-events-none absolute top-5 left-1/2 mt-1 -translate-x-1/2 whitespace-nowrap text-[10px] text-muted-foreground opacity-0 transition-opacity group-hover/btn:opacity-100">
              {isTesting ? "Testing..." : "Test"}
            </span>
          </div>
        )}
        <div className="group/btn relative">
          <button
            type="button"
            onClick={() => onCopy(fullModel, `model-${model.id}`)}
            className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <span className="material-symbols-outlined text-sm">
              {copied === `model-${model.id}` ? "check" : "content_copy"}
            </span>
          </button>
          <span className="pointer-events-none absolute top-5 left-1/2 mt-1 -translate-x-1/2 whitespace-nowrap text-[10px] text-muted-foreground opacity-0 transition-opacity group-hover/btn:opacity-100">
            {copied === `model-${model.id}` ? "Copied!" : "Copy"}
          </span>
        </div>
        {isCustom && (
          <button
            type="button"
            onClick={onDeleteAlias}
            className="ml-auto rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
            title="Remove custom model"
          >
            <span className="material-symbols-outlined text-sm">close</span>
          </button>
        )}
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
};
