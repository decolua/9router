"use client";

import { useState, useEffect } from "react";
import PropTypes from "prop-types";
import { Button, Modal } from "@/shared/components";

export default function ProviderModelsImportModal({
  isOpen,
  onClose,
  title,
  description = "Choose the specific models you want to enable in 9Router. Only selected models will be exposed in /v1/models.",
  availableModels = [],
  initialSelectedIds = new Set(),
  onSave,
  saving = false,
}) {
  const [modelSearch, setModelSearch] = useState("");
  const [selectedImportIds, setSelectedImportIds] = useState(new Set());
  const [initialImportIds, setInitialImportIds] = useState(new Set());

  useEffect(() => {
    if (isOpen) {
      const initialSet = initialSelectedIds instanceof Set
        ? new Set(initialSelectedIds)
        : new Set(initialSelectedIds || []);
      setSelectedImportIds(new Set(initialSet));
      setInitialImportIds(new Set(initialSet));
      setModelSearch("");
    }
  }, [isOpen, initialSelectedIds]);

  const toggleImportModelSelection = (modelId) => {
    setSelectedImportIds((prev) => {
      const next = new Set(prev);
      if (next.has(modelId)) next.delete(modelId);
      else next.add(modelId);
      return next;
    });
  };

  const filteredImportModels = availableModels.filter((m) => {
    if (!modelSearch.trim()) return true;
    const q = modelSearch.toLowerCase();
    return (
      (m.id && m.id.toLowerCase().includes(q)) ||
      (m.name && typeof m.name === "string" && m.name.toLowerCase().includes(q))
    );
  });

  const handleSelectAllVisible = () => {
    setSelectedImportIds((prev) => {
      const next = new Set(prev);
      for (const m of filteredImportModels) {
        if (m?.id) next.add(m.id);
      }
      return next;
    });
  };

  const handleDeselectAllVisible = () => {
    setSelectedImportIds((prev) => {
      const next = new Set(prev);
      for (const m of filteredImportModels) {
        if (m?.id) next.delete(m.id);
      }
      return next;
    });
  };

  const toAdd = [...selectedImportIds].filter((id) => !initialImportIds.has(id));
  const toRemove = [...initialImportIds].filter((id) => !selectedImportIds.has(id));
  const toAddCount = toAdd.length;
  const toRemoveCount = toRemove.length;
  const hasImportChanges = toAddCount > 0 || toRemoveCount > 0;

  const handleSave = async () => {
    if (saving || !hasImportChanges) return;
    await onSave(toAdd, toRemove, Array.from(selectedImportIds));
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => !saving && onClose()}
      title={title || `Select Models from Provider (${availableModels.length} available)`}
      size="lg"
    >
      <div className="flex flex-col gap-3">
        <p className="text-xs text-text-muted">
          {description}
        </p>

        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Filter models by name or id..."
            value={modelSearch}
            onChange={(e) => setModelSearch(e.target.value)}
            className="flex-1 px-3 py-1.5 text-xs bg-background border border-border rounded-md focus:outline-none focus:border-primary"
          />
          <Button size="xs" variant="secondary" onClick={handleSelectAllVisible}>
            Select Visible
          </Button>
          <Button size="xs" variant="ghost" onClick={handleDeselectAllVisible}>
            Deselect All
          </Button>
        </div>

        <div className="flex items-center justify-between text-xs text-text-muted px-1">
          <span>Showing {filteredImportModels.length} of {availableModels.length}</span>
          <span className="font-medium text-primary">
            {selectedImportIds.size} selected
            {hasImportChanges && (
              <span className="ml-1 text-[11px] font-normal text-text-muted">
                ({toAddCount > 0 ? `+${toAddCount}` : ""}{toAddCount > 0 && toRemoveCount > 0 ? ", " : ""}{toRemoveCount > 0 ? `-${toRemoveCount}` : ""})
              </span>
            )}
          </span>
        </div>

        <div className="max-h-[350px] overflow-y-auto border border-border rounded-lg divide-y divide-border/40 p-1">
          {filteredImportModels.length === 0 ? (
            <div className="text-center py-6 text-xs text-text-muted">No models match your filter</div>
          ) : (
            filteredImportModels.map((model) => {
              const wasInitiallyAdded = initialImportIds.has(model.id);
              const isChecked = selectedImportIds.has(model.id);
              const willBeRemoved = wasInitiallyAdded && !isChecked;
              const willBeAdded = !wasInitiallyAdded && isChecked;

              return (
                <label
                  key={model.id}
                  className={`flex items-center gap-2.5 px-3 py-2 rounded text-xs cursor-pointer transition-colors ${
                    willBeRemoved
                      ? "bg-red-500/10 text-red-600 dark:text-red-400"
                      : isChecked
                        ? "bg-primary/10 text-text-main"
                        : "hover:bg-sidebar/50"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => toggleImportModelSelection(model.id)}
                    className="rounded border-border text-primary focus:ring-primary h-3.5 w-3.5 cursor-pointer"
                  />
                  <div className="flex-1 min-w-0">
                    <span className="font-mono truncate block">{model.id}</span>
                    {model.name && model.name !== model.id && (
                      <span className="text-[10px] text-text-muted truncate block">{model.name}</span>
                    )}
                  </div>
                  {willBeRemoved ? (
                    <span className="text-[10px] text-red-600 bg-red-500/15 px-1.5 py-0.5 rounded font-medium shrink-0">
                      Will remove
                    </span>
                  ) : willBeAdded ? (
                    <span className="text-[10px] text-primary bg-primary/15 px-1.5 py-0.5 rounded font-medium shrink-0">
                      To add
                    </span>
                  ) : wasInitiallyAdded ? (
                    <span className="text-[10px] text-green-600 bg-green-500/10 px-1.5 py-0.5 rounded font-medium shrink-0">
                      Added
                    </span>
                  ) : null}
                </label>
              );
            })
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-border">
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={saving || !hasImportChanges}
          >
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

ProviderModelsImportModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  title: PropTypes.string,
  description: PropTypes.string,
  availableModels: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.string.isRequired,
      name: PropTypes.string,
    })
  ).isRequired,
  initialSelectedIds: PropTypes.oneOfType([
    PropTypes.instanceOf(Set),
    PropTypes.arrayOf(PropTypes.string),
  ]),
  onSave: PropTypes.func.isRequired,
  saving: PropTypes.bool,
};
