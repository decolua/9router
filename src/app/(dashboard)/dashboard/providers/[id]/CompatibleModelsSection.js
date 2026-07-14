"use client";

import { useState, useRef, useEffect } from "react";
import PropTypes from "prop-types";
import { Button, ConfirmModal } from "@/shared/components";
import { getProviderCustomModelRows } from "@/shared/utils/providerCustomModels";
import { useMultiSelect } from "@/shared/hooks/useMultiSelect";

function CompatibleModelRow({ modelId, fullModel, copied, onCopy, onDeleteAlias, onTest, testStatus, deleteStatus, isTesting, checkbox }) {
  const borderColor = deleteStatus === "deleting"
    ? "border-orange-500/40"
    : testStatus === "ok"
    ? "border-green-500/40"
    : testStatus === "error"
    ? "border-red-500/40"
    : testStatus === "testing"
    ? "border-blue-500/40"
    : "border-border";
  console.log(`[COMPAT Row ${fullModel}] testStatus:`, testStatus, "deleteStatus:", deleteStatus, "borderColor:", borderColor);

  const iconColor = deleteStatus === "deleting"
    ? "#f97316"
    : testStatus === "ok"
    ? "#22c55e"
    : testStatus === "error"
    ? "#ef4444"
    : undefined;

  return (
    <div className={`flex items-center gap-3 p-3 rounded-lg border ${borderColor} hover:bg-sidebar/50`}>
      {checkbox}
      <span
        className="material-symbols-outlined text-base text-text-muted"
        style={iconColor ? { color: iconColor } : undefined}
      >
        {deleteStatus === "deleting" ? "delete" : testStatus === "ok" ? "check_circle" : testStatus === "error" ? "cancel" : "smart_toy"}
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

export default function CompatibleModelsSection({ providerStorageAlias, providerDisplayAlias, modelAliases, customModels, copied, onCopy, onDeleteAlias, onAddCustomModel, onDeleteCustomModel, onRefresh, connections, isAnthropic }) {
  const [newModel, setNewModel] = useState("");
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [testingModelId, setTestingModelId] = useState(null);
  const [modelTestResults, setModelTestResults] = useState({});
  const [confirmState, setConfirmState] = useState(null);
  const [bulkTesting, setBulkTesting] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [deleteStatus, setDeleteStatus] = useState({});

  const abortControllerRef = useRef(null);
  const confirmFiredRef = useRef(false);

  useEffect(() => {
    return () => { abortControllerRef.current?.abort(); };
  }, []);

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

  const { selectedIds, selectedItems, allSelected, toggleItem, toggleAll, clearSelection } = useMultiSelect(allModels, "id");

  const selectedItemsRef = useRef(selectedItems);
  useEffect(() => { selectedItemsRef.current = selectedItems; }, [selectedItems]);

  const handleBulkDelete = () => {
    if (bulkDeleting || selectedItems.length === 0) return;
    if (bulkTesting) return;
    setConfirmState({
      title: "Delete Compatible Models",
      message: `Delete ${selectedItems.length} selected model(s)?`,
      onConfirm: async () => {
        if (confirmFiredRef.current) return; confirmFiredRef.current = true;
        setConfirmState(null);
        setBulkDeleting(true);
        const currentSelected = selectedItemsRef.current;
        setDeleteStatus(Object.fromEntries(currentSelected.map(m => [m.id, "deleting"])));
        try {
          let ok = 0; let failed = 0;
          for (const model of currentSelected) {
            try {
              if (model.source === "custom") {
                const params = new URLSearchParams({ providerAlias: providerStorageAlias, id: model.id, type: "llm" });
                const res = await fetch(`/api/models/custom?${params}`, { method: "DELETE" });
                if (res.ok) { ok++; } else { failed++; }
              } else if (model.alias) {
                const res = await fetch(`/api/models/alias?alias=${encodeURIComponent(model.alias)}`, { method: "DELETE" });
                if (res.ok) { ok++; } else { failed++; }
              } else {
                failed++;
              }
            } catch (err) { console.error("Delete failed:", model.id, err); failed++; }
          }
          if (ok > 0) await onRefresh();
        } finally {
          clearSelection();
          setDeleteStatus({});
          setBulkDeleting(false);
          confirmFiredRef.current = false;
        }
      },
    });
  };

  const readSSEStream = async (response, onResult) => {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const json = line.slice(6);
            try {
              const data = JSON.parse(json);
              if (data.done || data.error) {
                if (!data.done) onResult(data);
              } else {
                onResult(data);
              }
            } catch (err) {
              console.error("SSE parse error:", err);
            }
          }
        }
      }
      if (buffer.trim()) {
        const line = buffer.trim();
        if (line.startsWith("data: ")) {
          try {
            const data = JSON.parse(line.slice(6));
            if (!data.done) onResult(data);
          } catch (err) {
            console.error("SSE parse error:", err);
          }
        }
      }
    } finally {
      try { reader.releaseLock(); } catch {}
    }
  };

  const handleCancelBulkTest = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  };

  const handleBulkTest = async () => {
    if (bulkTesting || selectedItems.length === 0) return;
    if (bulkDeleting) return;
    if (selectedItems.length > 200) return;
    const currentSelected = selectedItemsRef.current;
    setBulkTesting(true);
    const abortCtrl = new AbortController();
    abortControllerRef.current = abortCtrl;

    setModelTestResults(prev => {
      const updated = { ...prev };
      currentSelected.forEach(m => { updated[m.id] = "testing"; });
      return updated;
    });

    try {
      const models = currentSelected.map((m) => ({
        model: `${providerStorageAlias}/${m.id}`,
        kind: "llm",
      }));
      const res = await fetch("/api/models/test/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ models }),
        signal: abortCtrl.signal,
      });

      if (!res.ok) {
        setModelTestResults(prev => {
          const updated = { ...prev };
          currentSelected.forEach(m => {
            if (updated[m.id] === "testing") delete updated[m.id];
          });
          return updated;
        });
        return;
      }

      await readSSEStream(res, (result) => {
        if (result.model) {
          const modelId = result.model.substring(result.model.lastIndexOf("/") + 1);
          const status = result.ok ? "ok" : "error";
          console.log(`[COMPAT SSE result] modelId: ${modelId} status: ${status} rawModel: ${result.model}`);
          setModelTestResults(prev => ({ ...prev, [modelId]: status }));
        } else if (result.error) {
          console.error("Batch test server error:", result.error);
        }
      });

      setModelTestResults(prev => {
        console.log(`[COMPAT SSE cleanup] entries:`, Object.entries(prev).map(([k,v]) => `${k}=${v}`).join(", "));
        const updated = { ...prev };
        let changed = false;
        for (const key in updated) {
          if (updated[key] === "testing") { delete updated[key]; changed = true; }
        }
        console.log(`[COMPAT SSE cleanup] after:`, Object.entries(updated).map(([k,v]) => `${k}=${v}`).join(", "));
        return changed ? updated : prev;
      });
    } catch (err) {
      if (err.name !== "AbortError") console.error("Bulk test failed:", err);
      setModelTestResults(prev => {
        const updated = { ...prev };
        currentSelected.forEach(m => {
          if (updated[m.id] === "testing") delete updated[m.id];
        });
        return updated;
      });
    } finally {
      setBulkTesting(false);
      abortControllerRef.current = null;
    }
  };

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

      {!canImport && (
        <p className="text-xs text-text-muted">
          Add a connection to enable importing models.
        </p>
      )}

      {allModels.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-text-muted cursor-pointer">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleAll}
                className="size-4 rounded border-black/20 dark:border-white/20"
              />
              {allSelected ? "Unselect all" : "Select all"}
            </label>
          </div>

          {selectedIds.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
              <span className="material-symbols-outlined text-[18px] text-primary">checklist</span>
              <span className="text-xs font-medium text-primary">{selectedIds.length} selected</span>
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <Button size="sm" variant="secondary" icon="delete" onClick={handleBulkDelete} disabled={bulkDeleting}>
                  Delete Selected ({selectedIds.length})
                </Button>
                {connections.length > 0 && (
                  bulkTesting ? (
                    <Button size="sm" variant="ghost" icon="close" onClick={handleCancelBulkTest}>
                      Cancel
                    </Button>
                  ) : (
                    <Button size="sm" variant="ghost" onClick={handleBulkTest}>
                      Test Selected ({selectedIds.length})
                    </Button>
                  )
                )}
                <Button size="sm" variant="ghost" onClick={clearSelection}>
                  Clear
                </Button>
              </div>
            </div>
          )}

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
                deleteStatus={deleteStatus[id]}
                isTesting={testingModelId === id}
                checkbox={
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(id)}
                    onChange={() => toggleItem(id)}
                    className="size-4 shrink-0 rounded border-black/20 dark:border-white/20"
                  />
                }
              />
            ))}
          </div>
        </>
      )}

      <ConfirmModal
        isOpen={!!confirmState}
        onClose={() => setConfirmState(null)}
        onConfirm={confirmState?.onConfirm}
        title={confirmState?.title || "Confirm"}
        message={confirmState?.message}
        variant="danger"
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
  onAddCustomModel: PropTypes.func.isRequired,
  onDeleteCustomModel: PropTypes.func.isRequired,
  onRefresh: PropTypes.func.isRequired,
  connections: PropTypes.arrayOf(PropTypes.shape({
    id: PropTypes.string,
    isActive: PropTypes.bool,
  })).isRequired,
  isAnthropic: PropTypes.bool,
};
