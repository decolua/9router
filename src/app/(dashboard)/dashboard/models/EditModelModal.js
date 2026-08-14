"use client";

import { useState, useEffect } from "react";
import PropTypes from "prop-types";
import { Modal, Button } from "@/shared/components";
import { invalidateModelCapsCache } from "@/shared/hooks/useModelCaps";
import { invalidatePricingCache } from "@/shared/hooks/usePricing";

const BOOL_CAPS = [
  ["vision", "Vision (image input)"],
  ["reasoning", "Reasoning / thinking"],
  ["tools", "Tool calling"],
  ["pdf", "PDF input"],
  ["imageOutput", "Image output"],
  ["audioInput", "Audio input"],
];

const PRICE_FIELDS = [
  ["input", "Input"],
  ["output", "Output"],
  ["cached", "Cached input"],
  ["cache_creation", "Cache creation"],
];

const inputClass =
  "w-full px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary";

export default function EditModelModal({ isOpen, onClose, model, onSaved }) {
  const [alias, setAlias] = useState("");
  const [contextWindow, setContextWindow] = useState("");
  const [maxOutput, setMaxOutput] = useState("");
  const [flags, setFlags] = useState({});
  const [prices, setPrices] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isOpen || !model) return;
    setAlias(model.alias || "");
    setContextWindow(model.caps?.contextWindow ? String(model.caps.contextWindow) : "");
    setMaxOutput(model.caps?.maxOutput ? String(model.caps.maxOutput) : "");
    const nextFlags = {};
    for (const [key] of BOOL_CAPS) nextFlags[key] = !!model.caps?.[key];
    setFlags(nextFlags);
    const nextPrices = {};
    for (const [key] of PRICE_FIELDS) {
      nextPrices[key] = model.pricing?.[key] != null ? String(model.pricing[key]) : "";
    }
    setPrices(nextPrices);
    setError("");
  }, [isOpen, model]);

  const handleSave = async () => {
    setSaving(true);
    setError("");
    try {
      // 1. Alias
      const nextAlias = alias.trim();
      if (nextAlias && nextAlias !== (model.alias || "")) {
        const res = await fetch("/api/models/alias", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: model.aliasKey, alias: nextAlias }),
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Failed to save alias");
        }
      } else if (!nextAlias && model.alias) {
        await fetch(`/api/models/alias?alias=${encodeURIComponent(model.alias)}`, { method: "DELETE" });
      }

      // 2. Capabilities override = diff vs static caps (empty diff removes the override)
      const override = {};
      for (const [key] of BOOL_CAPS) {
        const value = !!flags[key];
        if (value !== !!model.staticCaps?.[key]) override[key] = value;
      }
      const ctx = contextWindow.trim() ? parseInt(contextWindow, 10) : null;
      if (ctx && ctx !== model.staticCaps?.contextWindow) override.contextWindow = ctx;
      const out = maxOutput.trim() ? parseInt(maxOutput, 10) : null;
      if (out && out !== model.staticCaps?.maxOutput) override.maxOutput = out;

      if (Object.keys(override).length > 0) {
        const res = await fetch("/api/models/caps", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider: model.providerAlias, model: model.id, caps: override }),
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Failed to save capabilities");
        }
      } else if (model.override) {
        await fetch(
          `/api/models/caps?provider=${encodeURIComponent(model.providerAlias)}&model=${encodeURIComponent(model.id)}`,
          { method: "DELETE" }
        );
      }

      // 3. Pricing (PATCH replaces the per-model override entry, so send the full object)
      const pricingPayload = {};
      for (const [key, label] of PRICE_FIELDS) {
        const raw = (prices[key] || "").trim();
        if (raw === "") continue;
        const value = Number(raw);
        if (Number.isNaN(value) || value < 0) throw new Error(`Invalid price for ${label}`);
        pricingPayload[key] = value;
      }
      const currentPricing = model.pricing || {};
      const pricingChanged = PRICE_FIELDS.some(
        ([key]) => (pricingPayload[key] ?? undefined) !== (currentPricing[key] ?? undefined)
      );
      if (Object.keys(pricingPayload).length > 0 && pricingChanged) {
        const res = await fetch("/api/pricing", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ [model.providerAlias]: { [model.id]: pricingPayload } }),
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Failed to save pricing");
        }
      } else if (Object.keys(pricingPayload).length === 0 && Object.keys(currentPricing).length > 0) {
        // All fields cleared → drop the user override (static defaults still apply)
        await fetch(
          `/api/pricing?provider=${encodeURIComponent(model.providerAlias)}&model=${encodeURIComponent(model.id)}`,
          { method: "DELETE" }
        );
      }

      invalidateModelCapsCache();
      invalidatePricingCache();
      onSaved?.();
      onClose();
    } catch (err) {
      setError(err.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const handleResetCaps = async () => {
    setSaving(true);
    setError("");
    try {
      const res = await fetch(
        `/api/models/caps?provider=${encodeURIComponent(model.providerAlias)}&model=${encodeURIComponent(model.id)}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to reset capabilities");
      }
      invalidateModelCapsCache();
      onSaved?.();
      onClose();
    } catch (err) {
      setError(err.message || "Failed to reset capabilities");
    } finally {
      setSaving(false);
    }
  };

  const handleResetPricing = async () => {
    setSaving(true);
    setError("");
    try {
      const res = await fetch(
        `/api/pricing?provider=${encodeURIComponent(model.providerAlias)}&model=${encodeURIComponent(model.id)}`,
        { method: "DELETE" }
      );
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to reset pricing");
      }
      invalidatePricingCache();
      onSaved?.();
      onClose();
    } catch (err) {
      setError(err.message || "Failed to reset pricing");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Edit model: ${model?.id || ""}`}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} loading={saving}>
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {error && <p className="text-sm text-red-500">{error}</p>}

        <div>
          <label htmlFor="edit-model-alias" className="text-sm font-medium text-text-main mb-1 block">
            Alias
          </label>
          <input
            id="edit-model-alias"
            type="text"
            value={alias}
            onChange={(e) => setAlias(e.target.value)}
            placeholder={model?.id}
            className={inputClass}
          />
          <p className="text-xs text-text-muted mt-1">
            Friendly name for routing (<code>{model?.providerAlias}/{alias.trim() || model?.id}</code>). Leave empty to use the model id.
          </p>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-text-main">Capabilities</p>
            {model?.override && (
              <button
                onClick={handleResetCaps}
                disabled={saving}
                className="text-xs text-red-500 hover:underline"
              >
                Reset to defaults
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor="edit-model-ctx" className="text-xs text-text-muted mb-1 block">Context window (tokens)</label>
              <input
                id="edit-model-ctx"
                type="number"
                min="1"
                value={contextWindow}
                onChange={(e) => setContextWindow(e.target.value)}
                placeholder="e.g. 200000"
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="edit-model-out" className="text-xs text-text-muted mb-1 block">Max output (tokens)</label>
              <input
                id="edit-model-out"
                type="number"
                min="1"
                value={maxOutput}
                onChange={(e) => setMaxOutput(e.target.value)}
                placeholder="e.g. 64000"
                className={inputClass}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 mt-3">
            {BOOL_CAPS.map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 text-sm text-text-main cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!flags[key]}
                  onChange={(e) => setFlags((prev) => ({ ...prev, [key]: e.target.checked }))}
                  className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                />
                {label}
              </label>
            ))}
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-medium text-text-main">
              Pricing <span className="text-xs font-normal text-text-muted">($ per 1M tokens, empty = unset)</span>
            </p>
            {model?.pricing && (
              <button
                onClick={handleResetPricing}
                disabled={saving}
                className="text-xs text-red-500 hover:underline"
              >
                Reset to defaults
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {PRICE_FIELDS.map(([key, label]) => (
              <div key={key}>
                <label htmlFor={`edit-model-price-${key}`} className="text-xs text-text-muted mb-1 block">{label}</label>
                <input
                  id={`edit-model-price-${key}`}
                  type="number"
                  min="0"
                  step="0.01"
                  value={prices[key] || ""}
                  onChange={(e) => setPrices((prev) => ({ ...prev, [key]: e.target.value }))}
                  placeholder="0.00"
                  className={inputClass}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}

EditModelModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onSaved: PropTypes.func,
  model: PropTypes.shape({
    id: PropTypes.string,
    providerAlias: PropTypes.string,
    aliasKey: PropTypes.string,
    alias: PropTypes.string,
    caps: PropTypes.object,
    staticCaps: PropTypes.object,
    override: PropTypes.object,
    pricing: PropTypes.object,
  }),
};
