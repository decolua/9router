"use client";

import { useState } from "react";
import ModelSelectModal from "./ModelSelectModal";

export default function ModelMultiSelectField({
  label = "Models",
  value = [],
  onChange,
  activeProviders = [],
  modelAliases = {},
  title = "Select Models",
  hint = "Empty = all models.",
  addLabel = "Add Model",
}) {
  const [isOpen, setIsOpen] = useState(false);
  const selectedModels = Array.isArray(value) ? value : [];

  const handleSelect = (model) => {
    if (!model?.value || selectedModels.includes(model.value)) return;
    onChange([...selectedModels, model.value]);
  };

  const handleDeselect = (model) => {
    if (!model?.value) return;
    onChange(selectedModels.filter((item) => item !== model.value));
  };

  const handleRemove = (modelValue) => {
    onChange(selectedModels.filter((item) => item !== modelValue));
  };

  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium text-text-main">{label}</label>
      {selectedModels.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border-subtle bg-surface-2/60 px-3 py-3 text-center text-xs text-text-muted">
          All models allowed
        </div>
      ) : (
        <div className="flex max-h-40 flex-col gap-1.5 overflow-y-auto rounded-lg border border-border-subtle bg-surface-2/60 p-2">
          {selectedModels.map((model) => (
            <div key={model} className="flex min-w-0 items-center gap-2 rounded-md bg-surface px-2 py-1.5 text-xs">
              <code className="min-w-0 flex-1 truncate font-mono text-text-main" title={model}>{model}</code>
              <button
                type="button"
                onClick={() => handleRemove(model)}
                className="rounded p-0.5 text-text-muted transition-colors hover:bg-red-500/10 hover:text-red-500"
                title="Remove model"
              >
                <span className="material-symbols-outlined text-[14px]">close</span>
              </button>
            </div>
          ))}
        </div>
      )}
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="flex w-full items-center justify-center gap-1 rounded-lg border border-dashed border-border-subtle py-2 text-xs font-medium text-primary transition-colors hover:border-primary/50 hover:text-primary"
      >
        <span className="material-symbols-outlined text-[16px]">add</span>
        {addLabel}
      </button>
      {hint && <p className="text-xs text-text-muted">{hint}</p>}
      <ModelSelectModal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        onSelect={handleSelect}
        onDeselect={handleDeselect}
        activeProviders={activeProviders}
        modelAliases={modelAliases}
        title={title}
        addedModelValues={selectedModels}
        closeOnSelect={false}
      />
    </div>
  );
}
