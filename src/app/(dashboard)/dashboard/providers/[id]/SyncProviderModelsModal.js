"use client";

import { useEffect, useMemo, useState } from "react";
import PropTypes from "prop-types";
import { Button, Modal } from "@/shared/components";

function normalizeModel(item) {
  if (!item) return null;
  if (typeof item === "string") return { id: item, name: item };
  const id = item.id || item.modelId || item.model || item.name;
  if (!id) return null;
  return {
    id,
    name: item.name || item.modelName || item.displayName || id,
    description: item.description || "",
    maxInputTokens: item.maxInputTokens || item.contextLength || item.contextWindow || 0,
  };
}

function defaultAlias(modelId, passthroughModels) {
  return passthroughModels ? modelId.split("/").pop() : modelId;
}

export default function SyncProviderModelsModal({
  isOpen,
  connections,
  existingModelIds,
  providerDisplayAlias,
  passthroughModels,
  onAddModels,
  onClose,
}) {
  const activeConnections = useMemo(
    () => connections.filter((conn) => conn.isActive !== false),
    [connections]
  );
  const [connectionId, setConnectionId] = useState("");
  const [models, setModels] = useState([]);
  const [selected, setSelected] = useState({});
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    setConnectionId(activeConnections[0]?.id || "");
    setModels([]);
    setSelected({});
    setQuery("");
    setError("");
    setWarning("");
  }, [activeConnections, isOpen]);

  const fetchModels = async (id = connectionId) => {
    if (!id || loading) return;
    setLoading(true);
    setError("");
    setWarning("");
    try {
      const res = await fetch(`/api/providers/${id}/models`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || `HTTP ${res.status}`);
        return;
      }
      const nextModels = (data.models || []).map(normalizeModel).filter(Boolean);
      setModels(nextModels);
      setSelected({});
      setWarning(data.warning || "");
      if (nextModels.length === 0 && !data.warning) setWarning("Upstream returned an empty model list.");
    } catch (err) {
      setError(err.message || "Failed to sync models");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && connectionId) fetchModels(connectionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, connectionId]);

  const existingSet = useMemo(() => new Set(existingModelIds), [existingModelIds]);
  const filteredModels = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return models;
    return models.filter((model) =>
      [model.id, model.name, model.description].some((value) =>
        String(value || "").toLowerCase().includes(term)
      )
    );
  }, [models, query]);

  const selectedModels = useMemo(
    () => models.filter((model) => selected[model.id] && !existingSet.has(model.id)),
    [existingSet, models, selected]
  );

  const toggleModel = (modelId) => {
    if (existingSet.has(modelId)) return;
    setSelected((prev) => ({ ...prev, [modelId]: !prev[modelId] }));
  };

  const selectAllVisible = () => {
    const next = { ...selected };
    filteredModels.forEach((model) => {
      if (!existingSet.has(model.id)) next[model.id] = true;
    });
    setSelected(next);
  };

  const clearSelection = () => setSelected({});

  const handleAdd = async () => {
    if (selectedModels.length === 0 || saving) return;
    setSaving(true);
    setError("");
    try {
      await onAddModels(selectedModels.map((model) => ({
        id: model.id,
        alias: defaultAlias(model.id, passthroughModels),
      })));
      onClose();
    } catch (err) {
      setError(err.message || "Failed to add selected models");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Sync Upstream Models" size="full">
      <div className="flex max-h-[72vh] flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <div>
            <label className="mb-1 block text-xs text-text-muted">Connection</label>
            <select
              value={connectionId}
              onChange={(event) => setConnectionId(event.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none"
            >
              {activeConnections.map((conn) => (
                <option key={conn.id} value={conn.id}>
                  {conn.name || conn.email || conn.id}
                </option>
              ))}
            </select>
          </div>
          <Button
            size="sm"
            variant="secondary"
            icon="sync"
            loading={loading}
            onClick={() => fetchModels()}
            disabled={!connectionId || loading}
          >
            {loading ? "Syncing..." : "Refresh"}
          </Button>
        </div>

        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center">
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search model id or name"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none"
          />
          <Button size="sm" variant="ghost" icon="done_all" onClick={selectAllVisible} disabled={filteredModels.length === 0}>
            Select Visible
          </Button>
          <Button size="sm" variant="ghost" icon="close" onClick={clearSelection} disabled={selectedModels.length === 0}>
            Clear
          </Button>
        </div>

        {error && <p className="break-words rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-500">{error}</p>}
        {warning && !error && <p className="break-words rounded-lg border border-yellow-500/20 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-600 dark:text-yellow-400">{warning}</p>}

        <div className="min-h-[220px] overflow-y-auto rounded-lg border border-border">
          {loading ? (
            <div className="flex h-56 items-center justify-center text-sm text-text-muted">
              <span className="material-symbols-outlined mr-2 animate-spin text-[18px]">progress_activity</span>
              Syncing upstream models...
            </div>
          ) : filteredModels.length === 0 ? (
            <div className="flex h-56 items-center justify-center text-sm text-text-muted">
              No upstream models to show.
            </div>
          ) : (
            <div className="divide-y divide-border">
              {filteredModels.map((model) => {
                const exists = existingSet.has(model.id);
                const checked = !!selected[model.id] && !exists;
                return (
                  <button
                    key={model.id}
                    type="button"
                    onClick={() => toggleModel(model.id)}
                    disabled={exists}
                    className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-sidebar/60 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <span className={`flex h-5 w-5 items-center justify-center rounded border text-[13px] ${checked ? "border-primary bg-primary text-white" : "border-border text-transparent"}`}>
                      <span className="material-symbols-outlined text-[14px]">check</span>
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-text-main">{model.id}</span>
                      <span className="mt-0.5 flex flex-wrap gap-x-2 gap-y-1 text-xs text-text-muted">
                        <span className="truncate">{model.name}</span>
                        {model.maxInputTokens > 0 && <span>{Math.round(model.maxInputTokens / 1000)}K ctx</span>}
                      </span>
                    </span>
                    <span className="rounded bg-sidebar px-1.5 py-0.5 font-mono text-[11px] text-text-muted">
                      {exists ? "added" : `${providerDisplayAlias}/${model.id}`}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-border-subtle pt-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-text-muted">
            {models.length} upstream model{models.length === 1 ? "" : "s"} · {selectedModels.length} selected
          </p>
          <div className="grid grid-cols-2 gap-2 sm:flex">
            <Button size="sm" variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button size="sm" icon="add" onClick={handleAdd} loading={saving} disabled={selectedModels.length === 0 || saving}>
              {saving ? "Adding..." : "Add Selected"}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

SyncProviderModelsModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  connections: PropTypes.arrayOf(PropTypes.shape({
    id: PropTypes.string,
    name: PropTypes.string,
    email: PropTypes.string,
    isActive: PropTypes.bool,
  })).isRequired,
  existingModelIds: PropTypes.arrayOf(PropTypes.string).isRequired,
  providerDisplayAlias: PropTypes.string.isRequired,
  passthroughModels: PropTypes.bool,
  onAddModels: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
};
