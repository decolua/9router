"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PropTypes from "prop-types";
import ProviderIcon from "./ProviderIcon";
import { useOrcaRouterCatalog } from "@/shared/hooks/useOrcaRouterCatalog";
import { ORCA_PICKER_CAPABILITIES, orcaCatalogQuery, pruneOrcaSelection, supportsImageFilter } from "@/shared/utils/orcaCatalogPicker";

/**
 * OrcaRouter model picker — an anchored dropdown whose every option comes from
 * the capability-scoped catalog endpoint.
 *
 * The API key never reaches this component: `/api/providers/[id]/models` holds
 * it server-side and returns model metadata only. The list is recomputed when
 * the provider changes, when the capability changes and when the image filter is
 * toggled; a selection the new slice no longer contains is cleared.
 */
export default function OrcaModelDropdown({
  connectionIds = [],
  capability: initialCapability = "chat",
  selectedModel = "",
  onSelect,
  onClear,
  label = "OrcaRouter model",
}) {
  const [open, setOpen] = useState(false);
  const [capability, setCapability] = useState(initialCapability);
  const [imageOnly, setImageOnly] = useState(false);
  const [search, setSearch] = useState("");
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const panelRef = useRef(null);

  // A non-chat slice cannot be narrowed by input modality, so the filter is
  // cleared when the capability changes rather than silently sending a
  // meaningless `modality=image`.
  const selectCapability = useCallback((next) => {
    setCapability(next);
    if (!supportsImageFilter(next)) setImageOnly(false);
    setSearch("");
  }, []);

  const idsKey = (connectionIds ?? []).join("|");
  const catalog = useOrcaRouterCatalog(open, connectionIds, capability, imageOnly ? "image" : null);

  const options = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return catalog.models;
    return catalog.models.filter(
      (model) =>
        (model.name || "").toLowerCase().includes(query) ||
        (model.id || "").toLowerCase().includes(query)
    );
  }, [catalog.models, search]);

  // Recompute on every slice change: a model that is no longer offered by the
  // current capability/modality must be dropped, not kept as an invalid value.
  useEffect(() => {
    if (!onClear) return;
    if (!catalog.loaded || catalog.models.length === 0) return;
    if (selectedModel && pruneOrcaSelection(catalog.models, selectedModel) === null) {
      onClear(selectedModel);
    }
  }, [catalog.models, catalog.loaded, selectedModel, onClear]);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const handleSelect = useCallback((model) => {
    onSelect?.(model.id);
    setOpen(false);
  }, [onSelect]);

  const requestQuery = orcaCatalogQuery({ capability, imageOnly });
  const noConnections = !idsKey;

  return (
    <div className="relative" ref={rootRef} data-testid="orca-model-picker">
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs font-medium text-text-main" htmlFor="orca-capability">Capability</label>
        <select
          id="orca-capability"
          value={capability}
          onChange={(event) => selectCapability(event.target.value)}
          data-testid="orca-capability-select"
          className="rounded-md border border-border bg-background px-2 py-1 text-xs focus:border-primary focus:outline-none"
        >
          {ORCA_PICKER_CAPABILITIES.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>

        {supportsImageFilter(capability) && (
          <label className="flex items-center gap-1.5 text-xs text-text-muted">
            <input
              type="checkbox"
              checked={imageOnly}
              onChange={(event) => setImageOnly(event.target.checked)}
              data-testid="orca-image-only"
            />
            Images
          </label>
        )}

        {/* The panel is anchored to the trigger itself, so its right edge tracks
            the control the user clicked rather than the whole toolbar row. */}
        <div className="relative" ref={triggerRef}>
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-haspopup="listbox"
            data-testid="orca-model-trigger"
            className="flex min-w-[220px] items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs text-text-main hover:border-primary/50"
          >
            <span className="truncate">{selectedModel || "Select an OrcaRouter model"}</span>
            <span className="material-symbols-outlined text-[16px] text-text-muted">expand_more</span>
          </button>

          {open && (
            <div
              ref={panelRef}
              data-testid="orca-model-panel"
              role="listbox"
              aria-label={label}
              className="absolute right-0 top-full z-50 mt-2 w-[360px] overflow-hidden rounded-xl border border-border bg-surface shadow-2xl"
            >
              <div className="border-b border-border-subtle px-3 py-2">
                <input
                  type="text"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search..."
                  data-testid="orca-model-search"
                  className="w-full rounded border border-border bg-background px-2 py-1 text-xs focus:border-primary focus:outline-none"
                />
                <p className="mt-1 text-[10px] text-text-muted" data-testid="orca-catalog-status">
                  {catalog.live
                    ? `Live catalog · ${catalog.models.length} models`
                    : catalog.degraded
                      ? "Live catalog unavailable — verified offline list"
                      : "Loading…"}
                </p>
              </div>

              <div className="max-h-[320px] overflow-y-auto p-1.5">
                {options.map((model) => (
                  <button
                    key={model.id}
                    type="button"
                    role="option"
                    aria-selected={selectedModel === model.id}
                    onClick={() => handleSelect(model)}
                    data-testid="orca-model-option"
                    className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors ${
                      selectedModel === model.id ? "bg-primary/10 text-primary" : "text-text-main hover:bg-surface-2"
                    }`}
                  >
                    <ProviderIcon src="/providers/orcarouter.png" alt="OrcaRouter" size={14} fallbackText="OR" fallbackColor="#6366F1" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{model.name}</span>
                      <span className="block truncate font-mono text-[10px] text-text-muted">{model.id}</span>
                    </span>
                  </button>
                ))}

                {options.length === 0 && (
                  <p className="px-3 py-4 text-center text-xs text-text-muted" data-testid="orca-model-empty">
                    {noConnections
                      ? "Add an OrcaRouter connection first."
                      : catalog.loaded
                        ? "No OrcaRouter models match this capability or input type."
                        : "Loading models…"}
                  </p>
                )}
              </div>

              <div className="flex items-center justify-between border-t border-border-subtle px-3 py-2">
                <code className="truncate font-mono text-[10px] text-text-muted">{requestQuery}</code>
                <button
                  type="button"
                  onClick={() => catalog.refresh()}
                  data-testid="orca-catalog-refresh"
                  className="text-[11px] text-text-muted underline hover:text-primary"
                >
                  Refresh
                </button>
              </div>
            </div>
          )}
        </div>

        {selectedModel && (
          <button
            type="button"
            onClick={() => onClear?.(selectedModel)}
            data-testid="orca-model-clear"
            className="text-xs text-text-muted underline hover:text-primary"
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}

OrcaModelDropdown.propTypes = {
  connectionIds: PropTypes.arrayOf(PropTypes.string),
  capability: PropTypes.string,
  selectedModel: PropTypes.string,
  onSelect: PropTypes.func,
  onClear: PropTypes.func,
  label: PropTypes.string,
};
