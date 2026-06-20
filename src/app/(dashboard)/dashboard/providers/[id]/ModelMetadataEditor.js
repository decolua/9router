"use client";

import { useState, useEffect, useCallback } from "react";
import PropTypes from "prop-types";
import {
  fetchModelOverrides,
  setModelOverride,
  deleteModelOverride,
} from "@/shared/utils/modelOverridesApi";
import { getCapabilitiesForModel } from "open-sse/providers/capabilities.js";

/* ── field definitions ─────────────────────────────────────────────── */

const NUMERIC_FIELDS = [
  { key: "contextWindow", label: "Context Window", hint: "Total token context" },
  { key: "maxOutput", label: "Max Output", hint: "Max completion tokens" },
];

const BOOLEAN_FIELDS = [
  { key: "reasoning", label: "Reasoning" },
  { key: "tools", label: "Tool Use" },
  { key: "vision", label: "Vision" },
  { key: "pdf", label: "PDF" },
  { key: "audioInput", label: "Audio Input" },
  { key: "videoInput", label: "Video Input" },
  { key: "imageOutput", label: "Image Output" },
  { key: "audioOutput", label: "Audio Output" },
  { key: "search", label: "Search" },
  { key: "thinkingCanDisable", label: "Thinking Can Disable" },
];

/* ── small helpers ─────────────────────────────────────────────────── */

function formatNum(n) {
  if (n == null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return String(n);
}

/* ── sub-components ────────────────────────────────────────────────── */

function NumericField({ field, value, defaultValue, onChange }) {
  const [local, setLocal] = useState(value ?? "");
  const [error, setError] = useState(null);

  useEffect(() => {
    setLocal(value ?? "");
    setError(null);
  }, [value]);

  const commit = () => {
    if (local === "" || local === null) {
      // empty → remove field from override
      onChange(null);
      setError(null);
      return;
    }
    const n = Number(local);
    if (!Number.isInteger(n) || n < 0) {
      setError("Must be a non-negative integer");
      return;
    }
    setError(null);
    onChange(n);
  };

  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-text-muted">
        {field.label}
        {defaultValue != null && (
          <span className="ml-1 font-normal text-text-muted/60">
            (default: {formatNum(defaultValue)})
          </span>
        )}
      </label>
      <input
        type="number"
        min={0}
        step={1}
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && commit()}
        placeholder={defaultValue != null ? String(defaultValue) : "—"}
        className="w-full max-w-[180px] rounded border border-border bg-background px-2 py-1 text-sm focus:outline-none focus:border-primary"
      />
      {error && <span className="text-[11px] text-red-500">{error}</span>}
    </div>
  );
}

function BooleanField({ field, value, defaultValue, onChange }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer select-none">
      <input
        type="checkbox"
        checked={!!value}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-border accent-primary"
      />
      <span className="text-xs font-medium text-text-muted">
        {field.label}
        {defaultValue != null && (
          <span className="ml-1 font-normal text-text-muted/60">
            (default: {defaultValue ? "on" : "off"})
          </span>
        )}
      </span>
    </label>
  );
}

/* ── per-model card ────────────────────────────────────────────────── */

function ModelOverrideCard({ modelId, fullModel, providerAlias, override, defaults, onSave, onDelete }) {
  const [draft, setDraft] = useState(() => ({ ...override }));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // Sync when override prop changes (e.g. after delete)
  useEffect(() => {
    setDraft({ ...override });
    setDirty(false);
    setError(null);
  }, [override]);

  const setField = (key, val) => {
    setDraft((prev) => {
      const next = { ...prev };
      if (val === null || val === undefined) {
        delete next[key]; // remove from override → reverts to default
      } else {
        next[key] = val;
      }
      return next;
    });
    setDirty(true);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave(modelId, draft);
      setDirty(false);
    } catch (err) {
      setError(err.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setSaving(true);
    setError(null);
    try {
      await onDelete(modelId);
    } catch (err) {
      setError(err.message || "Reset failed");
    } finally {
      setSaving(false);
    }
  };

  const hasOverride = override && Object.keys(override).length > 0;

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <code className="truncate rounded bg-sidebar px-1.5 py-0.5 font-mono text-xs text-text-muted">
          {fullModel}
        </code>
        {hasOverride && (
          <button
            onClick={handleDelete}
            disabled={saving}
            className="shrink-0 rounded px-2 py-0.5 text-[11px] text-text-muted transition-colors hover:bg-red-500/10 hover:text-red-500 disabled:opacity-50"
            title="Reset to defaults"
          >
            Reset to Default
          </button>
        )}
      </div>

      {/* Limits */}
      <div className="mb-3">
        <p className="mb-1.5 text-[10px] uppercase tracking-wider text-text-muted/50">Limits</p>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          {NUMERIC_FIELDS.map((f) => (
            <NumericField
              key={f.key}
              field={f}
              value={draft[f.key]}
              defaultValue={defaults[f.key]}
              onChange={(v) => setField(f.key, v)}
            />
          ))}
        </div>
      </div>

      {/* Capabilities */}
      <div className="mb-3">
        <p className="mb-1.5 text-[10px] uppercase tracking-wider text-text-muted/50">Capabilities</p>
        <div className="flex flex-wrap gap-x-5 gap-y-1.5">
          {BOOLEAN_FIELDS.map((f) => (
            <BooleanField
              key={f.key}
              field={f}
              value={draft[f.key]}
              defaultValue={defaults[f.key]}
              onChange={(v) => setField(f.key, v)}
            />
          ))}
        </div>
      </div>

      {/* Actions */}
      {dirty && (
        <div className="flex items-center gap-2 mt-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded bg-primary px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          {error && <span className="text-[11px] text-red-500">{error}</span>}
        </div>
      )}
    </div>
  );
}

ModelOverrideCard.propTypes = {
  modelId: PropTypes.string.isRequired,
  fullModel: PropTypes.string.isRequired,
  providerAlias: PropTypes.string.isRequired,
  override: PropTypes.object,
  defaults: PropTypes.object,
  onSave: PropTypes.func.isRequired,
  onDelete: PropTypes.func.isRequired,
};

/* ── main component ────────────────────────────────────────────────── */

export default function ModelMetadataEditor({ providerAlias, models }) {
  const [open, setOpen] = useState(false);
  const [overrides, setOverrides] = useState({});
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchModelOverrides(providerAlias);
      setOverrides(data);
    } catch {
      // silently ignore — UI stays usable with empty overrides
    } finally {
      setLoading(false);
    }
  }, [providerAlias]);

  // Fetch on mount and when provider changes
  useEffect(() => {
    load();
  }, [load]);

  const handleSave = async (modelId, draft) => {
    const saved = await setModelOverride(providerAlias, modelId, draft);
    setOverrides((prev) => ({ ...prev, [modelId]: saved }));
  };

  const handleDelete = async (modelId) => {
    await deleteModelOverride(providerAlias, modelId);
    setOverrides((prev) => {
      const next = { ...prev };
      delete next[modelId];
      return next;
    });
  };

  const activeCount = Object.keys(overrides).length;

  return (
    <div className="rounded-lg border border-border">
      {/* Header / toggle */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-sidebar/50"
      >
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-base text-text-muted">
            tune
          </span>
          <span className="text-sm font-medium">Model Metadata</span>
          {activeCount > 0 && (
            <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
              {activeCount} override{activeCount !== 1 && "s"}
            </span>
          )}
        </div>
        <span className="material-symbols-outlined text-base text-text-muted transition-transform" style={{ transform: open ? "rotate(180deg)" : undefined }}>
          expand_more
        </span>
      </button>

      {/* Body */}
      {open && (
        <div className="border-t border-border px-4 py-3">
          {loading ? (
            <p className="text-xs text-text-muted">Loading overrides…</p>
          ) : models.length === 0 ? (
            <p className="text-xs text-text-muted">No models to configure.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {models.map((m) => {
                const modelId = m.id;
                const fullModel = `${providerAlias}/${modelId}`;
                // Compute defaults from hardcoded capabilities
                const caps = getCapabilitiesForModel(providerAlias, modelId);
                const defaults = {
                  contextWindow: caps.contextWindow,
                  maxOutput: caps.maxOutput,
                  reasoning: caps.reasoning,
                  tools: caps.tools,
                  vision: caps.vision,
                  pdf: caps.pdf,
                  audioInput: caps.audioInput,
                  videoInput: caps.videoInput,
                  imageOutput: caps.imageOutput,
                  audioOutput: caps.audioOutput,
                  search: caps.search,
                  thinkingCanDisable: caps.thinkingCanDisable,
                };
                return (
                  <ModelOverrideCard
                    key={modelId}
                    modelId={modelId}
                    fullModel={fullModel}
                    providerAlias={providerAlias}
                    override={overrides[modelId] || {}}
                    defaults={defaults}
                    onSave={handleSave}
                    onDelete={handleDelete}
                  />
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

ModelMetadataEditor.propTypes = {
  providerAlias: PropTypes.string.isRequired,
  models: PropTypes.arrayOf(
    PropTypes.shape({ id: PropTypes.string.isRequired })
  ).isRequired,
};
