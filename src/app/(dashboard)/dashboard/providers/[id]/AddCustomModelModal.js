"use client";

import { useState, useEffect } from "react";
import PropTypes from "prop-types";
import { Button, Modal, Select, Toggle } from "@/shared/components";
import { CAPACITY_META, STT_TRANSPORT_META, STT_TRANSPORTS } from "@/shared/constants/models";

const defaultCaps = () => Object.fromEntries(Object.keys(CAPACITY_META).map((key) => [key, false]));

export default function AddCustomModelModal({ isOpen, providerAlias, providerDisplayAlias, onSave, onClose }) {
  const [modelId, setModelId] = useState("");
  // Optional free-form owned_by label; blank keeps the provider alias.
  const [ownedBy, setOwnedBy] = useState("");
  const [caps, setCaps] = useState(defaultCaps);
  const [testStatus, setTestStatus] = useState(null); // null | "testing" | "ok" | "error"
  const [testError, setTestError] = useState("");
  const [saving, setSaving] = useState(false);
  // Realtime dispatch marker for the transport select; "" = provider default REST.
  const [transport, setTransport] = useState("");
  // Optional token multipliers (e.g. 5.0 -> 100k becomes 500k)
  const [inputMultiplier, setInputMultiplier] = useState("");
  const [outputMultiplier, setOutputMultiplier] = useState("");
  // Anti-probe protection (conceals real backend model from probe questions/headers)
  const [antiProbe, setAntiProbe] = useState(true);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setModelId("");
      setOwnedBy("");
      setCaps(defaultCaps());
      setTransport("");
      setInputMultiplier("");
      setOutputMultiplier("");
      setAntiProbe(true);
      setTestStatus(null);
      setTestError("");
    }
  }, [isOpen]);

  // Strip provider's own alias prefix (e.g. "cc/model" -> "model" for cc provider)
  const stripAlias = (id) => {
    const prefix = `${providerAlias}/`;
    return id.startsWith(prefix) ? id.slice(prefix.length) : id;
  };

  const handleTest = async () => {
    const cleanId = stripAlias(modelId.trim());
    if (!cleanId) return;
    setTestStatus("testing");
    setTestError("");
    try {
      const res = await fetch("/api/models/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: `${providerAlias}/${cleanId}` }),
      });
      const data = await res.json();
      setTestStatus(data.ok ? "ok" : "error");
      setTestError(data.error || "");
    } catch (err) {
      setTestStatus("error");
      setTestError(err.message);
    }
  };

  const handleSave = async () => {
    const cleanId = stripAlias(modelId.trim());
    if (!cleanId || saving) return;
    setSaving(true);
    try {
      // caps.stt is UI-only; the parent save flow derives the model type from
      // it and forwards the pinned transport (null unless the caller picked one).
      await onSave(cleanId, caps, caps.stt ? transport : null, ownedBy.trim(), {
        inputMultiplier: inputMultiplier ? Number(inputMultiplier) : undefined,
        outputMultiplier: outputMultiplier ? Number(outputMultiplier) : undefined,
        antiProbe,
      });
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") handleTest();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Add Custom Model">
      <div className="flex flex-col gap-4">
        <div>
          <label className="text-sm font-medium mb-1.5 block">Model ID</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={modelId}
              onChange={(e) => { setModelId(e.target.value); setTestStatus(null); setTestError(""); }}
              onKeyDown={handleKeyDown}
              placeholder="e.g. claude-opus-4-5"
              className="flex-1 px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary"
              autoFocus
            />
            <Button
              variant="secondary"
              icon="experiment"
              loading={testStatus === "testing"}
              onClick={handleTest}
              disabled={!modelId.trim() || testStatus === "testing"}
            >
              {testStatus === "testing" ? "Testing..." : "Test"}
            </Button>
          </div>
          <p className="text-xs text-text-muted mt-1">
            Sent to provider as: <code className="font-mono bg-sidebar px-1 rounded">{stripAlias(modelId.trim()) || "model-id"}</code>
          </p>
        </div>

        <div>
          <label className="text-sm font-medium mb-1.5 block">Capabilities</label>
          <div className="flex flex-wrap gap-4">
            {Object.entries(CAPACITY_META).map(([key, meta]) => (
              <Toggle
                key={key}
                checked={!!caps[key]}
                onChange={(v) => setCaps((prev) => ({ ...prev, [key]: v }))}
                label={meta.label}
                description={meta.desc}
                size="sm"
              />
            ))}
          </div>
        </div>

        <div>
          <label className="text-sm font-medium mb-1.5 block">
            Owned by <span className="font-normal opacity-60">(optional)</span>
          </label>
          <input
            type="text"
            value={ownedBy}
            onChange={(e) => setOwnedBy(e.target.value)}
            placeholder="Defaults to the provider name"
            className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary"
          />
          <p className="text-xs text-text-muted mt-1">
            Shown as <code className="font-mono">owned_by</code> when clients list models.
          </p>
        </div>

        {/* Token Multipliers (Optional) */}
        <div className="grid grid-cols-2 gap-3 p-3 rounded-lg border border-border bg-sidebar/30">
          <div>
            <label className="text-xs font-medium mb-1 block">Input Multiplier</label>
            <input
              type="number"
              step="any"
              min="0.1"
              value={inputMultiplier}
              onChange={(e) => setInputMultiplier(e.target.value)}
              placeholder="e.g. 1.0 (default)"
              className="w-full px-2.5 py-1.5 text-xs border border-border rounded bg-background focus:outline-none focus:border-primary font-mono"
            />
            <p className="text-[10px] text-text-muted mt-0.5">Factor for prompt tokens (e.g. 2x)</p>
          </div>
          <div>
            <label className="text-xs font-medium mb-1 block">Output Multiplier</label>
            <input
              type="number"
              step="any"
              min="0.1"
              value={outputMultiplier}
              onChange={(e) => setOutputMultiplier(e.target.value)}
              placeholder="e.g. 5.0 (default 1.0)"
              className="w-full px-2.5 py-1.5 text-xs border border-border rounded bg-background focus:outline-none focus:border-primary font-mono"
            />
            <p className="text-[10px] text-text-muted mt-0.5">Factor for completion tokens (e.g. 5x)</p>
          </div>
        </div>

        {/* Anti-probe protection toggle */}
        <div className="p-3 rounded-lg border border-border bg-sidebar/30">
          <Toggle
            checked={antiProbe}
            onChange={setAntiProbe}
            label="Anti-Probe Protection"
            description="Conceals backend model identity, scrubs provider headers, and resists probe prompts"
            size="sm"
          />
        </div>

        {/* STT is a model TYPE, not a chat capability: the save flow turns this
            flag into type "stt" (the API honours a transport only on stt
            records). The select pins the realtime dispatch marker persisted
            with the model; the whitelist is the shared STT_TRANSPORT_META. */}
        <div>
          <Toggle
            checked={!!caps.stt}
            onChange={(v) => { setCaps((prev) => ({ ...prev, stt: v })); if (!v) setTransport(""); }}
            label="Speech to text"
            description="Transcribes audio via /v1/audio/transcriptions"
            size="sm"
          />
          {caps.stt && (
            <div className="mt-3">
              <Select
                label="Transport"
                value={transport}
                onChange={(e) => setTransport(e.target.value)}
                placeholder="Provider default (REST)"
                options={STT_TRANSPORTS.map((t) => ({ value: t, label: STT_TRANSPORT_META[t].label }))}
                hint="Realtime transport marker for the STT dispatcher. Empty keeps the provider's REST format."
              />
            </div>
          )}
        </div>

        {/* Test result */}
        {testStatus === "ok" && (
          <div className="flex items-center gap-2 text-sm text-green-600">
            <span className="material-symbols-outlined text-base">task_alt</span>
            Model is reachable
          </div>
        )}
        {testStatus === "error" && (
          <div className="flex items-start gap-2 text-sm text-red-500">
            <span className="material-symbols-outlined text-base shrink-0">close_small</span>
            <span>{testError || "Model not reachable"}</span>
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <Button onClick={onClose} variant="ghost" fullWidth size="sm">Cancel</Button>
          <Button
            onClick={handleSave}
            fullWidth
            size="sm"
            disabled={!modelId.trim() || saving}
          >
            {saving ? "Adding..." : "Add Model"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

AddCustomModelModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  providerAlias: PropTypes.string.isRequired,
  providerDisplayAlias: PropTypes.string.isRequired,
  onSave: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
};
