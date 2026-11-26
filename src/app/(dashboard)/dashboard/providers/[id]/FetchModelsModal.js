"use client";

import { useState, useMemo } from "react";
import PropTypes from "prop-types";
import { Button, Modal, Input } from "@/shared/components";
import { translate } from "@/i18n/runtime";

/**
 * Fetch models from a custom compatible provider via the EXISTING server-side
 * /api/providers/[id]/models route (it already uses the connection's configured
 * Base URL + API key). Shows exact upstream IDs in a searchable checkbox list
 * and imports only the selected ones through the manual model registration.
 */
export default function FetchModelsModal({
  isOpen,
  providerStorageAlias,
  connections,
  customModels,
  modelAliases,
  onImport,
  onClose,
}) {
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState(() => new Set());

  // IDs already registered for this provider (custom rows + aliases).
  const existingModelIds = useMemo(() => {
    const ids = new Set();
    for (const m of customModels) {
      if (m.providerAlias === providerStorageAlias && (m.kind || m.type || "llm") === "llm") ids.add(m.id);
    }
    const prefix = `${providerStorageAlias}/`;
    for (const target of Object.values(modelAliases)) {
      if (typeof target === "string" && target.startsWith(prefix)) ids.add(target.slice(prefix.length));
    }
    return ids;
  }, [customModels, modelAliases, providerStorageAlias]);

  // Only models that can still be imported (not already registered).
  const importableModels = useMemo(
    () => models.filter((m) => !existingModelIds.has(m.id)),
    [models, existingModelIds]
  );

  const filteredModels = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return models;
    return models.filter((m) => m.id.toLowerCase().includes(q) || (m.name && m.name.toLowerCase().includes(q)));
  }, [models, searchQuery]);

  const filteredImportableIds = useMemo(
    () => filteredModels.filter((m) => !existingModelIds.has(m.id)).map((m) => m.id),
    [filteredModels, existingModelIds]
  );

  const allFilteredSelected = useMemo(
    () => filteredImportableIds.length > 0 && filteredImportableIds.every((id) => selectedIds.has(id)),
    [filteredImportableIds, selectedIds]
  );

  const selectedCount = useMemo(
    () => importableModels.filter((m) => selectedIds.has(m.id)).length,
    [importableModels, selectedIds]
  );

  // Only fired by the explicit "Fetch Models" button — no page-load or background fetch.
  const handleFetch = async () => {
    const connection = connections.find((conn) => conn.isActive !== false);
    if (!connection) return;

    setLoading(true);
    setError("");
    setModels([]);
    setSearchQuery("");
    setSelectedIds(new Set());

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    try {
      const res = await fetch(`/api/providers/${encodeURIComponent(connection.id)}/models`, {
        cache: "no-store",
        signal: controller.signal,
      });
      const data = await res.json().catch(() => ({}));
      clearTimeout(timeoutId);
      if (!res.ok) {
        throw new Error(data.error || `Failed to fetch models (${res.status})`);
      }
      const list = Array.isArray(data.models) ? data.models : [];
      if (list.length === 0) {
        setError(translate("No models returned from provider"));
        return;
      }
      // Keep exact upstream IDs; name is display-only. De-dupe by ID.
      const seen = new Set();
      const parsed = list
        .map((m) => (typeof m === "string" ? { id: m } : m))
        .map((m) => ({ id: m?.id || m?.model || m?.name || "", name: m?.name || "" }))
        .filter((m) => m.id && !seen.has(m.id) && seen.add(m.id));
      if (parsed.length === 0) {
        setError(translate("No valid model IDs returned"));
        return;
      }
      setModels(parsed);
      // Auto-select new models for convenience; existing ones stay disabled.
      setSelectedIds(new Set(parsed.filter((m) => !existingModelIds.has(m.id)).map((m) => m.id)));

      // Store effective base URL for consistent use in chat completions
      if (data.effectiveBaseUrl) {
        try {
          await fetch(`/api/providers/${encodeURIComponent(connection.id)}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              providerSpecificData: { effectiveBaseUrl: data.effectiveBaseUrl }
            }),
          });
        } catch (e) {
          // Non-fatal: effective base URL will be re-discovered on next fetch
          console.warn("Failed to store effective base URL:", e);
        }
      }
    } catch (err) {
      clearTimeout(timeoutId);
      setError(err.name === "AbortError" ? translate("Request timed out") : (err.message || translate("Failed to fetch models")));
    } finally {
      setLoading(false);
    }
  };

  const handleSelectAll = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) {
        filteredImportableIds.forEach((id) => next.delete(id));
      } else {
        filteredImportableIds.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  const handleToggle = (modelId) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(modelId)) next.delete(modelId);
      else next.add(modelId);
      return next;
    });
  };

  const handleImport = async () => {
    const ids = importableModels.filter((m) => selectedIds.has(m.id)).map((m) => m.id);
    if (!ids.length || loading) return;
    setLoading(true);
    setError("");
    try {
      await onImport(ids);
      onClose();
    } catch (err) {
      setError(err.message || translate("Failed to import models"));
      setLoading(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={translate("Fetch Models")} size="xl">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-text-muted">
          {translate("Fetch models from this provider's /models endpoint using its configured Base URL and API key, then choose which ones to add.")}
        </p>

        <div className="flex items-center gap-2">
          <Button variant="secondary" icon="download" loading={loading} onClick={handleFetch} disabled={!connections.some((c) => c.isActive !== false)}>
            {models.length > 0 ? translate("Re-fetch") : translate("Fetch Models")}
          </Button>
          {!connections.some((c) => c.isActive !== false) && (
            <span className="text-xs text-text-muted">{translate("Add an active API key connection first.")}</span>
          )}
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-sm break-words">
            {error}
          </div>
        )}

        {models.length > 0 && (
          <>
            <div className="flex flex-wrap items-center gap-2 justify-between">
              <Input
                icon="search"
                placeholder={translate("Search model IDs...")}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="flex-1 min-w-[180px]"
              />
              <div className="flex items-center gap-2">
                <Button size="sm" variant="ghost" onClick={handleSelectAll} disabled={filteredImportableIds.length === 0}>
                  {allFilteredSelected ? translate("Deselect All") : translate("Select All")}
                </Button>
                <span className="text-xs text-text-muted whitespace-nowrap">
                  {selectedCount} {translate("selected")}
                </span>
              </div>
            </div>

            <div className="max-h-[45vh] overflow-y-auto rounded-lg border border-border divide-y divide-border/60">
              {filteredModels.map((model) => {
                const isExisting = existingModelIds.has(model.id);
                return (
                  <label key={model.id} className={`flex items-center gap-3 px-3 py-2 ${isExisting ? "opacity-60" : "hover:bg-surface-2 cursor-pointer"}`}>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(model.id)}
                      onChange={() => handleToggle(model.id)}
                      disabled={isExisting}
                      className="h-4 w-4 rounded border-gray-300 text-brand-500 focus:ring-brand-500 disabled:opacity-50"
                    />
                    <code className="flex-1 min-w-0 truncate text-sm font-mono text-text-main">{model.id}</code>
                    {model.name && model.name !== model.id && (
                      <span className="max-w-[40%] truncate text-xs text-text-muted">{model.name}</span>
                    )}
                    {isExisting && (
                      <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                        {translate("Exists")}
                      </span>
                    )}
                  </label>
                );
              })}
              {filteredModels.length === 0 && (
                <p className="px-3 py-6 text-center text-xs text-text-muted">{translate("No models match your search.")}</p>
              )}
            </div>
          </>
        )}

        {models.length === 0 && !loading && !error && (
          <p className="py-6 text-center text-sm text-text-muted">
            {translate("Click Fetch Models to load the provider's available models.")}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose} disabled={loading}>{translate("Cancel")}</Button>
          <Button onClick={handleImport} loading={loading} disabled={selectedCount === 0}>
            {translate("Import Selected")} ({selectedCount})
          </Button>
        </div>
      </div>
    </Modal>
  );
}

FetchModelsModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  providerStorageAlias: PropTypes.string.isRequired,
  connections: PropTypes.arrayOf(PropTypes.shape({ id: PropTypes.string, isActive: PropTypes.bool })).isRequired,
  customModels: PropTypes.arrayOf(PropTypes.object).isRequired,
  modelAliases: PropTypes.object.isRequired,
  onImport: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
};
