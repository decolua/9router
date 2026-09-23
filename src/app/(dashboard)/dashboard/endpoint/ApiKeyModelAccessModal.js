"use client";

import { useEffect, useState } from "react";
import { Badge, Button, Input, Modal, ModelSelectModal, SegmentedControl } from "@/shared/components";
import SecurityWarning from "./components/SecurityWarning";

const ACCESS_OPTIONS = [
  { value: "all", label: "All models" },
  { value: "allow", label: "Allow only" },
  { value: "deny", label: "Block" },
];

export default function ApiKeyModelAccessModal({ isOpen, apiKey, onClose, onSave, activeProviders = [], requireApiKey }) {
  const [mode, setMode] = useState(() => ["all", "allow", "deny"].includes(apiKey?.modelAccess?.mode) ? apiKey.modelAccess.mode : "all");
  const [patterns, setPatterns] = useState(() => Array.isArray(apiKey?.modelAccess?.patterns) ? apiKey.modelAccess.patterns : []);
  const [newPattern, setNewPattern] = useState("");
  const [modelAliases, setModelAliases] = useState({});
  const [showModelSelect, setShowModelSelect] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    fetch("/api/models/alias")
      .then((response) => response.ok ? response.json() : null)
      .then((data) => data && setModelAliases(data.aliases || {}))
      .catch(() => {});
  }, [isOpen]);

  const addPattern = (value) => {
    const pattern = value.trim();
    if (!pattern) return;
    if (patterns.some((current) => current.toLowerCase() === pattern.toLowerCase())) {
      setError("That rule is already in the list.");
      return;
    }
    if (patterns.length >= 200) {
      setError("You can add up to 200 rules.");
      return;
    }
    setPatterns((current) => [...current, pattern]);
    setNewPattern("");
    setError("");
  };

  const handleSave = async () => {
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/keys/${apiKey.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelAccess: { mode, patterns } }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Failed to save model access rules.");
      onSave(data.key);
      onClose();
    } catch (saveError) {
      setError(saveError.message || "Failed to save model access rules.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Modal isOpen={isOpen} onClose={onClose} title={`Model access — ${apiKey?.name || "API key"}`}>
        <div className="flex flex-col gap-4">
          <SegmentedControl options={ACCESS_OPTIONS} value={mode} onChange={setMode} className="w-full justify-center" />

          {!requireApiKey && (
            <SecurityWarning message="Rules only apply to requests that send this key. Enable Require API key so requests without a key are rejected." />
          )}

          {mode !== "all" && (
            <div className="flex flex-col gap-3">
              <div>
                <label className="mb-1.5 block text-sm font-medium">Model patterns</label>
                {patterns.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-text-muted">
                    No model rules added yet.
                  </p>
                ) : (
                  <div className="flex max-h-48 flex-wrap gap-2 overflow-y-auto rounded-lg bg-surface-2 p-3">
                    {patterns.map((pattern) => (
                      <Badge key={pattern} variant={mode === "allow" ? "primary" : "warning"} className="gap-1 font-mono">
                        {pattern}
                        <button
                          type="button"
                          onClick={() => setPatterns((current) => current.filter((item) => item !== pattern))}
                          className="ml-1 inline-flex size-5 items-center justify-center rounded-full hover:bg-black/10 dark:hover:bg-white/10"
                          title={`Remove ${pattern}`}
                          aria-label={`Remove ${pattern}`}
                        >
                          <span className="material-symbols-outlined text-[13px]">close</span>
                        </button>
                      </Badge>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex items-end gap-2">
                <Input
                  label="Add a rule"
                  value={newPattern}
                  onChange={(event) => setNewPattern(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      addPattern(newPattern);
                    }
                  }}
                  placeholder="provider/model or provider/*"
                  className="min-w-0 flex-1"
                  error={error}
                />
                <Button icon="add" variant="secondary" onClick={() => addPattern(newPattern)} disabled={!newPattern.trim()}>
                  Add
                </Button>
              </div>
              {!error && (
                <p className="-mt-2 text-xs text-text-muted">
                  Use provider/model ids as shown in /v1/models. * is a wildcard, e.g. mgf/*, cx/gpt-5.6-sol.
                </p>
              )}
              <Button icon="search" variant="outline" onClick={() => setShowModelSelect(true)} className="self-start">
                Pick model
              </Button>
            </div>
          )}

          {mode === "all" && error && <p className="text-xs text-red-500">{error}</p>}

          <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row">
            <Button variant="ghost" fullWidth onClick={onClose} disabled={saving}>Cancel</Button>
            <Button fullWidth onClick={handleSave} loading={saving}>Save</Button>
          </div>
        </div>
      </Modal>

      {showModelSelect && (
        <ModelSelectModal
          isOpen={showModelSelect}
          onClose={() => setShowModelSelect(false)}
          onSelect={(model) => addPattern(model?.value || "")}
          activeProviders={activeProviders}
          modelAliases={modelAliases}
          title="Pick a model"
          closeOnSelect
        />
      )}
    </>
  );
}
