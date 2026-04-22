"use client";

import { useEffect, useMemo, useState } from "react";
import PropTypes from "prop-types";
import Modal from "@/shared/components/Modal";
import Button from "@/shared/components/Button";
import { buildGroupedSelectableModels } from "@/lib/opencodeSync/modelSelectOptions";

function buildComboKey(combo, index) {
  const idPart = typeof combo?.id === "string" && combo.id ? combo.id : JSON.stringify(combo?.id ?? combo?.name ?? index);
  return `combo:${idPart}:${combo?.name || index}`;
}

function buildModelKey(providerId, model, index) {
  return `provider:${providerId}:${model?.value || model?.id || model?.name || index}:${index}`;
}

export default function OpenCodeModelSelectModal({
  isOpen,
  onClose,
  onSelect,
  selectedModel,
  selectedModels,
  activeProviders = [],
  title = "Select Model",
  modelAliases = {},
  multiSelect = false,
  confirmLabel,
  enabledModels,
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [combos, setCombos] = useState([]);
  const [providerNodes, setProviderNodes] = useState([]);

  const normalizedSelectedModels = useMemo(() => {
    if (Array.isArray(selectedModels)) return selectedModels.filter(Boolean);
    if (selectedModel) return [selectedModel];
    return [];
  }, [selectedModel, selectedModels]);

  const [pendingSelection, setPendingSelection] = useState(() => normalizedSelectedModels);

  const enabledModelSet = useMemo(() => {
    if (!Array.isArray(enabledModels) || enabledModels.length === 0) return null;
    return new Set(enabledModels.filter(Boolean));
  }, [enabledModels]);

  useEffect(() => {
    if (!isOpen) return undefined;

    let cancelled = false;

    async function loadPickerData() {
      try {
        const [combosRes, providerNodesRes] = await Promise.all([
          fetch("/api/combos"),
          fetch("/api/provider-nodes"),
        ]);

        const [combosData, providerNodesData] = await Promise.all([
          combosRes.ok ? combosRes.json() : Promise.resolve({ combos: [] }),
          providerNodesRes.ok ? providerNodesRes.json() : Promise.resolve({ nodes: [] }),
        ]);

        if (cancelled) return;

        setCombos(Array.isArray(combosData?.combos) ? combosData.combos : []);
        setProviderNodes(Array.isArray(providerNodesData?.nodes) ? providerNodesData.nodes : []);
      } catch {
        if (cancelled) return;
        setCombos([]);
        setProviderNodes([]);
      }
    }

    void loadPickerData();

    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const groupedModels = useMemo(() => {
    return buildGroupedSelectableModels({ activeProviders, modelAliases, providerNodes });
  }, [activeProviders, modelAliases, providerNodes]);

  const filteredCombos = useMemo(() => {
    if (!searchQuery.trim()) return combos;
    const query = searchQuery.toLowerCase();
    return combos.filter((combo) => String(combo?.name || "").toLowerCase().includes(query));
  }, [combos, searchQuery]);

  const filteredGroups = useMemo(() => {
    if (!searchQuery.trim()) return groupedModels;

    const query = searchQuery.toLowerCase();
    const filtered = {};

    Object.entries(groupedModels).forEach(([providerId, group]) => {
      const matchedModels = (group.models || []).filter((model) => {
        const name = String(model?.name || "").toLowerCase();
        const id = String(model?.id || "").toLowerCase();
        const value = String(model?.value || "").toLowerCase();
        return name.includes(query) || id.includes(query) || value.includes(query);
      });

      const providerNameMatches = String(group?.name || "").toLowerCase().includes(query);

      if (matchedModels.length > 0 || providerNameMatches) {
        filtered[providerId] = {
          ...group,
          models: matchedModels,
        };
      }
    });

    return filtered;
  }, [groupedModels, searchQuery]);

  const handleClose = () => {
    onClose();
    setSearchQuery("");
    setPendingSelection([]);
  };

  const handleSelect = (model) => {
    const nextValue = model?.value;
    if (!nextValue || (enabledModelSet && !enabledModelSet.has(nextValue))) return;

    if (multiSelect) {
      setPendingSelection((current) => (
        current.includes(nextValue) ? current.filter((value) => value !== nextValue) : [...current, nextValue]
      ));
      return;
    }

    onSelect(model);
    handleClose();
  };

  const handleConfirm = () => {
    if (!multiSelect || pendingSelection.length === 0) return;
    onSelect(
      pendingSelection.map((value) => ({
        id: value,
        name: value,
        value,
      }))
    );
    handleClose();
  };

  const footer = multiSelect ? (
    <>
      <Button variant="ghost" onClick={handleClose}>
        Cancel
      </Button>
      <Button onClick={handleConfirm} disabled={pendingSelection.length === 0}>
        {confirmLabel || `Add ${pendingSelection.length} model${pendingSelection.length === 1 ? "" : "s"}`}
      </Button>
    </>
  ) : null;

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={title} size="md" className="p-4!" footer={footer}>
      <div className="mb-3">
        <div className="relative">
          <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-[16px] text-text-muted">
            search
          </span>
          <input
            type="text"
            placeholder="Search..."
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            className="w-full rounded border border-border bg-surface py-1.5 pl-8 pr-3 text-xs focus:outline-none focus:ring-1 focus:ring-primary/50"
          />
        </div>
      </div>

      <div className="max-h-[400px] space-y-3 overflow-y-auto">
        {filteredCombos.length > 0 ? (
          <div>
            <div className="sticky top-0 mb-1.5 flex items-center gap-1.5 bg-surface py-0.5">
              <span className="material-symbols-outlined text-[14px] text-primary">layers</span>
              <span className="text-xs font-medium text-primary">Combos</span>
              <span className="text-[10px] text-text-muted">({filteredCombos.length})</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {filteredCombos.map((combo, index) => {
                const comboName = String(combo?.name || "");
                const isSelected = multiSelect ? pendingSelection.includes(comboName) : selectedModel === comboName;
                const isDisabled = enabledModelSet ? !enabledModelSet.has(comboName) : false;

                return (
                  <button
                    key={buildComboKey(combo, index)}
                    type="button"
                    disabled={isDisabled}
                    onClick={() => handleSelect({ id: comboName, name: comboName, value: comboName })}
                    className={[
                      "rounded-xl border px-2 py-1 text-xs font-medium transition-all hover:cursor-pointer",
                      isDisabled
                        ? "cursor-not-allowed border-border bg-black/[0.03] text-text-muted opacity-50 dark:bg-white/[0.04]"
                        : isSelected
                        ? "border-primary bg-primary text-white"
                        : "border-border bg-surface text-text-main hover:border-primary/50 hover:bg-primary/5",
                    ].join(" ")}
                  >
                    {comboName || `Combo ${index + 1}`}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        {Object.entries(filteredGroups).map(([providerId, group]) => (
          <div key={`group:${providerId}`}>
            <div className="sticky top-0 mb-1.5 flex items-center gap-1.5 bg-surface py-0.5">
              <div className="h-2 w-2 rounded-full" style={{ backgroundColor: group.color }} />
              <span className="text-xs font-medium text-primary">{group.name}</span>
              <span className="text-[10px] text-text-muted">({group.models.length})</span>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {(group.models || []).map((model, index) => {
                const isSelected = multiSelect ? pendingSelection.includes(model.value) : selectedModel === model.value;
                const isPlaceholder = model.isPlaceholder;
                const isDisabled = enabledModelSet ? !enabledModelSet.has(model.value) : false;

                return (
                  <button
                    key={buildModelKey(providerId, model, index)}
                    type="button"
                    disabled={isDisabled}
                    onClick={() => handleSelect(model)}
                    title={isPlaceholder ? "Select to pre-fill, then edit model ID in the input" : undefined}
                    className={[
                      "rounded-xl border px-2 py-1 text-xs font-medium transition-all hover:cursor-pointer",
                      isDisabled
                        ? "cursor-not-allowed border-border bg-black/[0.03] text-text-muted opacity-50 dark:bg-white/[0.04]"
                        : isPlaceholder
                        ? "border-border bg-surface italic text-text-muted hover:border-primary/50 hover:text-primary border-dashed"
                        : isSelected
                          ? "border-primary bg-primary text-white"
                          : "border-border bg-surface text-text-main hover:border-primary/50 hover:bg-primary/5",
                    ].join(" ")}
                  >
                    {isPlaceholder ? (
                      <span className="flex items-center gap-1">
                        <span className="material-symbols-outlined text-[11px]">edit</span>
                        {model.name}
                      </span>
                    ) : model.isCustom ? (
                      <span className="flex items-center gap-1">
                        {model.name}
                        <span className="text-[9px] font-normal opacity-60">custom</span>
                      </span>
                    ) : (
                      model.name
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        {Object.keys(filteredGroups).length === 0 && filteredCombos.length === 0 ? (
          <div className="py-4 text-center text-text-muted">
            <span className="material-symbols-outlined mb-1 block text-2xl">search_off</span>
            <p className="text-xs">No models found</p>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

OpenCodeModelSelectModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onSelect: PropTypes.func.isRequired,
  selectedModel: PropTypes.string,
  selectedModels: PropTypes.arrayOf(PropTypes.string),
  activeProviders: PropTypes.arrayOf(
    PropTypes.shape({
      provider: PropTypes.string.isRequired,
    })
  ),
  title: PropTypes.string,
  modelAliases: PropTypes.object,
  multiSelect: PropTypes.bool,
  confirmLabel: PropTypes.string,
  enabledModels: PropTypes.arrayOf(PropTypes.string),
};
