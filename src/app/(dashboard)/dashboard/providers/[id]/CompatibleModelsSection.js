"use client";

import { useState } from "react";
import { readModelTestResult } from "@/shared/utils/modelTestResult";
import PropTypes from "prop-types";
import { Button, CapacityBadges } from "@/shared/components";
import { getProviderCustomModelRows } from "@/shared/utils/providerCustomModels";
import ModelMetaChips, { MODEL_CHIP_CLASS } from "./ModelMetaChips";
import AddToComboButton from "./AddToComboButton";
import DetectMetaButton from "./DetectMetaButton";

function CompatibleModelRow({ modelId, fullModel, copied, onCopy, onDeleteAlias, onTest, testStatus, isTesting, comboNames = [], selectable = false, selected = false, onToggleSelect, providerId, caps, combos, onComboChanged }) {
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
      {selectable && (
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          aria-label={`Select ${modelId}`}
          className="h-3.5 w-3.5 shrink-0 rounded border-gray-300 text-primary focus:ring-primary"
        />
      )}
      <span
        className="material-symbols-outlined text-[18px]! text-text-muted"
        style={iconColor ? { color: iconColor } : undefined}
      >
        {testStatus === "ok" ? "check_circle" : testStatus === "error" ? "cancel" : "smart_toy"}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-0.5">
          <AddToComboButton fullModel={fullModel} combos={combos} comboNames={comboNames} onChanged={onComboChanged} />
          <p className="min-w-0 break-all text-sm font-medium sm:truncate sm:break-normal">{modelId}</p>
        </div>
        {comboNames.length > 0 && (
          <span className={`${MODEL_CHIP_CLASS} mt-0.5 max-w-full border-primary/25 bg-primary/10 text-primary`} title={`Used in: ${comboNames.join(", ")}`}>
            <span className="material-symbols-outlined text-[12px]!">layers</span>
            <span className="truncate">{comboNames.slice(0, 2).join(", ")}{comboNames.length > 2 ? ` +${comboNames.length - 2}` : ""}</span>
          </span>
        )}
        {caps && (
          <span className="mt-0.5 flex flex-wrap items-center gap-1">
            <ModelMetaChips caps={caps} />
            <CapacityBadges caps={{ ...caps, reasoning: false }} colorOverride="text-text-muted/70" size={14} />
          </span>
        )}
        <div className="flex min-w-0 flex-wrap items-center gap-1 mt-1">
          <code className="min-w-0 break-all rounded bg-sidebar px-1.5 py-0.5 font-mono text-xs text-text-muted">{fullModel}</code>
          <div className="relative group/btn">
            <button
              onClick={() => onCopy(fullModel, `model-${modelId}`)}
              className="p-0.5 hover:bg-sidebar rounded text-text-muted hover:text-primary"
            >
              <span className="material-symbols-outlined text-[17px]!">
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
                <span className="material-symbols-outlined text-[17px]!" style={isTesting ? { animation: "spin 1s linear infinite" } : undefined}>
                  {isTesting ? "progress_activity" : "science"}
                </span>
              </button>
              <span className="pointer-events-none absolute top-5 left-1/2 -translate-x-1/2 text-[10px] text-text-muted whitespace-nowrap opacity-0 group-hover/btn:opacity-100 transition-opacity">
                {isTesting ? "Testing..." : "Test"}
              </span>
            </div>
          )}
          {providerId && (
            <DetectMetaButton
              providerId={providerId}
              modelId={modelId}
              buttonClassName="p-0.5 hover:bg-sidebar rounded text-text-muted hover:text-primary transition-colors"
            />
          )}
        </div>
      </div>
      <button
        onClick={onDeleteAlias}
        className="p-1 hover:bg-red-50 rounded text-red-500"
        title="Remove model"
      >
        <span className="material-symbols-outlined text-[17px]!">delete</span>
      </button>
    </div>
  );
}

export default function CompatibleModelsSection({ providerStorageAlias, providerDisplayAlias, modelAliases, customModels, copied, onCopy, onDeleteAlias, onAddCustomModel, onDeleteCustomModel, onBulkDeleteCustomModels, connections, isAnthropic, comboNamesFor, candidatesForModelId, onImportModels, providerId, getCaps, combos, onComboChanged }) {
  const [newModel, setNewModel] = useState("");
  const [adding, setAdding] = useState(false);
  const [testingModelId, setTestingModelId] = useState(null);
  const [modelTestResults, setModelTestResults] = useState({});
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());

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
      const { status } = readModelTestResult(data);
      setModelTestResults((prev) => ({ ...prev, [modelId]: status }));
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

  const canImport = connections.some((conn) => conn.isActive !== false);

  const toggleSelected = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    const rows = allModels.filter((model) => selectedIds.has(model.id));
    await onBulkDeleteCustomModels(rows);
    setSelectedIds(new Set());
    setSelecting(false);
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-text-muted">
        Add {isAnthropic ? "Anthropic" : "OpenAI"}-compatible models manually or import them from the /models endpoint.
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
        <Button
          size="sm"
          variant="ghost"
          icon="download"
          onClick={onImportModels}
          disabled={!canImport}
          title={canImport ? undefined : "Add a connection first"}
          className="border border-blue-500/40 text-blue-600 dark:text-blue-400 hover:bg-blue-500/5"
        >
          Import models
        </Button>
        {allModels.length > 0 && (
          <Button
            size="sm"
            variant={selecting ? "secondary" : "ghost"}
            icon="checklist"
            onClick={() => {
              setSelecting((prev) => !prev);
              setSelectedIds(new Set());
            }}
          >
            {selecting ? "Cancel" : "Select"}
          </Button>
        )}
        {selecting && allModels.length > 0 && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              if (selectedIds.size === allModels.length) setSelectedIds(new Set());
              else setSelectedIds(new Set(allModels.map((model) => model.id)));
            }}
          >
            {selectedIds.size === allModels.length ? "Clear" : "Select all"}
          </Button>
        )}
        {selecting && selectedIds.size > 0 && (
          <Button size="sm" variant="danger" icon="delete" onClick={handleBulkDelete}>
            Delete {selectedIds.size}
          </Button>
        )}
      </div>

      {!canImport && (
        <p className="text-xs text-text-muted">
          Add a connection to enable importing models.
        </p>
      )}

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
              comboNames={comboNamesFor(candidatesForModelId(id))}
              selectable={selecting}
              selected={selectedIds.has(id)}
              onToggleSelect={() => toggleSelected(id)}
              providerId={providerId}
              caps={getCaps?.(`${providerStorageAlias}/${id}`)}
              combos={combos}
              onComboChanged={onComboChanged}
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
  onBulkDeleteCustomModels: PropTypes.func.isRequired,
  connections: PropTypes.arrayOf(PropTypes.shape({
    id: PropTypes.string,
    isActive: PropTypes.bool,
  })).isRequired,
  isAnthropic: PropTypes.bool,
  comboNamesFor: PropTypes.func.isRequired,
  candidatesForModelId: PropTypes.func.isRequired,
  onImportModels: PropTypes.func.isRequired,
  providerId: PropTypes.string,
  getCaps: PropTypes.func,
  combos: PropTypes.arrayOf(PropTypes.object),
  onComboChanged: PropTypes.func,
};
