"use client";

import { useState } from "react";
import PropTypes from "prop-types";
import { Button, Modal } from "@/shared/components";
import { getProviderCustomModelRows } from "@/shared/utils/providerCustomModels";
function CompatibleModelRow({ modelId, fullModel, copied, onCopy, onDeleteAlias, onTest, testStatus, isTesting }) {
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
    <div className={`flex items-center gap-3 p-3 rounded-lg border ${borderColor} hover:bg-sidebar/50`}>
      <span
        className="material-symbols-outlined text-base text-text-muted"
        style={iconColor ? { color: iconColor } : undefined}
      >
        {testStatus === "ok" ? "check_circle" : testStatus === "error" ? "cancel" : "smart_toy"}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{modelId}</p>
        <div className="flex items-center gap-1 mt-1">
          <code className="text-xs text-text-muted font-mono bg-sidebar px-1.5 py-0.5 rounded">{fullModel}</code>
          <div className="relative group/btn">
            <button
              onClick={() => onCopy(fullModel, `model-${modelId}`)}
              className="p-0.5 hover:bg-sidebar rounded text-text-muted hover:text-primary"
            >
              <span className="material-symbols-outlined text-sm">
                {copied === `model-${modelId}` ? "check" : "content_copy"}
              </span>
            </button>
            <span className="pointer-events-none absolute top-5 left-1/2 -translate-x-1/2 text-[10px] text-text-muted whitespace-nowrap opacity-0 group-hover/btn:opacity-100 transition-opacity">
              {copied === `model-${modelId}` ? "Copied!" : "Copy"}
            </span>
          </div>
          {onTest && (
            <div className="relative group/btn">
              <button
                onClick={onTest}
                disabled={isTesting}
                className="p-0.5 hover:bg-sidebar rounded text-text-muted hover:text-primary transition-colors"
              >
                <span className="material-symbols-outlined text-sm" style={isTesting ? { animation: "spin 1s linear infinite" } : undefined}>
                  {isTesting ? "progress_activity" : "science"}
                </span>
              </button>
              <span className="pointer-events-none absolute top-5 left-1/2 -translate-x-1/2 text-[10px] text-text-muted whitespace-nowrap opacity-0 group-hover/btn:opacity-100 transition-opacity">
                {isTesting ? "Testing..." : "Test"}
              </span>
            </div>
          )}
        </div>
      </div>
      <button
        onClick={onDeleteAlias}
        className="p-1 hover:bg-red-50 rounded text-red-500"
        title="Remove model"
      >
        <span className="material-symbols-outlined text-sm">delete</span>
      </button>
    </div>
  );
}

export default function CompatibleModelsSection({ providerStorageAlias, providerDisplayAlias, modelAliases, customModels, copied, onCopy, onDeleteAlias, onAddCustomModel, onDeleteCustomModel, connections, isAnthropic }) {
  const [newModel, setNewModel] = useState("");
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [testingModelId, setTestingModelId] = useState(null);
  const [modelTestResults, setModelTestResults] = useState({});
  const [showSelectModal, setShowSelectModal] = useState(false);
  const [availableModels, setAvailableModels] = useState([]);
  const [selectedImportIds, setSelectedImportIds] = useState(new Set());
  const [modelSearch, setModelSearch] = useState("");
  const [savingImport, setSavingImport] = useState(false);

  const handleTestModel = async (modelId) => {
    if (testingModelId) return;
    setTestingModelId(modelId);
    try {
      const res = await fetch("/api/models/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: `${providerStorageAlias}/${modelId}` }),
      });
      const data = await res.json();
      setModelTestResults((prev) => ({ ...prev, [modelId]: data.ok ? "ok" : "error" }));
    } catch {
      setModelTestResults((prev) => ({ ...prev, [modelId]: "error" }));
    } finally {
      setTestingModelId(null);
    }
  };

  const allModels = getProviderCustomModelRows({
    customModels,
    modelAliases,
    providerAlias: providerStorageAlias,
    type: "llm",
  });

  const handleAdd = async () => {
    if (!newModel.trim() || adding) return;
    const modelId = newModel.trim();
    if (allModels.some((model) => model.id === modelId)) {
      alert("Model already exists for this provider.");
      return;
    }

    setAdding(true);
    try {
      await onAddCustomModel(modelId);
      setNewModel("");
    } catch (error) {
      console.log("Error adding model:", error);
    } finally {
      setAdding(false);
    }
  };

  const handleOpenImportModal = async () => {
    if (importing) return;
    const activeConnection = connections.find((conn) => conn.isActive !== false);
    if (!activeConnection) return;

    setImporting(true);
    try {
      const res = await fetch(`/api/providers/${activeConnection.id}/models`);
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Failed to fetch models from provider");
        return;
      }
      const models = (data.models || []).map((model) => {
        const id = model.id || model.name || model.model;
        return {
          id,
          name: model.name || id,
        };
      }).filter((m) => typeof m.id === "string" && m.id.trim() !== "");

      if (models.length === 0) {
        alert("No models returned from /models.");
        return;
      }

      setAvailableModels(models);
      setSelectedImportIds(new Set());
      setModelSearch("");
      setShowSelectModal(true);
    } catch (error) {
      console.log("Error fetching models:", error);
      alert("Error fetching models: " + error.message);
    } finally {
      setImporting(false);
    }
  };

  const handleSaveSelectedModels = async () => {
    if (savingImport || selectedImportIds.size === 0) return;
    setSavingImport(true);
    try {
      let count = 0;
      for (const modelId of selectedImportIds) {
        if (allModels.some((entry) => entry.id === modelId)) continue;
        await onAddCustomModel(modelId);
        count += 1;
      }
      setShowSelectModal(false);
      setSelectedImportIds(new Set());
      if (count > 0) {
        alert(`Successfully added ${count} model(s).`);
      }
    } catch (error) {
      console.log("Error saving models:", error);
      alert("Error saving models: " + error.message);
    } finally {
      setSavingImport(false);
    }
  };

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
    return m.id.toLowerCase().includes(q) || (m.name && m.name.toLowerCase().includes(q));
  });

  const handleSelectAllVisible = () => {
    setSelectedImportIds((prev) => {
      const next = new Set(prev);
      for (const m of filteredImportModels) {
        if (!allModels.some((entry) => entry.id === m.id)) {
          next.add(m.id);
        }
      }
      return next;
    });
  };

  const handleDeselectAllVisible = () => {
    setSelectedImportIds((prev) => {
      const next = new Set(prev);
      for (const m of filteredImportModels) {
        next.delete(m.id);
      }
      return next;
    });
  };

  const canImport = connections.some((conn) => conn.isActive !== false);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-text-muted">
        Add {isAnthropic ? "Anthropic" : "OpenAI"}-compatible models manually or select them from the /models endpoint.
      </p>

      <div className="flex items-end gap-2 flex-wrap">
        <div className="flex-1 min-w-[240px]">
          <label htmlFor="new-compatible-model-input" className="text-xs text-text-muted mb-1 block">Model ID</label>
          <input
            id="new-compatible-model-input"
            type="text"
            value={newModel}
            onChange={(e) => setNewModel(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            placeholder={isAnthropic ? "claude-3-opus-20240229" : "gpt-4o"}
            className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary"
          />
        </div>
        <Button size="sm" icon="add" onClick={handleAdd} disabled={!newModel.trim() || adding}>
          {adding ? "Adding..." : "Add"}
        </Button>
        <Button size="sm" variant="secondary" icon="download" onClick={handleOpenImportModal} disabled={!canImport || importing}>
          {importing ? "Fetching..." : "Select from /models"}
        </Button>
      </div>

      {!canImport && (
        <p className="text-xs text-text-muted">
          Add a connection to enable selecting models from /models.
        </p>
      )}

      {/* Modal for selecting models from upstream catalog */}
      <Modal
        isOpen={showSelectModal}
        onClose={() => !savingImport && setShowSelectModal(false)}
        title={`Select Models from Provider (${availableModels.length} available)`}
        size="lg"
      >
        <div className="flex flex-col gap-3">
          <p className="text-xs text-text-muted">
            Choose the specific models you want to enable in 9Router. Only selected models will be exposed in /v1/models.
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
            <span className="font-medium text-primary">{selectedImportIds.size} selected to add</span>
          </div>

          <div className="max-h-[350px] overflow-y-auto border border-border rounded-lg divide-y divide-border/40 p-1">
            {filteredImportModels.length === 0 ? (
              <div className="text-center py-6 text-xs text-text-muted">No models match your filter</div>
            ) : (
              filteredImportModels.map((model) => {
                const alreadyAdded = allModels.some((entry) => entry.id === model.id);
                const isChecked = selectedImportIds.has(model.id);

                return (
                  <label
                    key={model.id}
                    className={`flex items-center gap-2.5 px-3 py-2 rounded text-xs cursor-pointer transition-colors ${
                      alreadyAdded
                        ? "opacity-60 bg-surface/50 cursor-not-allowed"
                        : isChecked
                          ? "bg-primary/10 text-text-main"
                          : "hover:bg-sidebar/50"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={alreadyAdded || isChecked}
                      disabled={alreadyAdded}
                      onChange={() => toggleImportModelSelection(model.id)}
                      className="rounded border-border text-primary focus:ring-primary h-3.5 w-3.5"
                    />
                    <div className="flex-1 min-w-0">
                      <span className="font-mono truncate block">{model.id}</span>
                      {model.name && model.name !== model.id && (
                        <span className="text-[10px] text-text-muted truncate block">{model.name}</span>
                      )}
                    </div>
                    {alreadyAdded && (
                      <span className="text-[10px] text-green-600 bg-green-500/10 px-1.5 py-0.5 rounded font-medium shrink-0">
                        Already added
                      </span>
                    )}
                  </label>
                );
              })
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-border">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowSelectModal(false)}
              disabled={savingImport}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSaveSelectedModels}
              disabled={savingImport || selectedImportIds.size === 0}
            >
              {savingImport ? "Adding..." : `Add Selected (${selectedImportIds.size})`}
            </Button>
          </div>
        </div>
      </Modal>

      {allModels.length > 0 && (
        <div className="flex flex-col gap-3">
          {allModels.map(({ id, alias, source }) => (
            <CompatibleModelRow
              key={`${source}-${providerStorageAlias}/${id}`}
              modelId={id}
              fullModel={`${providerDisplayAlias}/${id}`}
              copied={copied}
              onCopy={onCopy}
              onDeleteAlias={() => source === "custom" ? onDeleteCustomModel(id) : onDeleteAlias(alias)}
              onTest={connections.length > 0 ? () => handleTestModel(id) : undefined}
              testStatus={modelTestResults[id]}
              isTesting={testingModelId === id}
            />
          ))}
        </div>
      )}
    </div>
  );
}

CompatibleModelsSection.propTypes = {
  providerStorageAlias: PropTypes.string.isRequired,
  providerDisplayAlias: PropTypes.string.isRequired,
  modelAliases: PropTypes.object.isRequired,
  customModels: PropTypes.arrayOf(PropTypes.object),
  copied: PropTypes.string,
  onCopy: PropTypes.func.isRequired,
  onDeleteAlias: PropTypes.func.isRequired,
  onAddCustomModel: PropTypes.func.isRequired,
  onDeleteCustomModel: PropTypes.func.isRequired,
  connections: PropTypes.arrayOf(PropTypes.shape({
    id: PropTypes.string,
    isActive: PropTypes.bool,
  })).isRequired,
  isAnthropic: PropTypes.bool,
};
