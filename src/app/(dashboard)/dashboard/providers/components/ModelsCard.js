"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useNotificationStore } from "@/store/notificationStore";
import PropTypes from "prop-types";
import { Card, Button, Modal, ConfirmModal } from "@/shared/components";
import { getModelsByProviderId, getModelKind } from "@/shared/constants/models";
import { getProviderAlias } from "@/shared/constants/providers";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { useMultiSelect } from "@/shared/hooks/useMultiSelect";

// ── ModelRow ───────────────────────────────────────────────────
export function ModelRow({ model, fullModel, copied, onCopy, testStatus, isCustom, isFree, onDeleteAlias, onTest, isTesting, checkbox, isDeleting }) {
  const borderColor = isDeleting ? "border-border" : testStatus === "ok" ? "border-green-500/40" : testStatus === "error" ? "border-red-500/40" : testStatus === "testing" ? "border-blue-500/40" : "border-border";
  const iconColor = isDeleting ? undefined : testStatus === "ok" ? "#22c55e" : testStatus === "error" ? "#ef4444" : undefined;
  console.log(`[ModelRow ${fullModel}] isDeleting:`, isDeleting, "testStatus:", testStatus, "borderColor:", borderColor, "iconColor:", iconColor);

  return (
    <div className={`group px-3 py-2 rounded-lg border ${borderColor} hover:bg-sidebar/50`}>
      <div className="flex items-center gap-2">
        {checkbox}
        <span className="material-symbols-outlined text-base" style={iconColor ? { color: iconColor } : undefined}>
          {isDeleting ? "smart_toy" : testStatus === "ok" ? "check_circle" : testStatus === "error" ? "cancel" : "smart_toy"}
        </span>
        <div className="flex flex-col gap-1">
          <code className="text-xs text-text-muted font-mono bg-sidebar px-1.5 py-0.5 rounded">{fullModel}</code>
          {model.name && <span className="text-[9px] text-text-muted/70 italic pl-1">{model.name}</span>}
        </div>
        {onTest && (
          <div className="relative group/btn">
            <button onClick={onTest} disabled={isTesting} className={`p-0.5 hover:bg-sidebar rounded text-text-muted hover:text-primary transition-opacity ${isTesting ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
              <span className="material-symbols-outlined text-sm" style={isTesting ? { animation: "spin 1s linear infinite" } : undefined}>
                {isTesting ? "progress_activity" : "science"}
              </span>
            </button>
            <span className="pointer-events-none absolute mt-1 top-5 left-1/2 -translate-x-1/2 text-[10px] text-text-muted whitespace-nowrap opacity-0 group-hover/btn:opacity-100 transition-opacity">
              {isTesting ? "Testing..." : "Test"}
            </span>
          </div>
        )}
        <div className="relative group/btn">
          <button onClick={() => onCopy(fullModel, `model-${model.id}`)} className="p-0.5 hover:bg-sidebar rounded text-text-muted hover:text-primary">
            <span className="material-symbols-outlined text-sm">{copied === `model-${model.id}` ? "check" : "content_copy"}</span>
          </button>
          <span className="pointer-events-none absolute mt-1 top-5 left-1/2 -translate-x-1/2 text-[10px] text-text-muted whitespace-nowrap opacity-0 group-hover/btn:opacity-100 transition-opacity">
            {copied === `model-${model.id}` ? "Copied!" : "Copy"}
          </span>
        </div>
        {isFree && <span className="text-[10px] font-bold text-green-500 bg-green-500/10 px-1.5 py-0.5 rounded">FREE</span>}
        {isCustom && (
          <button onClick={onDeleteAlias} className="p-0.5 hover:bg-red-500/10 rounded text-text-muted hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity ml-auto" title="Remove custom model">
            <span className="material-symbols-outlined text-sm">close</span>
          </button>
        )}
      </div>
    </div>
  );
}

ModelRow.propTypes = {
  model: PropTypes.shape({ id: PropTypes.string.isRequired }).isRequired,
  fullModel: PropTypes.string.isRequired,
  copied: PropTypes.string,
  onCopy: PropTypes.func.isRequired,
  testStatus: PropTypes.oneOf(["ok", "error", "testing"]),
  isCustom: PropTypes.bool,
  isFree: PropTypes.bool,
  onDeleteAlias: PropTypes.func,
  onTest: PropTypes.func,
  isTesting: PropTypes.bool,
  isDeleting: PropTypes.bool,
  checkbox: PropTypes.node,
};

// ── AddCustomModelModal ────────────────────────────────────────
function AddCustomModelModal({ isOpen, onSave, onClose }) {
  const [modelId, setModelId] = useState("");

  const handleSave = () => {
    if (!modelId.trim()) return;
    onSave(modelId.trim());
    setModelId("");
  };

  return (
    <Modal isOpen={isOpen} title="Add Custom Model" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div>
          <label className="text-xs text-text-muted mb-1 block">Model ID</label>
          <input
            className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary"
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSave()}
            placeholder="e.g. tts-1-hd"
            autoFocus
          />
        </div>
        <div className="flex gap-2">
          <Button onClick={handleSave} fullWidth disabled={!modelId.trim()}>Add</Button>
          <Button onClick={onClose} variant="ghost" fullWidth>Cancel</Button>
        </div>
      </div>
    </Modal>
  );
}

AddCustomModelModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onSave: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
};

// ── ModelsCard ─────────────────────────────────────────────────
// Self-contained card: shows models for a provider, filtered by optional `kindFilter`.
// kindFilter: if provided, only shows models with matching type/kinds field.
export default function ModelsCard({ providerId, kindFilter, providerAliasOverride }) {
  const { copied, copy } = useCopyToClipboard();
  const [modelAliases, setModelAliases] = useState({});
  const [customModels, setCustomModels] = useState([]);
  const [modelTestResults, setModelTestResults] = useState({});
  const [testingModelId, setTestingModelId] = useState(null);
  const [testingBulk, setTestingBulk] = useState(false);
  const [testError, setTestError] = useState("");
  const [showAddCustomModel, setShowAddCustomModel] = useState(false);
  const [connections, setConnections] = useState([]);
  const [confirmState, setConfirmState] = useState(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const abortControllerRef = useRef(null);
  const confirmFiredRef = useRef(false);
  const deleteToastIdRef = useRef(null);

  useEffect(() => {
    return () => { abortControllerRef.current?.abort(); };
  }, []);

  const providerAlias = providerAliasOverride || getProviderAlias(providerId);
  const effectiveType = kindFilter || "llm";

  const fetchData = useCallback(async () => {
    try {
      const [aliasRes, connRes, customRes] = await Promise.all([
        fetch("/api/models/alias"),
        fetch("/api/providers", { cache: "no-store" }),
        fetch("/api/models/custom", { cache: "no-store" }),
      ]);
      const aliasData = await aliasRes.json();
      const connData = await connRes.json();
      const customData = await customRes.json();
      if (aliasRes.ok) setModelAliases(aliasData.aliases || {});
      if (connRes.ok) setConnections((connData.connections || []).filter((c) => c.provider === providerId));
      if (customRes.ok) setCustomModels(customData.models || []);
    } catch (e) { console.log("ModelsCard fetch error:", e); }
  }, [providerId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleSetAlias = async (modelId, alias) => {
    const fullModel = `${providerAlias}/${modelId}`;
    try {
      const res = await fetch("/api/models/alias", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: fullModel, alias }),
      });
      if (res.ok) await fetchData();
    } catch (e) { console.log("set alias error:", e); }
  };

  const handleDeleteAlias = async (alias) => {
    try {
      const res = await fetch(`/api/models/alias?alias=${encodeURIComponent(alias)}`, { method: "DELETE" });
      if (res.ok) await fetchData();
    } catch (e) { console.log("delete alias error:", e); }
  };

  const handleAddCustomModel = async (modelId) => {
    try {
      const res = await fetch("/api/models/custom", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerAlias, id: modelId, type: effectiveType }),
      });
      if (res.ok) {
        await fetchData();
        window.dispatchEvent(new CustomEvent("customModelChanged"));
      }
    } catch (e) { console.log("add custom model error:", e); }
  };

  const handleDeleteCustomModel = async (modelId) => {
    try {
      const params = new URLSearchParams({ providerAlias, id: modelId, type: effectiveType });
      const res = await fetch(`/api/models/custom?${params}`, { method: "DELETE" });
      if (res.ok) {
        await fetchData();
        window.dispatchEvent(new CustomEvent("customModelChanged"));
      }
    } catch (e) { console.log("delete custom model error:", e); }
  };

  const handleTestModel = async (modelId) => {
    if (testingModelId) return;
    console.log("[Test] handleTestModel called for:", modelId, "| providerAlias:", providerAlias);
    console.log("[Test] bulkDeleting state:", bulkDeleting, "| isDeleting would be:", !!bulkDeleting);
    setTestingModelId(modelId);
    try {
      const res = await fetch("/api/models/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: `${providerAlias}/${modelId}`, kind: kindFilter }),
      });
      const data = await res.json();
      console.log("[Test] API response for", modelId, ":", data);
      const status = data.ok ? "ok" : "error";
      setModelTestResults((prev) => {
        console.log("[Test] setting modelTestResults for", modelId, "to", status);
        console.log("[Test] prev modelTestResults:", prev);
        return { ...prev, [modelId]: status };
      });
      setTestError(data.ok ? "" : (data.error || "Model not reachable"));
    } catch {
      console.log("[Test] catch block - network error for", modelId);
      setModelTestResults((prev) => ({ ...prev, [modelId]: "error" }));
      setTestError("Network error");
    } finally { setTestingModelId(null); }
  };

  // Built-in models — filter by kindFilter if provided
  const allBuiltIn = getModelsByProviderId(providerId);
  const builtInModels = kindFilter
    ? allBuiltIn.filter((m) => {
        if (m.kinds) return m.kinds.includes(kindFilter);
        return getModelKind(m, "llm") === kindFilter;
      })
    : allBuiltIn;

  // Custom models for this provider + kind, dedupe vs built-in
  const myCustomModels = customModels.filter(
    (m) => m.providerAlias === providerAlias
      && getModelKind(m, "llm") === effectiveType
      && !builtInModels.some((b) => b.id === m.id)
  );

  const displayModels = builtInModels;

  const keyedCustomModels = useMemo(() =>
    myCustomModels.map(m => ({ ...m, _key: `${m.providerAlias}:${m.id}:${m.type}` })),
    [myCustomModels]
  );
  const { selectedIds, selectedItems, allSelected, toggleItem, toggleAll, clearSelection } = useMultiSelect(keyedCustomModels, "_key");

  const selectedItemsRef = useRef(selectedItems);
  useEffect(() => { selectedItemsRef.current = selectedItems; }, [selectedItems]);

  const handleBulkDelete = () => {
    if (bulkDeleting || selectedItems.length === 0) return;
    if (testingBulk) return;
    if (testingModelId) return;
    setConfirmState({
      title: "Delete Custom Models",
      message: `Delete ${selectedItems.length} custom model(s)?`,
      onConfirm: async () => {
        if (confirmFiredRef.current) return; confirmFiredRef.current = true;
        setConfirmState(null);
        setBulkDeleting(true);
        const currentSelected = selectedItemsRef.current;
        const total = currentSelected.length;
        let ok = 0;
        let failed = 0;

        // Show progress toast
        const notify = useNotificationStore.getState();
        console.log("[BulkDelete] adding progress toast, total:", total);
        console.log("[BulkDelete] notifications before:", notify.notifications.length);
        deleteToastIdRef.current = notify.addNotification({
          type: "info",
          message: `Proses delete model 0/${total}`,
          dismissible: false,
          duration: 0,
        });
        console.log("[BulkDelete] toast added, id:", deleteToastIdRef.current);
        console.log("[BulkDelete] notifications after:", useNotificationStore.getState().notifications.length);

        try {
          for (let i = 0; i < total; i++) {
            const model = currentSelected[i];
            try {
              const params = new URLSearchParams({ providerAlias: model.providerAlias, id: model.id, type: model.type });
              const res = await fetch(`/api/models/custom?${params}`, { method: "DELETE" });
              if (res.ok) ok++; else failed++;
            } catch (err) { console.error("Delete failed:", model.id, err); failed++; }
            // Update toast progress
            if (deleteToastIdRef.current !== null) {
              notify.removeNotification(deleteToastIdRef.current);
            }
            deleteToastIdRef.current = notify.addNotification({
              type: "info",
              message: `Proses delete model ${i + 1}/${total}`,
              dismissible: false,
              duration: 0,
            });
          }
          if (ok > 0) window.dispatchEvent(new CustomEvent("customModelChanged"));
          await fetchData();
        } finally {
          // Remove progress toast
          const state = useNotificationStore.getState();
          if (deleteToastIdRef.current !== null) {
            state.removeNotification(deleteToastIdRef.current);
            deleteToastIdRef.current = null;
          }
          // Show result toast
          if (failed === 0) {
            state.success(`Berhasil hapus ${ok} model`);
          } else if (ok > 0) {
            state.warning(`Berhasil hapus ${ok} model, ${failed} gagal`);
          } else {
            state.error(`Gagal hapus ${failed} model`);
          }
          clearSelection();
          setBulkDeleting(false);
          confirmFiredRef.current = false;
        }
      }
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
            try {
              const data = JSON.parse(line.slice(6));
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
    if (testingBulk || selectedItems.length === 0) return;
    if (bulkDeleting) return;
    const currentSelected = selectedItemsRef.current;
    if (currentSelected.length > 200) return;
    setTestingBulk(true);
    const abortCtrl = new AbortController();
    abortControllerRef.current = abortCtrl;

    setModelTestResults(prev => {
      const updated = { ...prev };
      currentSelected.forEach(m => { updated[m.id] = "testing"; });
      return updated;
    });

    try {
      const models = currentSelected.map(model => ({
        model: `${model.providerAlias}/${model.id}`,
        kind: model.type || "llm",
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
          setModelTestResults(prev => ({ ...prev, [modelId]: status }));
        } else if (result.error) {
          console.error("Batch test server error:", result.error);
        }
      });

      setModelTestResults(prev => {
        const updated = { ...prev };
        let changed = false;
        for (const key in updated) {
          if (updated[key] === "testing") { delete updated[key]; changed = true; }
        }
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
      setTestingBulk(false);
      abortControllerRef.current = null;
    }
  };

  return (
    <>
      <Card>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Models{kindFilter ? ` — ${kindFilter.toUpperCase()}` : ""}</h2>
        </div>
        {testError && <p className="text-xs text-red-500 mb-3 break-words">{testError}</p>}

        {myCustomModels.length > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-2">
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
        )}

        {selectedIds.length > 0 && (
          <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
            <span className="material-symbols-outlined text-[18px] text-primary">checklist</span>
            <span className="text-xs font-medium text-primary">{selectedIds.length} selected</span>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              {testingBulk ? (
                <Button size="sm" variant="ghost" icon="close" onClick={handleCancelBulkTest}>
                  Cancel
                </Button>
              ) : (
                <Button size="sm" variant="secondary" icon="science" onClick={handleBulkTest}>
                  Test Selected ({selectedIds.length})
                </Button>
              )}
              <Button size="sm" variant="secondary" icon="delete" onClick={handleBulkDelete} disabled={bulkDeleting}>
                Delete Selected ({selectedIds.length})
              </Button>
              <Button size="sm" variant="ghost" onClick={clearSelection}>
                Clear
              </Button>
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-3">
          {displayModels.map((model) => {
            const fullModel = `${providerAlias}/${model.id}`;
            const existingAlias = Object.entries(modelAliases).find(([, m]) => m === fullModel)?.[0];
            return (
              <ModelRow
                key={model.id}
                model={model}
                fullModel={`${providerAlias}/${model.id}`}
                alias={existingAlias}
                copied={copied}
                onCopy={copy}
                onSetAlias={(alias) => handleSetAlias(model.id, alias)}
                onDeleteAlias={() => handleDeleteAlias(existingAlias)}
                testStatus={modelTestResults[model.id]}
                onTest={connections.length > 0 ? () => handleTestModel(model.id) : undefined}
                isTesting={testingModelId === model.id}
                isFree={model.isFree}
                isDeleting={bulkDeleting}
              />
            );
          })}

          {keyedCustomModels.map((model) => (
              <ModelRow
                key={model._key}
                model={{ id: model.id, name: model.name }}
                fullModel={`${providerAlias}/${model.id}`}
                copied={copied}
                onCopy={copy}
                onSetAlias={() => {}}
                onDeleteAlias={() => handleDeleteCustomModel(model.id)}
                testStatus={modelTestResults[model.id]}
                onTest={connections.length > 0 ? () => handleTestModel(model.id) : undefined}
                isTesting={testingModelId === model.id}
                isCustom
                isDeleting={bulkDeleting}
                checkbox={
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(model._key)}
                    onChange={() => toggleItem(model._key)}
                    className="size-4 shrink-0 rounded border-black/20 dark:border-white/20"
                  />
                }
              />
          ))}

          <button
            onClick={() => setShowAddCustomModel(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-dashed border-black/15 dark:border-white/15 text-xs text-text-muted hover:text-primary hover:border-primary/40 transition-colors"
          >
            <span className="material-symbols-outlined text-sm">add</span>
            Add Model
          </button>
        </div>
      </Card>

      <AddCustomModelModal
        isOpen={showAddCustomModel}
        onSave={async (modelId) => {
          await handleAddCustomModel(modelId);
          setShowAddCustomModel(false);
        }}
        onClose={() => setShowAddCustomModel(false)}
      />

      <ConfirmModal
        isOpen={!!confirmState}
        onClose={() => setConfirmState(null)}
        onConfirm={confirmState?.onConfirm}
        title={confirmState?.title || "Confirm"}
        message={confirmState?.message}
        variant="danger"
      />
    </>
  );
}

ModelsCard.propTypes = {
  providerId: PropTypes.string.isRequired,
  kindFilter: PropTypes.string, // e.g. "tts", "embedding" — filters models shown
  providerAliasOverride: PropTypes.string, // override alias (e.g. for custom-embedding nodes using prefix)
};
