"use client";

import { useState } from "react";
import PropTypes from "prop-types";
import { Button, CapacityBadges, Modal, ConfirmModal } from "@/shared/components";
import { getProviderCustomModelRows } from "@/shared/utils/providerCustomModels";
import { CUSTOM_MODEL_CAP_OPTIONS, EMPTY_CUSTOM_MODEL_CAPS } from "@/shared/constants/customModelCaps";

// Edit modal — rename a custom model's id and toggle its capabilities.
// State is seeded from `model` at mount; the caller remounts (via key) per model
// so no reset effect is needed.
function EditCustomModelModal({ isOpen, model, onSave, onClose }) {
  const [modelId, setModelId] = useState(() => model?.id || "");
  const [caps, setCaps] = useState(() => ({ ...EMPTY_CUSTOM_MODEL_CAPS, ...(model?.caps || {}) }));
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    const trimmed = modelId.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    const changes = { caps: { ...caps } };
    if (trimmed !== model.id) changes.newId = trimmed;
    const ok = await onSave(changes);
    setSaving(false);
    if (ok) onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Edit Custom Model">
      <div className="flex flex-col gap-4">
        <div>
          <label className="text-sm font-medium mb-1.5 block">Model ID</label>
          <input
            type="text"
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSave()}
            className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary"
            autoFocus
          />
        </div>
        <div>
          <label className="text-sm font-medium mb-1.5 block">Capabilities</label>
          <div className="grid grid-cols-2 gap-2">
            {CUSTOM_MODEL_CAP_OPTIONS.map((opt) => (
              <label key={opt.key} className="flex items-center gap-2 text-sm cursor-pointer select-none" title={opt.desc}>
                <input
                  type="checkbox"
                  checked={!!caps[opt.key]}
                  onChange={(e) => setCaps((prev) => ({ ...prev, [opt.key]: e.target.checked }))}
                  className="w-4 h-4 accent-primary"
                />
                <span className="material-symbols-outlined text-base text-text-muted">{opt.icon}</span>
                {opt.label}
              </label>
            ))}
          </div>
        </div>
        <div className="flex gap-2 pt-1">
          <Button onClick={onClose} variant="ghost" fullWidth size="sm">Cancel</Button>
          <Button onClick={handleSave} fullWidth size="sm" disabled={!modelId.trim() || saving}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

EditCustomModelModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  model: PropTypes.object,
  onSave: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
};

function CompatibleModelRow({ modelId, fullModel, caps, copied, onCopy, onDeleteAlias, onEdit, onTest, testStatus, isTesting }) {
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
        <div className="flex items-center gap-2 min-w-0">
          <p className="text-sm font-medium truncate">{modelId}</p>
          <CapacityBadges caps={caps} size={14} />
        </div>
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
      {onEdit && (
        <button
          onClick={onEdit}
          className="p-1 hover:bg-sidebar rounded text-text-muted hover:text-primary"
          title="Edit model"
        >
          <span className="material-symbols-outlined text-sm">edit</span>
        </button>
      )}
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

export default function CompatibleModelsSection({ providerStorageAlias, providerDisplayAlias, modelAliases, customModels, copied, onCopy, onDeleteAlias, onAddCustomModel, onDeleteCustomModel, onUpdateCustomModel, onClearCustomModels, connections, isAnthropic }) {
  const [newModel, setNewModel] = useState("");
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [testingModelId, setTestingModelId] = useState(null);
  const [modelTestResults, setModelTestResults] = useState({});
  const [caps, setCaps] = useState(() => ({ ...EMPTY_CUSTOM_MODEL_CAPS }));
  const [editModel, setEditModel] = useState(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);

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
  const customCount = allModels.filter((m) => m.source === "custom").length;

  const handleAdd = async () => {
    if (!newModel.trim() || adding) return;
    const modelId = newModel.trim();
    if (allModels.some((model) => model.id === modelId)) {
      alert("Model already exists for this provider.");
      return;
    }

    setAdding(true);
    try {
      await onAddCustomModel(modelId, { ...caps });
      setNewModel("");
      setCaps({ ...EMPTY_CUSTOM_MODEL_CAPS });
    } catch (error) {
      console.log("Error adding model:", error);
    } finally {
      setAdding(false);
    }
  };

  const handleImport = async () => {
    if (importing) return;
    const activeConnection = connections.find((conn) => conn.isActive !== false);
    if (!activeConnection) return;

    setImporting(true);
    try {
      const res = await fetch(`/api/providers/${activeConnection.id}/models`);
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Failed to import models");
        return;
      }
      const models = data.models || [];
      if (models.length === 0) {
        alert("No models returned from /models.");
        return;
      }
      let importedCount = 0;
      for (const model of models) {
        const modelId = model.id || model.name || model.model;
        if (!modelId) continue;
        if (allModels.some((entry) => entry.id === modelId)) continue;
        await onAddCustomModel(modelId);
        importedCount += 1;
      }
      if (importedCount === 0) {
        alert("No new models were added.");
      }
    } catch (error) {
      console.log("Error importing models:", error);
    } finally {
      setImporting(false);
    }
  };

  const canImport = connections.some((conn) => conn.isActive !== false);

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
        <Button size="sm" variant="secondary" icon="download" onClick={handleImport} disabled={!canImport || importing}>
          {importing ? "Importing..." : "Import from /models"}
        </Button>
      </div>

      {/* Capabilities for the model being added — tell 9Router what this model can
          read/emit so the runtime resolver lifts it above the text-only default. */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {CUSTOM_MODEL_CAP_OPTIONS.map((opt) => (
            <label key={opt.key} className="flex items-center gap-2 text-sm cursor-pointer select-none" title={opt.desc}>
              <input
                type="checkbox"
                checked={!!caps[opt.key]}
                onChange={(e) => setCaps((prev) => ({ ...prev, [opt.key]: e.target.checked }))}
                className="w-4 h-4 accent-primary"
              />
              <span className="material-symbols-outlined text-base text-text-muted">{opt.icon}</span>
              {opt.label}
            </label>
          ))}
        </div>
        <span className="text-xs text-text-muted">Applied to the model added via the Model ID field above.</span>
      </div>

      {!canImport && (
        <p className="text-xs text-text-muted">
          Add a connection to enable importing models.
        </p>
      )}

      {allModels.length > 0 && (
        <>
          <div className="flex items-center justify-between">
            <span className="text-xs text-text-muted">{allModels.length} model{allModels.length === 1 ? "" : "s"}</span>
            {onClearCustomModels && customCount > 0 && (
              <Button
                size="sm"
                variant="ghost"
                icon="delete_sweep"
                onClick={() => setConfirmClear(true)}
                disabled={clearing}
                className="text-red-500 hover:bg-red-500/10"
              >
                {clearing ? "Clearing..." : "Clear All"}
              </Button>
            )}
          </div>
          <div className="flex flex-col gap-3">
            {allModels.map(({ id, alias, source, caps: rowCaps }) => (
              <CompatibleModelRow
                key={`${source}-${providerStorageAlias}/${id}`}
                modelId={id}
                fullModel={`${providerDisplayAlias}/${id}`}
                caps={rowCaps}
                copied={copied}
                onCopy={onCopy}
                onDeleteAlias={() => source === "custom" ? onDeleteCustomModel(id) : onDeleteAlias(alias)}
                onEdit={source === "custom" && onUpdateCustomModel ? () => setEditModel({ id, caps: rowCaps || {} }) : undefined}
                onTest={connections.length > 0 ? () => handleTestModel(id) : undefined}
                testStatus={modelTestResults[id]}
                isTesting={testingModelId === id}
              />
            ))}
          </div>
        </>
      )}

      {editModel && (
        <EditCustomModelModal
          key={editModel.id}
          isOpen
          model={editModel}
          onSave={async (changes) => {
            const ok = await onUpdateCustomModel(editModel.id, changes);
            return ok !== false;
          }}
          onClose={() => setEditModel(null)}
        />
      )}

      <ConfirmModal
        isOpen={confirmClear}
        title="Clear all custom models?"
        message={`This removes all ${customCount} custom model${customCount === 1 ? "" : "s"} you added for this provider. This cannot be undone.`}
        confirmText="Clear All"
        variant="danger"
        loading={clearing}
        onConfirm={async () => {
          setClearing(true);
          await onClearCustomModels();
          setClearing(false);
          setConfirmClear(false);
        }}
        onClose={() => setConfirmClear(false)}
      />
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
  onAddCustomModel: PropTypes.func.isRequired, // (modelId, caps?) => Promise
  onDeleteCustomModel: PropTypes.func.isRequired,
  onUpdateCustomModel: PropTypes.func, // (modelId, { newId?, caps? }) => Promise<boolean>
  onClearCustomModels: PropTypes.func, // () => Promise<boolean>
  connections: PropTypes.arrayOf(PropTypes.shape({
    id: PropTypes.string,
    isActive: PropTypes.bool,
  })).isRequired,
  isAnthropic: PropTypes.bool,
};
