"use client";

import { useEffect, useMemo, useState } from "react";
import PropTypes from "prop-types";
import { Button, Input, Modal, Toggle } from "@/shared/components";

function updateGrant(connections, connectionId, field, modelId, checked) {
  const current = connections[connectionId] || { models: [], imageModels: [], quotaPercent: null };
  const values = new Set(current[field] || []);
  if (checked) values.add(modelId);
  else values.delete(modelId);
  return { ...connections, [connectionId]: { ...current, [field]: [...values] } };
}

export default function ApiKeyAuthorizationModal({ apiKey, onClose, onSaved }) {
  const authorization = apiKey?.authorization;
  const [restricted, setRestricted] = useState(authorization?.enabled === true);
  const [visionFallback, setVisionFallback] = useState(authorization?.visionFallback === true);
  const [bareCodexModels, setBareCodexModels] = useState(authorization?.bareModelFallback?.codex === true);
  const [bareClaudeModels, setBareClaudeModels] = useState(authorization?.bareModelFallback?.claude === true);
  const [grants, setGrants] = useState(authorization?.connections || {});
  const [options, setOptions] = useState([]);
  const [quotaStatus, setQuotaStatus] = useState({});
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    Promise.all([fetch("/api/keys/options"), fetch(`/api/keys/${apiKey.id}`)])
      .then(async ([optionsResponse, keyResponse]) => {
        const [optionsData, keyData] = await Promise.all([optionsResponse.json(), keyResponse.json()]);
        if (!optionsResponse.ok) throw new Error(optionsData.error || "Failed to load accounts");
        if (!keyResponse.ok) throw new Error(keyData.error || "Failed to load quota status");
        if (active) {
          setOptions(optionsData.connections || []);
          setQuotaStatus(keyData.quotaStatus || {});
        }
      })
      .catch((e) => { if (active) setError(e.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [apiKey.id]);

  const filteredOptions = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return options;
    return options
      .map((connection) => ({
        ...connection,
        models: connection.models.filter((model) => model.label.toLowerCase().includes(q)),
        imageModels: connection.imageModels.filter((model) => model.label.toLowerCase().includes(q)),
      }))
      .filter((connection) => connection.name.toLowerCase().includes(q)
        || connection.provider.toLowerCase().includes(q)
        || connection.models.length > 0
        || connection.imageModels.length > 0);
  }, [options, search]);

  const toggleConnection = (connectionId, checked) => {
    setGrants((current) => {
      if (checked) return { ...current, [connectionId]: current[connectionId] || { models: [], imageModels: [], quotaPercent: null } };
      const next = { ...current };
      delete next[connectionId];
      return next;
    });
  };

  const setAll = (connectionId, field, models, checked) => {
    setGrants((current) => ({
      ...current,
      [connectionId]: {
        ...(current[connectionId] || { models: [], imageModels: [], quotaPercent: null }),
        [field]: checked ? models.map((model) => model.id) : [],
      },
    }));
  };

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/keys/${apiKey.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          authorization: restricted ? {
            enabled: true,
            visionFallback,
            bareModelFallback: {
              codex: bareCodexModels,
              claude: bareClaudeModels,
            },
            connections: grants,
          } : null,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to save permissions");
      onSaved(data.key);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={!!apiKey} title={`Permissions: ${apiKey?.name || "API Key"}`} onClose={onClose} size="full">
      <div className="flex flex-col gap-5">
        <div className="flex items-center justify-between rounded-xl border border-border bg-surface-2 p-4">
          <div>
            <p className="font-medium">Restrict this API key</p>
            <p className="text-sm text-text-muted">Off keeps current behavior: every account and model is allowed.</p>
          </div>
          <Toggle checked={restricted} onChange={setRestricted} />
        </div>

        {restricted && (
          <>
            <div className="flex items-center justify-between rounded-xl border border-border p-4">
              <div>
                <p className="font-medium">Vision fallback</p>
                <p className="text-sm text-text-muted">Use the global Vision Adapter from Combos when an allowed model cannot read images.</p>
              </div>
              <Toggle checked={visionFallback} onChange={setVisionFallback} />
            </div>

            <div className="rounded-xl border border-border p-4">
              <p className="font-medium">Bare model names</p>
              <p className="mb-4 text-sm text-text-muted">Accept native harness model names without exposing additional models.</p>
              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium">Codex models</p>
                    <p className="text-xs text-text-muted">Route allowed `gpt-*` names through `cx/`.</p>
                  </div>
                  <Toggle checked={bareCodexModels} onChange={setBareCodexModels} />
                </div>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium">Claude Code models</p>
                    <p className="text-xs text-text-muted">Route allowed `claude-*` names through `cc/`.</p>
                  </div>
                  <Toggle checked={bareClaudeModels} onChange={setBareClaudeModels} />
                </div>
              </div>
            </div>

            <Input
              label="Search accounts or models"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="codex, deepseek, gpt-5..."
            />

            {loading ? (
              <p className="py-8 text-center text-sm text-text-muted">Loading accounts...</p>
            ) : (
              <div className="flex flex-col gap-3">
                {filteredOptions.map((connection) => {
                  const selected = !!grants[connection.id];
                  const grant = grants[connection.id] || { models: [], imageModels: [], quotaPercent: null };
                  const status = quotaStatus[connection.id];
                  return (
                    <div key={connection.id} className="rounded-xl border border-border overflow-hidden">
                      <label className="flex cursor-pointer items-center gap-3 bg-surface-2 px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={(event) => toggleConnection(connection.id, event.target.checked)}
                          className="size-4 accent-brand-500"
                        />
                        <span className="min-w-0">
                          <span className="block font-medium truncate">{connection.name}</span>
                          <span className="block text-xs text-text-muted">{connection.provider} - {connection.id.slice(0, 8)}</span>
                        </span>
                      </label>

                      {selected && (
                        <div className="p-4">
                          {connection.quotaSupported && (
                            <div className="mb-5 max-w-xs">
                              <Input
                                label="API key quota limit (%)"
                                type="number"
                                min="1"
                                max="100"
                                step="0.1"
                                value={grant.quotaPercent ?? ""}
                                onChange={(event) => setGrants((current) => ({
                                  ...current,
                                  [connection.id]: {
                                    ...(current[connection.id] || { models: [], imageModels: [] }),
                                    quotaPercent: event.target.value,
                                  },
                                }))}
                                placeholder="Unlimited"
                                hint="Uses the shortest active account window (5h first, otherwise 7d)."
                              />
                              {status && (
                                <div className="mt-2 text-xs text-text-muted">
                                  <p>
                                    Estimated {status.usedPercent.toFixed(1)}% of {status.limit}%
                                    {status.quotaName ? ` - ${status.quotaName}` : ""}
                                    {status.resetAt ? ` - resets ${new Date(status.resetAt).toLocaleString()}` : ""}
                                  </p>
                                  {status.profiles?.length > 0 && (
                                    <div className="mt-2 space-y-1 rounded-lg bg-surface-2 p-2">
                                      <p className="font-medium text-text-main">Learned quota rates</p>
                                      {status.profiles.slice(0, 6).map((profile) => (
                                        <p key={profile.profile} className="break-all font-mono text-[10px]">
                                          {profile.profile}: {profile.rate.toFixed(3)}%/{profile.profile.startsWith("image:") ? "image" : "1k tokens"} ({profile.samples} sample{profile.samples === 1 ? "" : "s"})
                                        </p>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                          <div className="grid gap-5 lg:grid-cols-2">
                            <ModelGrantList
                              title="Chat models"
                              models={connection.models}
                              selected={grant.models}
                              onChange={(modelId, checked) => setGrants((current) => updateGrant(current, connection.id, "models", modelId, checked))}
                              onSetAll={(checked) => setAll(connection.id, "models", connection.models, checked)}
                            />
                            <ModelGrantList
                              title="Image generation"
                              models={connection.imageModels}
                              selected={grant.imageModels}
                              onChange={(modelId, checked) => setGrants((current) => updateGrant(current, connection.id, "imageModels", modelId, checked))}
                              onSetAll={(checked) => setAll(connection.id, "imageModels", connection.imageModels, checked)}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
                {filteredOptions.length === 0 && (
                  <p className="py-8 text-center text-sm text-text-muted">No matching accounts or models.</p>
                )}
              </div>
            )}
          </>
        )}

        {error && <p className="text-sm text-red-500">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} loading={saving}>Save Permissions</Button>
        </div>
      </div>
    </Modal>
  );
}

ApiKeyAuthorizationModal.propTypes = {
  apiKey: PropTypes.shape({
    id: PropTypes.string.isRequired,
    name: PropTypes.string,
    authorization: PropTypes.object,
  }),
  onClose: PropTypes.func.isRequired,
  onSaved: PropTypes.func.isRequired,
};

function ModelGrantList({ title, models, selected, onChange, onSetAll }) {
  const selectedSet = new Set(selected || []);
  const allSelected = models.length > 0 && models.every((model) => selectedSet.has(model.id));
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-semibold">{title}</p>
        {models.length > 0 && (
          <button type="button" onClick={() => onSetAll(!allSelected)} className="text-xs text-primary hover:underline">
            {allSelected ? "Clear" : "Select all"}
          </button>
        )}
      </div>
      {models.length === 0 ? (
        <p className="text-xs text-text-muted">No models available.</p>
      ) : (
        <div className="max-h-52 space-y-1 overflow-y-auto rounded-lg border border-border-subtle p-2 custom-scrollbar">
          {models.map((model) => (
            <label key={model.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-surface-2">
              <input
                type="checkbox"
                checked={selectedSet.has(model.id)}
                onChange={(event) => onChange(model.id, event.target.checked)}
                className="size-4 accent-brand-500"
              />
              <code className="min-w-0 truncate text-xs">{model.label}</code>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

ModelGrantList.propTypes = {
  title: PropTypes.string.isRequired,
  models: PropTypes.arrayOf(PropTypes.shape({
    id: PropTypes.string.isRequired,
    label: PropTypes.string.isRequired,
  })).isRequired,
  selected: PropTypes.arrayOf(PropTypes.string),
  onChange: PropTypes.func.isRequired,
  onSetAll: PropTypes.func.isRequired,
};
