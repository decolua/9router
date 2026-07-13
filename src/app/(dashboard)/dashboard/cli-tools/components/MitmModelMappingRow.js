const REASONING_OPTIONS = [
  { value: "", label: "Default" },
  { value: "none", label: "None" },
  { value: "minimal", label: "Minimal" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "XHigh" },
  { value: "max", label: "Max" },
];

export default function MitmModelMappingRow({
  model,
  entry,
  disabled,
  canSelectModel,
  showReasoning,
  onModelChange,
  onModelBlur,
  onModelClear,
  onModelSelect,
  onReasoningChange,
}) {
  const controlId = model.alias.replace(/[^a-z0-9_-]/gi, "-");

  return (
    <div className="rounded-lg border border-border/70 bg-surface/40 p-2.5 transition-colors hover:border-primary/30">
      <div className={`grid grid-cols-1 gap-2 ${showReasoning ? "sm:grid-cols-[9rem_minmax(12rem,1fr)_8rem_auto]" : "sm:grid-cols-[9rem_minmax(12rem,1fr)_auto]"} sm:items-center`}>
        <label htmlFor={`mitm-model-${controlId}`} className="text-xs font-semibold text-text-main sm:text-right">
          {model.name}
        </label>
        <div className="relative w-full min-w-0">
          <input
            id={`mitm-model-${controlId}`}
            type="text"
            value={entry.model || ""}
            onChange={(event) => onModelChange(event.target.value)}
            onBlur={(event) => onModelBlur(event.target.value)}
            placeholder="provider/model-id"
            disabled={disabled}
            className={`w-full min-w-0 rounded border border-border bg-surface py-2 pl-2 pr-7 text-xs focus:outline-none focus:ring-1 focus:ring-primary/50 sm:py-1.5 ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
          />
          {entry.model && (
            <button
              id={`mitm-clear-${controlId}`}
              type="button"
              onClick={onModelClear}
              disabled={disabled}
              className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-0.5 text-text-muted transition-colors hover:text-red-500 disabled:cursor-not-allowed"
              title={`Clear model mapping for ${model.name}`}
              aria-label={`Clear model mapping for ${model.name}`}
            >
              <span className="material-symbols-outlined text-[14px]">close</span>
            </button>
          )}
        </div>
        {showReasoning && (
          <select
            id={`mitm-reasoning-${controlId}`}
            value={entry.reasoningEffort || ""}
            onChange={(event) => onReasoningChange(event.target.value)}
            disabled={disabled}
            aria-label={`Reasoning effort for ${model.name}`}
            title="Default preserves the reasoning effort sent by Antigravity"
            className={`w-full rounded border border-border bg-surface px-2 py-2 text-xs text-text-main focus:outline-none focus:ring-1 focus:ring-primary/50 sm:py-1.5 ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
          >
            {REASONING_OPTIONS.map((option) => (
              <option key={option.value || "default"} value={option.value}>{option.label}</option>
            ))}
          </select>
        )}
        <button
          id={`mitm-select-${controlId}`}
          type="button"
          onClick={onModelSelect}
          disabled={!canSelectModel || disabled}
          className={`rounded border px-2 py-2 text-xs transition-colors sm:py-1.5 ${canSelectModel && !disabled ? "cursor-pointer border-border bg-surface hover:border-primary" : "cursor-not-allowed border-border opacity-50"}`}
        >
          Select
        </button>
      </div>
    </div>
  );
}
