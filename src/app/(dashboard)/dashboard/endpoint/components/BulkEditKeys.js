"use client";

import { useState } from "react";
import PropTypes from "prop-types";
import { Button, Modal, Input, ModelSelectModal } from "@/shared/components";

/**
 * Bulk edit keys: write one field to every selected key in one call.
 * Each field is opt-in (checkbox): fields left off are not touched, so the
 * form never rewrites what the user did not mean to change.
 */
export default function BulkEditKeys({ selectedCount, onApply, onClose }) {
  const [fields, setFields] = useState({
    isActive: { on: false, value: "true" },
    limitKind: { on: false, value: "tokens" },
    tokenLimit: { on: false, value: "" },
    dailyCostLimit: { on: false, value: "" },
    requestLimit: { on: false, value: "" },
    resetInterval: { on: false, value: "never" },
    rpmLimit: { on: false, value: "" },
    tpmLimit: { on: false, value: "" },
    allowedModels: { on: false, value: "" },
    expiresAt: { on: false, value: "" },
  });
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState("");
  const [modelPickerOpen, setModelPickerOpen] = useState(false);

  const toggle = (name) =>
    setFields((prev) => ({ ...prev, [name]: { ...prev[name], on: !prev[name].on } }));
  const setValue = (name, value) =>
    setFields((prev) => ({ ...prev, [name]: { ...prev[name], value } }));

  // Allowed models is a comma-separated pattern list ("*" = all). The picker
  // edits it as a list; chips and the read-only input echo the raw value.
  const allowedModelsList = () => {
    const raw = String(fields.allowedModels.value || "").trim();
    if (!raw || raw === "*") return [];
    return raw.split(",").map((s) => s.trim()).filter(Boolean);
  };
  const addAllowedModel = (modelVal) => {
    const list = allowedModelsList();
    if (!modelVal || list.includes(modelVal)) return;
    setValue("allowedModels", list.length ? [...list, modelVal].join(", ") : modelVal);
  };
  const removeAllowedModel = (modelVal) => {
    setValue("allowedModels", allowedModelsList().filter((m) => m !== modelVal).join(", "));
  };

  const handleApply = async () => {
    const patch = {};
    for (const [name, { on, value }] of Object.entries(fields)) {
      if (!on) continue;
      if (name === "isActive") {
        patch.isActive = value === "true";
      } else if (name === "limitKind") {
        patch.limitKind = value;
      } else if (name === "tokenLimit" || name === "rpmLimit" || name === "tpmLimit" || name === "requestLimit" || name === "dailyCostLimit") {
        const n = Number(value);
        if (!Number.isFinite(n) || n < 0) {
          setError(`${labelFor(name)} must be a number of 0 or more (0 = unlimited)`);
          return;
        }
        patch[name] = n;
      } else if (name === "allowedModels") {
        if (!String(value).trim()) {
          setError("Allowed models pattern cannot be empty when enabled");
          return;
        }
        patch.allowedModels = String(value).trim();
      } else {
        patch[name] = value;
      }
    }
    if (!Object.keys(patch).length) {
      setError("Enable at least one field to change");
      return;
    }
    setError("");
    setApplying(true);
    try {
      await onApply(patch);
      onClose();
    } catch (err) {
      setError(err.message || "Failed to apply bulk changes");
    } finally {
      setApplying(false);
    }
  };

  const rows = ["isActive", "limitKind", "tokenLimit", "dailyCostLimit", "requestLimit", "resetInterval", "rpmLimit", "tpmLimit", "allowedModels", "expiresAt"];

  return (
    <Modal isOpen onClose={onClose} title={`Edit ${selectedCount} key${selectedCount === 1 ? "" : "s"}`}>
      <div className="flex flex-col gap-3">
        {rows.map((name) => (
          <div key={name} className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={fields[name].on}
              onChange={() => toggle(name)}
              className="mt-1.5 size-4 accent-brand-500"
              aria-label={`Change ${labelFor(name)}`}
            />
            <div className="flex-1 min-w-0">
              <label className="text-sm font-medium text-text-main block mb-1">{labelFor(name)}</label>
              {name === "resetInterval" ? (
                <select
                  value={fields[name].value}
                  onChange={(e) => setValue(name, e.target.value)}
                  disabled={!fields[name].on}
                  className="w-full h-9 px-3 rounded-lg border border-black/10 dark:border-white/10 bg-surface text-sm text-text-main disabled:opacity-40"
                >
                  <option value="never">No reset</option>
                  <option value="hourly">Hourly</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                </select>
              ) : name === "limitKind" ? (
                <select
                  value={fields[name].value}
                  onChange={(e) => setValue(name, e.target.value)}
                  disabled={!fields[name].on}
                  className="w-full h-9 px-3 rounded-lg border border-black/10 dark:border-white/10 bg-surface text-sm text-text-main disabled:opacity-40"
                >
                  <option value="tokens">Tokens</option>
                  <option value="cost">USD spend</option>
                  <option value="requests">Requests</option>
                </select>
              ) : name === "isActive" ? (
                <select
                  value={fields[name].value}
                  onChange={(e) => setValue(name, e.target.value)}
                  disabled={!fields[name].on}
                  className="w-full h-9 px-3 rounded-lg border border-black/10 dark:border-white/10 bg-surface text-sm text-text-main disabled:opacity-40"
                >
                  <option value="true">Active</option>
                  <option value="false">Disabled</option>
                </select>
              ) : name === "allowedModels" ? (
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <Input
                      value={fields[name].value}
                      readOnly
                      disabled={!fields[name].on}
                      inputClassName="truncate font-mono"
                      placeholder="* (all models)"
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      icon="add"
                      disabled={!fields[name].on}
                      onClick={() => setModelPickerOpen(true)}
                    >
                      Select
                    </Button>
                  </div>
                  {allowedModelsList().length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {allowedModelsList().map((m) => (
                        <span
                          key={m}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-primary/10 text-primary font-mono text-xs"
                        >
                          {m}
                          <button
                            type="button"
                            onClick={() => removeAllowedModel(m)}
                            disabled={!fields[name].on}
                            className="hover:text-red-500 transition-colors"
                            aria-label={`Remove ${m}`}
                          >
                            ✕
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <Input
                  value={fields[name].value}
                  onChange={(e) => setValue(name, e.target.value)}
                  disabled={!fields[name].on}
                  placeholder={placeholderFor(name)}
                  type={name === "expiresAt" ? "date" : "text"}
                />
              )}
            </div>
          </div>
        ))}

        {error && (
          <p className="text-xs text-red-500" role="alert">{error}</p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose} disabled={applying}>
            Cancel
          </Button>
          <Button onClick={handleApply} loading={applying}>
            Apply to {selectedCount} key{selectedCount === 1 ? "" : "s"}
          </Button>
        </div>
      </div>

      <ModelSelectModal
        isOpen={modelPickerOpen}
        onClose={() => setModelPickerOpen(false)}
        onSelect={(model) => addAllowedModel(model?.value)}
        onDeselect={(model) => removeAllowedModel(model?.value)}
        title="Select Allowed Models"
        addedModelValues={allowedModelsList()}
        closeOnSelect={false}
      />
    </Modal>
  );
}

function labelFor(name) {
  return {
    isActive: "Status",
    limitKind: "Budget counted in",
    tokenLimit: "Token limit (0 = unlimited)",
    dailyCostLimit: "Daily USD limit (0 = unlimited)",
    requestLimit: "Request limit (0 = unlimited)",
    resetInterval: "Reset interval",
    rpmLimit: "Requests per minute (0 = unlimited)",
    tpmLimit: "Tokens per minute (0 = unlimited)",
    allowedModels: "Allowed models pattern",
    expiresAt: "Expiry date",
  }[name] || name;
}

function placeholderFor(name) {
  return {
    tokenLimit: "e.g. 1000000",
    dailyCostLimit: "e.g. 5",
    requestLimit: "e.g. 1000",
    rpmLimit: "e.g. 60",
    tpmLimit: "e.g. 100000",
    allowedModels: "e.g. anthropic/*, openai/gpt-4o",
    expiresAt: "leave blank for no expiry",
  }[name] || "";
}

BulkEditKeys.propTypes = {
  selectedCount: PropTypes.number.isRequired,
  onApply: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
};