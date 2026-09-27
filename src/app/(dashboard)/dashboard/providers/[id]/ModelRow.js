import PropTypes from "prop-types";
import { CapacityBadges } from "@/shared/components";
import ModelMetaChips, { MODEL_CHIP_CLASS } from "./ModelMetaChips";
import AddToComboButton from "./AddToComboButton";
import DetectMetaButton from "./DetectMetaButton";

export default function ModelRow({ model, fullModel, alias, copied, onCopy, testStatus, isCustom, isFree, onDeleteAlias, onTest, isTesting, onDisable, caps, thinkingSuffix, comboNames = [], disabledInUse = false, selectable = false, selected = false, onToggleSelect, providerId, combos, onComboChanged }) {
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
    // Regular widths (full, or half on wide screens) instead of content-sized cards.
    <div className={`group w-full min-w-0 max-w-full rounded-lg border px-3 py-2 xl:w-[calc(50%-0.375rem)] ${borderColor} hover:bg-sidebar/50`}>
      <div className="flex min-w-0 flex-wrap items-start gap-x-2 gap-y-1 sm:flex-nowrap sm:items-center">
        {selectable && (
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelect}
            aria-label={`Select ${model.id}`}
            className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-gray-300 text-primary focus:ring-primary sm:mt-0"
          />
        )}
        <span
          className="material-symbols-outlined shrink-0 text-[18px] text-text-muted"
          style={iconColor ? { color: iconColor } : undefined}
        >
          {testStatus === "ok" ? "check_circle" : testStatus === "error" ? "cancel" : "smart_toy"}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex min-w-0 items-center gap-0.5">
            <AddToComboButton
              fullModel={fullModel}
              combos={combos}
              comboNames={comboNames}
              onChanged={onComboChanged}
              buttonClassName="rounded p-0.5 text-text-muted opacity-100 transition-opacity hover:bg-primary/10 hover:text-primary pointer-fine:opacity-40 pointer-fine:group-hover:opacity-100"
            />
            <code className="min-w-0 break-all rounded bg-sidebar px-1.5 py-0.5 font-mono text-xs text-text-muted sm:truncate sm:break-normal" title={displayModel}>{displayModel}</code>
          </div>
          <span className="flex min-w-0 flex-wrap items-center gap-1 pl-1">
            {model.name && <span className="max-w-full truncate text-[11px] text-text-muted">{model.name}</span>}
            {comboNames.length > 0 && (
              <span className={`${MODEL_CHIP_CLASS} max-w-full border-primary/25 bg-primary/10 text-primary`} title={`Used in: ${comboNames.join(", ")}`}>
                <span className="material-symbols-outlined text-[12px]">layers</span>
                <span className="truncate">{comboNames.slice(0, 2).join(", ")}{comboNames.length > 2 ? ` +${comboNames.length - 2}` : ""}</span>
              </span>
            )}
            {disabledInUse && (
              <span className={`${MODEL_CHIP_CLASS} border-border bg-black/5 text-text-muted dark:bg-white/10`}>
                disabled
              </span>
            )}
            <ModelMetaChips caps={caps} />
            <CapacityBadges caps={caps ? { ...caps, reasoning: false } : caps} colorOverride="text-text-muted/70" size={14} />
          </span>
        </div>
        {/* Phones: actions get their own line so the model id is never cut. */}
        <div className="flex basis-full items-center justify-end gap-0.5 sm:basis-auto sm:shrink-0">
        {providerId && (
          <DetectMetaButton
            providerId={providerId}
            modelId={model.id}
            buttonClassName="rounded p-0.5 text-text-muted transition-opacity opacity-100 pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 hover:bg-sidebar hover:text-primary"
          />
        )}
        {onTest && (
          <div className="relative shrink-0 group/btn">
            <button
              onClick={onTest}
              disabled={isTesting}
              className={`rounded p-0.5 text-text-muted transition-opacity hover:bg-sidebar hover:text-primary ${isTesting ? "opacity-100" : "opacity-100 pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100"}`}
            >
              <span className="material-symbols-outlined text-[17px]" style={isTesting ? { animation: "spin 1s linear infinite" } : undefined}>
                {isTesting ? "progress_activity" : "science"}
              </span>
            </button>
            <span className="pointer-events-none absolute mt-1 top-5 left-1/2 -translate-x-1/2 text-[10px] text-text-muted whitespace-nowrap opacity-0 group-hover/btn:opacity-100 transition-opacity">
              {isTesting ? "Testing..." : "Test"}
            </span>
          </div>
        )}
        <div className="relative shrink-0 group/btn">
          <button
            onClick={() => onCopy(displayModel, `model-${model.id}`)}
            className="rounded p-0.5 text-text-muted hover:bg-sidebar hover:text-primary"
          >
            <span className="material-symbols-outlined text-[17px]">
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
            className="ml-auto rounded p-0.5 text-text-muted opacity-100 transition-opacity hover:bg-red-500/10 hover:text-red-500 pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100"
            title="Remove custom model"
          >
            <span className="material-symbols-outlined text-[17px]">close</span>
          </button>
        ) : onDisable ? (
          <button
            onClick={onDisable}
            className="ml-auto rounded p-0.5 text-text-muted opacity-100 transition-opacity hover:bg-red-500/10 hover:text-red-500 pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100"
            title="Disable this model"
          >
            <span className="material-symbols-outlined text-[17px]">close</span>
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
  comboNames: PropTypes.arrayOf(PropTypes.string),
  disabledInUse: PropTypes.bool,
  selectable: PropTypes.bool,
  selected: PropTypes.bool,
  onToggleSelect: PropTypes.func,
  providerId: PropTypes.string,
  combos: PropTypes.arrayOf(PropTypes.object),
  onComboChanged: PropTypes.func,
};
