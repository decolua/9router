"use client";

import { useState, useEffect, useMemo } from "react";
import PropTypes from "prop-types";
import { Modal, Button } from "@/shared/components";

// Generic "import models from the provider's /models endpoint" modal.
// Fetches GET /api/providers/{connectionId}/models, lets the user pick models
// (already-added ones are shown disabled), and bulk-adds the selection as
// custom models via POST /api/models/custom/bulk.
export default function ImportModelsModal({
  isOpen,
  onClose,
  connectionId,
  providerStorageAlias,
  existingIds,
  transformId,
  onImported,
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [models, setModels] = useState([]);
  const [selected, setSelected] = useState(() => new Set());
  const [search, setSearch] = useState("");
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (!isOpen || !connectionId) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    setWarning("");
    setModels([]);
    setSelected(new Set());
    setSearch("");
    setResult(null);

    fetch(`/api/providers/${connectionId}/models`, { cache: "no-store" })
      .then(async (res) => ({ ok: res.ok, data: await res.json() }))
      .then(({ ok, data }) => {
        if (cancelled) return;
        if (!ok) {
          setError(data.error || "Failed to fetch models");
          return;
        }
        const seen = new Set();
        const normalized = [];
        for (const m of data.models || []) {
          let id = m?.id || m?.name || m?.model;
          if (!id) continue;
          if (transformId) id = transformId(id);
          if (!id || seen.has(id)) continue;
          seen.add(id);
          normalized.push({ id, name: m?.name && m.name !== m.id && m.name !== id ? m.name : null });
        }
        setModels(normalized);
        if (data.warning) setWarning(data.warning);
        if (normalized.length === 0 && !data.warning) setWarning("Provider returned 0 models");
      })
      .catch((e) => { if (!cancelled) setError(e.message || "Network error"); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [isOpen, connectionId, transformId]);

  const rows = useMemo(
    () => models.map((m) => ({ ...m, added: existingIds?.has(m.id) === true })),
    [models, existingIds]
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((m) => m.id.toLowerCase().includes(q) || (m.name || "").toLowerCase().includes(q));
  }, [rows, search]);

  const selectable = visible.filter((m) => !m.added);
  const allVisibleSelected = selectable.length > 0 && selectable.every((m) => selected.has(m.id));

  const toggleAll = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        for (const m of selectable) next.delete(m.id);
      } else {
        for (const m of selectable) next.add(m.id);
      }
      return next;
    });
  };

  const toggleOne = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleImport = async () => {
    if (importing || selected.size === 0) return;
    setImporting(true);
    setError("");
    try {
      const res = await fetch("/api/models/custom/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerAlias: providerStorageAlias, type: "llm", ids: [...selected] }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Import failed");
        return;
      }
      setResult(data);
      if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("customModelChanged"));
      onImported?.();
    } catch (e) {
      setError(e.message || "Network error");
    } finally {
      setImporting(false);
    }
  };

  return (
    <Modal isOpen={isOpen} title="Import Models from Provider" onClose={onClose}>
      <div className="flex flex-col gap-3">
        {result ? (
          <>
            <p className="text-sm text-text-main">
              Imported {result.added} model{result.added === 1 ? "" : "s"}
              {result.skipped > 0 ? `, ${result.skipped} already existed` : ""}.
            </p>
            <Button onClick={onClose} fullWidth>Done</Button>
          </>
        ) : (
          <>
            {error && <p className="text-xs text-red-500 break-words">{error}</p>}
            {warning && !error && <p className="text-xs text-amber-600 dark:text-amber-400 break-words">{warning}</p>}

            {loading ? (
              <p className="text-sm text-text-muted py-6 text-center">
                <span className="material-symbols-outlined text-sm align-middle mr-1" style={{ animation: "spin 1s linear infinite" }}>progress_activity</span>
                Fetching models from provider...
              </p>
            ) : models.length > 0 && (
              <>
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search models..."
                  className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary"
                />
                <label className="flex cursor-pointer items-center gap-1.5 text-xs text-text-muted hover:text-primary">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={toggleAll}
                    className="h-3.5 w-3.5 rounded border-gray-300 text-primary focus:ring-primary"
                  />
                  Select All ({selectable.length} available{visible.length !== rows.length ? `, ${visible.length} shown` : ""})
                </label>
                <div className="flex max-h-72 flex-col gap-1 overflow-y-auto custom-scrollbar pr-1">
                  {visible.map((m) => (
                    <label
                      key={m.id}
                      className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs ${m.added ? "border-border opacity-50" : "border-border hover:border-primary/40 cursor-pointer"}`}
                    >
                      <input
                        type="checkbox"
                        checked={m.added || selected.has(m.id)}
                        disabled={m.added}
                        onChange={() => toggleOne(m.id)}
                        className="h-3.5 w-3.5 rounded border-gray-300 text-primary focus:ring-primary"
                      />
                      <span className="min-w-0 flex-1 truncate font-mono">{m.id}</span>
                      {m.name && <span className="truncate text-text-muted/70 italic">{m.name}</span>}
                      {m.added && <span className="shrink-0 text-[10px] text-text-muted">added</span>}
                    </label>
                  ))}
                  {visible.length === 0 && (
                    <p className="py-4 text-center text-xs text-text-muted">No models match the search</p>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button onClick={handleImport} fullWidth disabled={selected.size === 0 || importing}>
                    {importing ? "Importing..." : `Import Selected (${selected.size})`}
                  </Button>
                  <Button onClick={onClose} variant="ghost" fullWidth disabled={importing}>Cancel</Button>
                </div>
              </>
            )}

            {!loading && models.length === 0 && !error && (
              <Button onClick={onClose} variant="ghost" fullWidth>Close</Button>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

ImportModelsModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  connectionId: PropTypes.string,
  providerStorageAlias: PropTypes.string.isRequired,
  existingIds: PropTypes.instanceOf(Set),
  transformId: PropTypes.func,
  onImported: PropTypes.func,
};
