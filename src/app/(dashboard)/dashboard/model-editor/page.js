"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Card, Button, Modal, Input, ModelSelectModal } from "@/shared/components";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { useModelCaps } from "@/shared/hooks/useModelCaps";

const NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;

function formatTokens(n) {
  const value = Number(n) || 0;
  if (value >= 1000000) return `${(value / 1000000).toFixed(value % 1000000 ? 1 : 0)}M`;
  if (value >= 1000) return `${Math.round(value / 1000)}k`;
  return String(value);
}

export default function ModelStudioPage() {
  return (
    <div className="flex min-w-0 flex-col gap-6 px-1 sm:px-0">
      <div className="min-w-0">
        <h1 className="text-lg font-semibold leading-none text-text-main">Custom Models &amp; Editor</h1>
        <p className="text-xs text-text-muted mt-0.5">
          Give any model your own name, context size and behaviour, and it becomes a callable model ID for clients, combos, and API keys.
        </p>
      </div>
      <ModelStudioContent />
    </div>
  );
}

function ModelStudioContent() {
  const [models, setModels] = useState([]);
  const [providerNodes, setProviderNodes] = useState([]);
  const [activeProviders, setActiveProviders] = useState([]);
  const [modelAliases, setModelAliases] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(null);
  const { copied: copiedName, copy } = useCopyToClipboard(1800);

  const fetchData = useCallback(async () => {
    try {
      const [studioRes, nodesRes, providersRes, aliasesRes] = await Promise.all([
        fetch("/api/model-editor").then((r) => (r.ok ? r.json() : { models: [] })).catch(() => ({ models: [] })),
        fetch("/api/provider-nodes").then((r) => (r.ok ? r.json() : { nodes: [] })).catch(() => ({ nodes: [] })),
        fetch("/api/providers").then((r) => (r.ok ? r.json() : {})).catch(() => ({})),
        fetch("/api/models/alias").then((r) => (r.ok ? r.json() : { aliases: {} })).catch(() => ({ aliases: {} })),
      ]);
      setModels(studioRes.models || []);
      setProviderNodes((nodesRes.nodes || []).filter((n) => n.type !== "custom-embedding"));
      setActiveProviders(providersRes.connections || []);
      setModelAliases(aliasesRes.aliases || {});
      setError(studioRes.error || "");
    } catch (e) {
      setError(e?.message || "Failed to load models");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const openCreate = () => {
    setEditing(null);
    setShowForm(true);
  };

  const openEdit = (model) => {
    setEditing(model);
    setShowForm(true);
  };

  const handleDelete = async (model) => {
    setRemoving(model.callName);
    try {
      await fetch(`/api/model-editor?name=${encodeURIComponent(model.callName)}`, { method: "DELETE" });
      fetchData();
    } finally {
      setRemoving(null);
    }
  };

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-medium text-text-main">
            {models.length} {models.length === 1 ? "model" : "models"}
          </span>
          {error && <span className="text-xs text-red-500 truncate">{error}</span>}
        </div>
        <Button size="sm" icon="add" onClick={openCreate}>
          Add Model
        </Button>
      </div>

      {loading ? (
        <Card padding="md">
          <div className="text-xs text-text-muted py-4">Loading models...</div>
        </Card>
      ) : models.length === 0 ? (
        <Card padding="lg" className="flex flex-col items-center gap-3 text-center py-10">
          <span className="material-symbols-outlined text-[34px] text-text-muted/50">auto_awesome</span>
          <div>
            <p className="text-sm font-medium text-text-main">No models yet</p>
            <p className="text-xs text-text-muted mt-1 max-w-md">
              Pick any connected model, name it however you like, and call it by that name.
            </p>
          </div>
          <Button size="sm" icon="add" onClick={openCreate}>
            Add your first model
          </Button>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {models.map((model) => (
            <Card key={model.callName} padding="md" className="flex min-w-0 flex-col gap-3">
              <div className="flex min-w-0 items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={() => copy(model.callName, model.callName)}
                    title="Copy model name"
                    className="flex items-center gap-2 min-w-0 max-w-full text-left group"
                  >
                    <code className="font-mono text-sm font-semibold text-primary truncate">
                      {model.callName}
                    </code>
                    {copiedName === model.callName ? (
                      <span className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-green-500">
                        <span className="material-symbols-outlined text-[14px]">check</span>
                        Copied
                      </span>
                    ) : (
                      <span className="material-symbols-outlined text-[14px] shrink-0 text-text-muted opacity-0 transition-opacity group-hover:opacity-100">
                        content_copy
                      </span>
                    )}
                  </button>
                  {model.displayName && model.displayName !== model.callName && (
                    <p className="text-xs text-text-muted mt-0.5 truncate">{model.displayName}</p>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => openEdit(model)}
                    title="Edit"
                    className="p-1.5 rounded-lg text-text-muted hover:text-primary hover:bg-primary/10 transition-colors"
                  >
                    <span className="material-symbols-outlined text-[16px]">edit</span>
                  </button>
                  <button
                    onClick={() => handleDelete(model)}
                    disabled={removing === model.callName}
                    title="Delete"
                    className="p-1.5 rounded-lg text-text-muted hover:text-red-500 hover:bg-red-500/10 transition-colors disabled:opacity-50"
                  >
                    <span className="material-symbols-outlined text-[16px]">
                      {removing === model.callName ? "progress_activity" : "delete"}
                    </span>
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                <span className="px-2 py-0.5 rounded-full bg-black/5 dark:bg-white/5 text-text-muted font-mono truncate max-w-full">
                  {model.targetLabel || model.targetModel}
                </span>
                {model.contextWindow > 0 && (
                  <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
                    {formatTokens(model.contextWindow)} context
                  </span>
                )}
              </div>

              {model.systemPrompt && (
                <div className="rounded-lg bg-black/5 dark:bg-white/5 px-2.5 py-2">
                  <p className="text-[10px] uppercase tracking-wide text-text-muted/70 mb-0.5">
                    System prompt
                  </p>
                  <p className="text-xs text-text-muted line-clamp-3 break-words">
                    {model.systemPrompt}
                  </p>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      <PrefixCard nodes={providerNodes} onSaved={fetchData} />

      {showForm && (
        <StudioFormModal
          editing={editing}
          activeProviders={activeProviders}
          modelAliases={modelAliases}
          saving={saving}
          setSaving={setSaving}
          onClose={() => setShowForm(false)}
          onSaved={() => {
            setShowForm(false);
            fetchData();
          }}
        />
      )}
    </>
  );
}

function StudioFormModal({
  editing,
  activeProviders,
  modelAliases,
  saving,
  setSaving,
  onClose,
  onSaved,
}) {
  const { getCaps } = useModelCaps();
  const [showPicker, setShowPicker] = useState(false);
  const [callName, setCallName] = useState(editing?.callName || "");
  const [displayName, setDisplayName] = useState(editing?.displayName || "");
  const [targetModel, setTargetModel] = useState(editing?.targetModel || "");
  const [contextWindow, setContextWindow] = useState(
    editing?.contextWindow ? String(editing.contextWindow) : ""
  );
  const [systemPrompt, setSystemPrompt] = useState(editing?.systemPrompt || "");

  const targetCaps = useMemo(() => (targetModel ? getCaps(targetModel) : null), [targetModel, getCaps]);
  const nameError = useMemo(() => {
    if (!callName) return "";
    if (callName.includes("/")) return "Use a name without \"/\" — it is the model ID clients send.";
    if (!NAME_RE.test(callName)) return "Letters, numbers, dot, dash and underscore only (max 64).";
    return "";
  }, [callName]);

  const handlePickModel = (model) => {
    if (!model?.value || model.isPlaceholder) return;
    setTargetModel(model.value);
    const caps = getCaps(model.value);
    if (caps?.contextWindow && !contextWindow) setContextWindow(String(caps.contextWindow));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!callName.trim() || !targetModel || nameError) return;
    setSaving(true);
    try {
      const res = await fetch("/api/model-editor", {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callName: callName.trim(),
          previousName: editing?.callName,
          displayName: displayName.trim(),
          targetModel,
          contextWindow: contextWindow ? Number(contextWindow) : 0,
          systemPrompt,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.error || "Failed to save model");
        return;
      }
      onSaved();
    } catch (err) {
      alert(err?.message || "Failed to save model");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Modal
        isOpen
        onClose={onClose}
        title={editing ? `Edit ${editing.callName}` : "Add Model"}
      >
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <label className="block text-xs font-medium text-text-main">This name calls</label>
              {targetModel && (
                <button
                  type="button"
                  onClick={() => setTargetModel("")}
                  className="text-[11px] text-text-muted hover:text-red-500 transition-colors"
                >
                  clear
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={() => setShowPicker(true)}
              className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg border text-left transition-colors ${targetModel
                ? "border-primary/40 bg-primary/5"
                : "border-dashed border-border hover:border-primary/50"
                }`}
            >
              <span className="min-w-0 flex-1">
                {targetModel ? (
                  <>
                    <span className="block font-mono text-sm text-text-main truncate">{targetModel}</span>
                    {targetCaps?.contextWindow ? (
                      <span className="block text-[11px] text-text-muted mt-0.5">
                        {formatTokens(targetCaps.contextWindow)} context
                        {targetCaps.maxOutput ? ` · ${formatTokens(targetCaps.maxOutput)} output` : ""}
                      </span>
                    ) : null}
                  </>
                ) : (
                  <span className="text-sm text-text-muted">Pick a model to route to</span>
                )}
              </span>
              <span className="material-symbols-outlined text-[18px] text-primary shrink-0">
                {targetModel ? "swap_horiz" : "search"}
              </span>
            </button>
            <p className="text-[11px] text-text-muted">
              Any model you have connected — built-in, custom provider or combo.
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-text-main mb-1">Model name</label>
            <Input
              value={callName}
              onChange={(e) => setCallName(e.target.value)}
              placeholder="e.g. workhorse"
              autoFocus
            />
            {nameError ? (
              <p className="text-[11px] text-red-500 mt-1">{nameError}</p>
            ) : (
              <p className="text-[11px] text-text-muted mt-1">
                Clients call <code className="font-mono">{`"${callName || "name"}"`}</code> as the model ID.
              </p>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-text-main mb-1">
              Display name <span className="text-text-muted font-normal">(optional)</span>
            </label>
            <Input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Friendly label shown in the dashboard"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-text-main mb-1">
              Context window <span className="text-text-muted font-normal">(tokens)</span>
            </label>
            <Input
              type="number"
              min="0"
              value={contextWindow}
              onChange={(e) => setContextWindow(e.target.value)}
              placeholder={targetCaps?.contextWindow ? String(targetCaps.contextWindow) : "0 = provider default"}
            />
            <p className="text-[11px] text-text-muted mt-1">
              Advertised to clients reading <code className="font-mono">/v1/models</code>. Leave empty to
              keep the provider default.
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-text-main mb-1">
              System prompt <span className="text-text-muted font-normal">(optional)</span>
            </label>
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="Instructions prepended to every request that uses this model..."
              rows={4}
              className="w-full rounded-[10px] border border-border/50 bg-surface-2 p-2.5 text-sm text-text-main placeholder-text-muted/70 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all duration-150 ease-out resize-y"
            />
          </div>

          <div className="flex justify-end gap-2 mt-1">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!callName.trim() || !targetModel || !!nameError || saving}>
              {saving ? "Saving..." : editing ? "Save" : "Create"}
            </Button>
          </div>
        </form>
      </Modal>

      {showPicker && (
        <ModelSelectModal
          isOpen
          onClose={() => setShowPicker(false)}
          onSelect={handlePickModel}
          activeProviders={activeProviders}
          modelAliases={modelAliases}
          selectedModel={targetModel}
          title="Pick Model"
        />
      )}
    </>
  );
}

function PrefixCard({ nodes, onSaved }) {
  const [showPrefixModal, setShowPrefixModal] = useState(false);
  const [editNode, setEditNode] = useState(null);
  const [prefix, setPrefix] = useState("");
  const [savingPrefix, setSavingPrefix] = useState(false);

  const compatible = useMemo(
    () => nodes.filter((n) => n.type === "openai-compatible" || n.type === "anthropic-compatible"),
    [nodes]
  );

  const openPrefix = (node) => {
    setEditNode(node);
    setPrefix(node.prefix || "");
    setShowPrefixModal(true);
  };

  const savePrefix = async (e) => {
    e.preventDefault();
    if (!editNode || !prefix.trim()) return;
    setSavingPrefix(true);
    try {
      const res = await fetch("/api/provider-nodes", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editNode.id, prefix: prefix.trim() }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.error || "Failed to update prefix");
        return;
      }
      setShowPrefixModal(false);
      onSaved();
    } catch (err) {
      alert(err?.message || "Failed to update prefix");
    } finally {
      setSavingPrefix(false);
    }
  };

  if (compatible.length === 0) return null;

  return (
    <>
      <Card padding="md" className="flex flex-col gap-3">
        <div>
          <h3 className="text-sm font-semibold text-text-main">Provider prefixes</h3>
          <p className="text-[11px] text-text-muted mt-0.5">
            One prefix per custom provider — clients call{" "}
            <code className="font-mono">prefix/model-id</code>.
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          {compatible.map((node) => (
            <div
              key={node.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-black/5 dark:border-white/5 bg-black/5 dark:bg-white/5 px-2.5 py-2"
            >
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-text-main truncate">{node.name}</p>
                <code className="font-mono text-[11px] text-primary">{node.prefix || node.id}/</code>
              </div>
              <button
                onClick={() => openPrefix(node)}
                title="Edit prefix"
                className="p-1.5 rounded-lg text-text-muted hover:text-primary hover:bg-primary/10 transition-colors shrink-0"
              >
                <span className="material-symbols-outlined text-[16px]">edit</span>
              </button>
            </div>
          ))}
        </div>
      </Card>

      {showPrefixModal && editNode && (
        <Modal isOpen onClose={() => setShowPrefixModal(false)} title={`Prefix · ${editNode.name}`}>
          <form onSubmit={savePrefix} className="flex flex-col gap-4">
            <div>
              <label className="block text-xs font-medium text-text-main mb-1">Prefix</label>
              <Input
                value={prefix}
                onChange={(e) => setPrefix(e.target.value)}
                placeholder="e.g. custom1"
                autoFocus
              />
              <p className="text-[11px] text-text-muted mt-1">
                Clients call <code className="font-mono">{prefix || "prefix"}/model-id</code>.
                {editNode.prefix && editNode.prefix !== prefix.trim() && (
                  <> Replaces <code className="font-mono">{editNode.prefix}/</code>.</>
                )}
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setShowPrefixModal(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={!prefix.trim() || savingPrefix}>
                {savingPrefix ? "Saving..." : "Save"}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

