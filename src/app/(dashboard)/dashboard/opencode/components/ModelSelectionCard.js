"use client";

import { useMemo, useState } from "react";
import { Badge, Button, Card, Input } from "@/shared/components";
import { cn } from "@/shared/utils/cn";

function SelectionModeButton({ active, title, description, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-lg border p-3 text-left transition-all",
        active
          ? "border-primary bg-primary/5"
          : "border-black/5 hover:border-primary/30 dark:border-white/5"
      )}
    >
      <div className="text-sm font-semibold text-text-main">{title}</div>
      <div className="mt-1 text-xs text-text-muted">{description}</div>
    </button>
  );
}

export default function ModelSelectionCard({
  preferences,
  modelOptions = [],
  saving = false,
  error = "",
  onSave,
}) {
  const [draftModel, setDraftModel] = useState("");

  const mode = preferences?.modelSelectionMode || "exclude";
  const listKey = mode === "include" ? "includedModels" : "excludedModels";
  const selectedModels = useMemo(() => preferences?.[listKey] || [], [preferences, listKey]);

  const availableOptions = useMemo(() => {
    const unique = Array.from(new Set([...(modelOptions || []), ...selectedModels])).filter(Boolean);
    unique.sort((left, right) => left.localeCompare(right));
    return unique;
  }, [modelOptions, selectedModels]);

  const addModel = () => {
    const nextModel = draftModel.trim();
    if (!nextModel || selectedModels.includes(nextModel)) return;

    onSave?.({
      [listKey]: [...selectedModels, nextModel],
    });
    setDraftModel("");
  };

  const removeModel = (modelId) => {
    onSave?.({
      [listKey]: selectedModels.filter((item) => item !== modelId),
    });
  };

  return (
    <Card
      title="Model selection"
      subtitle="Choose whether the sync bundle includes only selected models or excludes a smaller deny-list."
      icon="model_training"
    >
      <div className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          <SelectionModeButton
            active={mode === "include"}
            title="Include only"
            description="Bundle only the models you explicitly list."
            onClick={() => onSave?.({ modelSelectionMode: "include" })}
          />
          <SelectionModeButton
            active={mode === "exclude"}
            title="Exclude from catalog"
            description="Start from the full OpenCode catalog and remove only a few models."
            onClick={() => onSave?.({ modelSelectionMode: "exclude" })}
          />
        </div>

        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
          <Input
            label={mode === "include" ? "Add allowed model" : "Add excluded model"}
            list="opencode-model-options"
            value={draftModel}
            onChange={(event) => setDraftModel(event.target.value)}
            placeholder="openai/gpt-4.1-mini"
            hint="Type any model id or pick from current preview-derived suggestions."
          />
          <div className="flex items-end">
            <Button onClick={addModel} disabled={!draftModel.trim()} loading={saving}>
              Add model
            </Button>
          </div>
          <datalist id="opencode-model-options">
            {availableOptions.map((modelId) => (
              <option key={modelId} value={modelId} />
            ))}
          </datalist>
        </div>

        {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}

        <div className="flex flex-wrap gap-2">
          {selectedModels.length === 0 ? (
            <p className="text-sm text-text-muted">
              {mode === "include"
                ? "No included models selected yet."
                : "No excluded models configured. The bundle will keep the full catalog."}
            </p>
          ) : (
            selectedModels.map((modelId) => (
              <Badge key={modelId} className="gap-2 pr-1">
                <span className="max-w-[240px] truncate">{modelId}</span>
                <button
                  type="button"
                  className="rounded-full p-0.5 hover:bg-black/10 dark:hover:bg-white/10"
                  onClick={() => removeModel(modelId)}
                  aria-label={`Remove ${modelId}`}
                >
                  <span className="material-symbols-outlined text-[14px]">close</span>
                </button>
              </Badge>
            ))
          )}
        </div>
      </div>
    </Card>
  );
}
