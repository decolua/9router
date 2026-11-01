"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import PropTypes from "prop-types";
import { Card, Button, Modal, Input, ModelSelectModal, Toggle } from "@/shared/components";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { useModelCaps } from "@/shared/hooks/useModelCaps";
import { findStudioCycle, describeStudioCycle } from "@/shared/utils/studioComboGuard";

const NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;

// Fields the bulk editor may write, and how each one reads to the operator.
const MODEL_BULK_LABELS = {
  inputMultiplier: "Input multiplier (0 = none)",
  outputMultiplier: "Output multiplier (0 = none)",
  contextWindow: "Context window (0 = provider default)",
};

const MODEL_BULK_PLACEHOLDERS = {
  inputMultiplier: "e.g. 2",
  outputMultiplier: "e.g. 5",
  contextWindow: "e.g. 200000",
};

function formatTokens(n) {
  const value = Number(n) || 0;
  if (value >= 1000000) return `${(value / 1000000).toFixed(value % 1000000 ? 1 : 0)}M`;
  if (value >= 1000) return `${Math.round(value / 1000)}k`;
  return String(value);
}

// BazaarLink Probe judges behaviour, not spelling: it never trusts a
// self-claim. So these checks cannot pass a model, they only catch metadata
// that would READ as masked - which is the part a custom model controls.
//
// Vendor families, used to compare a claim against the resolved target. A
// prefix or an owned_by naming a different vendor than the target's own is the
// classic "renamed for resale" shape.
const VENDOR_HINTS = [
  { re: /\b(openai|gpt|o[134](?:-|$)|codex)\b/i, vendor: "openai" },
  { re: /\b(anthropic|claude)\b/i, vendor: "anthropic" },
  { re: /\b(google|gemini|gemma)\b/i, vendor: "google" },
  { re: /\b(meta|llama)\b/i, vendor: "meta" },
  { re: /\b(mistral|codestral|magistral)\b/i, vendor: "mistral" },
  { re: /\b(deepseek)\b/i, vendor: "deepseek" },
  { re: /\b(qwen|qwq)\b/i, vendor: "alibaba" },
  { re: /\b(kimi|moonshot)\b/i, vendor: "moonshot" },
  { re: /\b(glm|zhipu|z-ai)\b/i, vendor: "zhipu" },
  { re: /\b(minimax)\b/i, vendor: "minimax" },
  { re: /\b(grok)\b/i, vendor: "xai" },
  { re: /\b(mimo)\b/i, vendor: "xiaomi" },
];

function detectVendor(text) {
  const t = String(text || "").trim();
  if (!t) return null;
  for (const h of VENDOR_HINTS) {
    if (h.re.test(t)) return h.vendor;
  }
  return null;
}

// Vendor implied by a router prefix: "oc/...", "kr/..." are aliases, so the
// meaningful signal is the model half, not the prefix.
function targetVendor(target) {
  const t = String(target || "").trim();
  if (!t) return null;
  const slash = t.indexOf("/");
  return detectVendor(slash >= 0 ? t.slice(slash + 1) : t);
}

/**
 * Concrete, fixable inconsistencies between what a custom model claims and the
 * model it points at. Returns [] when nothing is off - which is NOT a pass
 * mark, only the absence of an obvious self-contradiction.
 */
function antiMaskFindings({ callName, ownedBy, targetModel }) {
  const findings = [];
  const tv = targetVendor(targetModel);

  if (!String(callName || "").trim()) {
    findings.push({
      level: "info",
      text: "Name this model. A bare or empty id is indistinguishable from padding in a listing.",
    });
  }

  const nv = detectVendor(callName);
  if (nv && tv && nv !== tv) {
    findings.push({
      level: "warn",
      text: `Name reads as ${nv} but the target is ${tv}. A probe compares the claim against the answer, and this is the shape it flags.`,
    });
  }

  const ov = detectVendor(ownedBy);
  if (ov && tv && ov !== tv) {
    findings.push({
      level: "warn",
      text: `owned_by says ${ov} while the target is ${tv}. Keep owned_by on the target's real vendor.`,
    });
  }

  if (!String(ownedBy || "").trim()) {
    findings.push({
      level: "info",
      text: "Set owned_by to the target model's real vendor. Blank falls back to this model's own name, which reads as an invented model.",
    });
  }

  return findings;
}

// The BazaarLink probe is an outside service that judges an endpoint by its
// behaviour, not by its name. The anti-probe switch decides whether this editor
// also warns about the metadata that reads as masked: a call name or owned_by
// claiming a vendor the target does not match. It is a saved setting, not a
// per-browser cookie, so the same editor form shows the same warnings for every
// administrator who opens it.
export default function ModelStudioPage() {
  const [antiProbe, setAntiProbe] = useState(true);
  const [savingProbe, setSavingProbe] = useState(false);

  useEffect(() => {
    fetch("/api/settings", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : {}))
      .then((data) => {
        // Absent means this install never stored the switch: default on, so an
        // existing deployment keeps the warnings it had before the toggle existed.
        if (data && typeof data.antiProbeMetadata === "boolean") {
          setAntiProbe(data.antiProbeMetadata);
        }
      })
      .catch(() => {});
  }, []);

  const toggleAntiProbe = async () => {
    const next = !antiProbe;
    setAntiProbe(next);
    setSavingProbe(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ antiProbeMetadata: next }),
      });
      if (!res.ok) setAntiProbe(!next);
    } catch {
      setAntiProbe(!next);
    } finally {
      setSavingProbe(false);
    }
  };

  return (
    <div className="flex min-w-0 flex-col gap-6 px-1 sm:px-0">
      <div className="min-w-0">
        <h1 className="text-lg font-semibold leading-none text-text-main">Custom Models &amp; Editor</h1>
        <p className="text-xs text-text-muted mt-0.5">
          Give any model your own name, context size and behaviour, and it becomes a callable model ID for clients, combos, and API keys.
        </p>
        <div className="mt-2 flex items-start justify-between gap-3 rounded-xl border border-border-subtle bg-surface-2 px-3 py-2">
          <div className="min-w-0">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-text-main">
              <span className="material-symbols-outlined text-[16px] leading-none text-primary">
                shield_person
              </span>
              Anti-probe metadata
            </span>
            <p className="text-[11px] text-text-muted mt-0.5">
              Warns in the form when a model&apos;s name or <code className="font-mono">owned_by</code> claims a
              vendor the target model does not match - the shape BazaarLink&apos;s probe flags. Nothing is blocked
              or rewritten; the checks only report what a probe would read.
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-center gap-1">
            <Toggle checked={antiProbe} onChange={toggleAntiProbe} disabled={savingProbe} />
            <span className="text-[10px] font-medium text-text-muted">{antiProbe ? "On" : "Off"}</span>
          </div>
        </div>
      </div>
      <ModelStudioContent antiProbe={antiProbe} />
    </div>
  );
}

function ModelStudioContent({ antiProbe = true }) {
  const [models, setModels] = useState([]);
  const [providerNodes, setProviderNodes] = useState([]);
  const [activeProviders, setActiveProviders] = useState([]);
  const [modelAliases, setModelAliases] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [duplicating, setDuplicating] = useState(null);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(null);
  // Bulk edit: which models are ticked, and whether the dialog is open. Same
  // shape as the API-key page - nothing is written until Apply, and only the
  // fields the operator ticks are sent.
  const [selectedNames, setSelectedNames] = useState(() => new Set());
  const [showBulkEdit, setShowBulkEdit] = useState(false);
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
      // A model deleted (or renamed) elsewhere must not stay ticked: a later
      // Apply would otherwise report it missing every time.
      const alive = new Set((studioRes.models || []).map((m) => m.callName));
      setSelectedNames((prev) => {
        if (!prev.size) return prev;
        const next = new Set([...prev].filter((name) => alive.has(name)));
        return next.size === prev.size ? prev : next;
      });
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
    setDuplicating(null);
    setShowForm(true);
  };

  const openEdit = (model) => {
    setDuplicating(null);
    setEditing(model);
    setShowForm(true);
  };

  // Duplicate: open the create form carrying every rule of the source model
  // (target, context window, multipliers, system prompt) under a fresh name, so a
  // variant never starts from an empty form. createDuplicateName keeps the name
  // unique because the call name IS the model id clients send.
  const openDuplicate = (model) => {
    setEditing(null);
    setDuplicating(model);
    setShowForm(true);
  };

  const createDuplicateName = (sourceName) => {
    const taken = new Set(models.map((m) => String(m.callName || "").toLowerCase()));
    const base = `${sourceName}-copy`;
    if (!taken.has(base.toLowerCase())) return base;
    for (let n = 2; n < 100; n++) {
      const candidate = `${base}-${n}`;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
    return `${base}-${Date.now().toString(36)}`;
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

  const toggleSelected = (name) =>
    setSelectedNames((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  const handleBulkApply = async (patch) => {
    const names = Array.from(selectedNames);
    const res = await fetch("/api/model-editor/bulk", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ names, patch }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Failed to apply bulk changes");
    if (Array.isArray(data.missing) && data.missing.length) {
      setSelectedNames((prev) => {
        const next = new Set(prev);
        for (const name of data.missing) next.delete(name);
        return next;
      });
    }
    setShowBulkEdit(false);
    await fetchData();
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

      {selectedNames.size > 1 && (
        // Same shape as the API-key page: a toolbar that only offers itself for
        // more than one row, because one model already has its own editor.
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-full border border-border-subtle bg-surface-2/70 py-1 pl-3 pr-1 backdrop-blur-sm">
          <span className="flex items-center gap-2 text-xs text-text-muted">
            <span className="inline-flex min-w-[22px] items-center justify-center rounded-full bg-primary/15 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-primary">
              {selectedNames.size}
            </span>
            models selected
          </span>
          <div className="flex items-center gap-0.5">
            {selectedNames.size < models.length && (
              <button
                type="button"
                onClick={() => setSelectedNames(new Set(models.map((m) => m.callName)))}
                className="rounded-full px-2.5 py-1.5 text-xs text-text-muted transition-colors hover:bg-surface hover:text-text-main"
              >
                Select all {models.length}
              </button>
            )}
            <button
              type="button"
              onClick={() => setSelectedNames(new Set())}
              className="rounded-full px-2.5 py-1.5 text-xs text-text-muted transition-colors hover:bg-surface hover:text-text-main"
            >
              Clear
            </button>
            <Button size="sm" variant="primary" onClick={() => setShowBulkEdit(true)}>
              Bulk edit
            </Button>
          </div>
        </div>
      )}

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
                <input
                  type="checkbox"
                  checked={selectedNames.has(model.callName)}
                  onChange={() => toggleSelected(model.callName)}
                  className="mt-1 size-4 shrink-0 accent-brand-500"
                  aria-label={`Select ${model.callName}`}
                />
                <div className="min-w-0 flex-1">
                  {/* Same copy affordance as an API-key row: a small always-visible
                      icon button that swaps to a check, instead of a hover-only
                      glyph plus a "Copied" label. */}
                  <div className="flex min-w-0 items-center gap-1">
                    <code className="font-mono text-sm font-semibold text-primary truncate">
                      {model.callName}
                    </code>
                    <button
                      type="button"
                      onClick={() => copy(model.callName, model.callName)}
                      title="Copy model name"
                      className="p-1 hover:bg-surface-2 rounded text-text-muted hover:text-primary transition-all shrink-0"
                    >
                      <span className="material-symbols-outlined text-[14px]">
                        {copiedName === model.callName ? "check" : "content_copy"}
                      </span>
                    </button>
                  </div>
                  {model.displayName && model.displayName !== model.callName && (
                    <p className="text-xs text-text-muted mt-0.5 truncate">{model.displayName}</p>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => openDuplicate(model)}
                    title="Duplicate"
                    className="p-1 hover:bg-surface-2 rounded text-text-muted hover:text-primary transition-all"
                  >
                    <span className="material-symbols-outlined text-[14px]">content_copy</span>
                  </button>
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
                <span className="px-2 py-0.5 rounded-full bg-surface-2 border border-border-subtle text-text-muted font-mono truncate max-w-full">
                  {model.targetLabel || model.targetModel}
                </span>
                {!String(model.targetModel || "").includes("/") && (
                  <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
                    combo
                  </span>
                )}
                {model.contextWindow > 0 && (
                  <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
                    {formatTokens(model.contextWindow)} context
                  </span>
                )}
                {(model.inputMultiplier > 0 || model.outputMultiplier > 0) && (
                  <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-success font-medium">
                    {model.inputMultiplier ? `${model.inputMultiplier}x In` : ""}
                    {model.inputMultiplier && model.outputMultiplier ? " · " : ""}
                    {model.outputMultiplier ? `${model.outputMultiplier}x Out` : ""}
                  </span>
                )}
              </div>

              {model.systemPrompt && (
                <div className="rounded-lg bg-surface-2 border border-border-subtle px-2.5 py-2">
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
          key={editing?.callName || duplicating?.callName || "new"}
          antiProbe={antiProbe}
          editing={editing}
          duplicating={duplicating}
          duplicateName={duplicating ? createDuplicateName(duplicating.callName) : ""}
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

      {showBulkEdit && (
        <BulkEditModels
          count={selectedNames.size}
          onApply={handleBulkApply}
          onClose={() => setShowBulkEdit(false)}
        />
      )}
    </>
  );
}

/**
 * Bulk edit models: write one field to every selected model in one call.
 * Each field is opt-in (checkbox): fields left off are not touched, so the form
 * never rewrites what the user did not mean to change. Same shape as the API-key
 * bulk editor.
 */
function BulkEditModels({ count, onApply, onClose }) {
  const [fields, setFields] = useState({
    inputMultiplier: { on: false, value: "" },
    outputMultiplier: { on: false, value: "" },
    contextWindow: { on: false, value: "" },
  });
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState("");

  const toggle = (name) =>
    setFields((prev) => ({ ...prev, [name]: { ...prev[name], on: !prev[name].on } }));
  const setValue = (name, value) =>
    setFields((prev) => ({ ...prev, [name]: { ...prev[name], value } }));

  const handleApply = async () => {
    const patch = {};
    for (const [name, { on, value }] of Object.entries(fields)) {
      if (!on) continue;
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0) {
        setError(`${MODEL_BULK_LABELS[name]} must be a number of 0 or more`);
        return;
      }
      patch[name] = n;
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
      setError(err?.message || "Failed to apply bulk changes");
    } finally {
      setApplying(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={`Bulk edit ${count} model${count === 1 ? "" : "s"}`}>
      <div className="flex flex-col gap-3">
        {Object.keys(fields).map((name) => (
          <div key={name} className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={fields[name].on}
              onChange={() => toggle(name)}
              className="mt-1.5 size-4 shrink-0 accent-brand-500"
              aria-label={`Change ${MODEL_BULK_LABELS[name]}`}
            />
            <div className="flex-1 min-w-0">
              <label className="text-sm font-medium text-text-main block mb-1">
                {MODEL_BULK_LABELS[name]}
              </label>
              <Input
                type="number"
                step="0.1"
                min="0"
                value={fields[name].value}
                onChange={(e) => setValue(name, e.target.value)}
                disabled={!fields[name].on}
                placeholder={MODEL_BULK_PLACEHOLDERS[name]}
              />
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
            Apply to {count} model{count === 1 ? "" : "s"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

BulkEditModels.propTypes = {
  count: PropTypes.number.isRequired,
  onApply: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
};

function StudioFormModal({
  antiProbe = true,
  editing,
  duplicating,
  duplicateName = "",
  activeProviders,
  modelAliases,
  saving,
  setSaving,
  onClose,
  onSaved,
}) {
  const { getCaps } = useModelCaps();
  const [showPicker, setShowPicker] = useState(false);
  // A duplicate opens with the source model's rules already filled in, so the
  // only thing left to decide is the new name.
  const source = editing || duplicating || null;
  const [callName, setCallName] = useState(editing?.callName || duplicateName || "");
  const [displayName, setDisplayName] = useState(source?.displayName || "");
  // Label this model claims in a model listing (owned_by). Free-form; blank means
  // "present itself as the model name clients call".
  const [ownedBy, setOwnedBy] = useState(source?.ownedBy || "");
  // The record stores both: `targetModel` is the resolved router target
  // (provider id), `targetLabel` is what the user actually picked. Editing has
  // to start from the label, otherwise saving writes the resolved prefix back
  // and the picker's own spelling ("oc/...") is lost on every round trip.
  const [targetModel, setTargetModel] = useState(
    source?.targetLabel || source?.targetModel || ""
  );
  // True while the user has typed their own number: the suggestion then stops
  // overriding, but stays visible so a stale value is obvious.
  const [contextTouched, setContextTouched] = useState(
    source ? !!source.contextWindow : false
  );
  const [combos, setCombos] = useState([]);
  const [siblings, setSiblings] = useState([]);
  const [contextWindow, setContextWindow] = useState(
    source?.contextWindow ? String(source.contextWindow) : ""
  );
  const [inputMultiplier, setInputMultiplier] = useState(
    source?.inputMultiplier ? String(source.inputMultiplier) : ""
  );
  const [outputMultiplier, setOutputMultiplier] = useState(
    source?.outputMultiplier ? String(source.outputMultiplier) : ""
  );
  const [systemPrompt, setSystemPrompt] = useState(source?.systemPrompt || "");

  useEffect(() => {
    let alive = true;
    Promise.all([
      fetch("/api/combos").then((r) => (r.ok ? r.json() : { combos: [] })).catch(() => ({ combos: [] })),
      fetch("/api/model-editor").then((r) => (r.ok ? r.json() : { models: [] })).catch(() => ({ models: [] })),
    ]).then(([comboData, studioData]) => {
      if (!alive) return;
      setCombos(comboData.combos || []);
      setSiblings(studioData.models || []);
    });
    return () => { alive = false; };
  }, []);

  const targetCaps = useMemo(() => (targetModel ? getCaps(targetModel) : null), [targetModel, getCaps]);
  const isComboTarget = useMemo(
    () => (targetModel ? !targetModel.includes("/") && combos.some((c) => c.name === targetModel) : false),
    [targetModel, combos]
  );
  const nameError = useMemo(() => {
    if (!callName) return "";
    if (callName.includes("/")) return "Use a name without \"/\" - it is the model ID clients send.";
    if (!NAME_RE.test(callName)) return "Letters, numbers, dot, dash and underscore only (max 64).";
    return "";
  }, [callName]);

  // Client-side precheck mirroring the server guard: warn before saving when
  // the picked combo leads back to this model. The server still decides.

  // Only computed while the switch is on: the panel is not rendered otherwise,
  // and re-deriving it on every keystroke for a hidden check is wasted work.
  const maskFindings = useMemo(
    () => (antiProbe ? antiMaskFindings({ callName, ownedBy, targetModel }) : []),
    [antiProbe, callName, ownedBy, targetModel]
  );
  const maskWarns = maskFindings.filter((f) => f.level === "warn");
  const cycleError = useMemo(() => {
    const name = callName.trim();
    const target = targetModel.trim();
    if (!name || !target || target.includes("/")) return "";
    if (!combos.some((c) => c.name === target)) return "";
    const chain = findStudioCycle({
      callName: name,
      comboName: target,
      combosByName: new Map(combos.map((c) => [c.name, c.models || []])),
      studioTargets: new Map(
        siblings.filter((m) => m.callName !== name && m.callName !== editing?.callName).map((m) => [m.callName, m.targetModel])
      ),
      extraSelfNames: editing?.callName && editing.callName !== name ? [editing.callName] : [],
    });
    return chain ? describeStudioCycle(chain) : "";
  }, [callName, targetModel, combos, siblings, editing]);

  const handlePickModel = (model) => {
    if (!model?.value || model.isPlaceholder) return;
    setTargetModel(model.value);
    // Clear the "user typed this" flag: a new pick is a new model, so its own
    // context window is the correct suggestion again.
    setContextTouched(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!callName.trim() || !targetModel || nameError || cycleError) return;
    setSaving(true);
    try {
      const res = await fetch("/api/model-editor", {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callName: callName.trim(),
          previousName: editing?.callName,
          displayName: displayName.trim(),
          ownedBy: ownedBy.trim(),
          targetModel,
          // Sent verbatim: the server keeps this as targetLabel, so the picker
          // keeps showing the spelling that was chosen here.
          contextWindow: contextWindow ? Number(contextWindow) : 0,
          inputMultiplier: inputMultiplier ? Number(inputMultiplier) : undefined,
          outputMultiplier: outputMultiplier ? Number(outputMultiplier) : undefined,
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
        title={editing ? `Edit ${editing.callName}` : duplicating ? `Duplicate ${duplicating.callName}` : "Add Model"}
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
                    <span className="block font-mono text-sm text-text-main truncate">
                      {targetModel}
                      {isComboTarget ? <span className="ml-1.5 text-[10px] font-sans font-medium text-primary">combo</span> : null}
                    </span>
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
              Any model you have connected - built-in, custom provider or combo.
            </p>
            {cycleError && (
              <p className="text-[11px] text-red-500 mt-1">{cycleError}</p>
            )}
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
              Owned by <span className="text-text-muted font-normal">(optional)</span>
            </label>
            <Input
              value={ownedBy}
              onChange={(e) => setOwnedBy(e.target.value)}
              placeholder={`Defaults to "${callName || "the model name"}"`}
            />
            <p className="text-[11px] text-text-muted mt-1">
              Shown as <code className="font-mono">owned_by</code> when clients list
              models. The real target model is never exposed.
            </p>
          </div>

          {/* Owned-by stays a plain field; the external probe link lived here. */}


          {antiProbe ? (
          <div className="rounded-xl border border-border-subtle bg-surface-2 p-3 flex flex-col gap-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-xs font-semibold text-text-main">
                <span className="material-symbols-outlined text-[16px] leading-none text-primary">
                  shield_person
                </span>
                Anti-mask check
              </span>
              <a
                href="https://bazaarlink.ai/probe"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-[11px] text-primary hover:underline whitespace-nowrap"
              >
                Run BazaarLink Probe
                <span className="material-symbols-outlined text-[12px] leading-none">open_in_new</span>
              </a>
            </div>

            {maskWarns.length === 0 ? (
              <p className="text-[11px] text-text-muted flex items-start gap-1.5">
                <span className="material-symbols-outlined text-[13px] leading-none mt-px text-emerald-500">
                  check_circle
                </span>
                No contradiction between this model&apos;s name and its target&apos;s vendor.
              </p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {maskFindings.map((f, i) => (
                  <li
                    key={i}
                    className={`text-[11px] flex items-start gap-1.5 ${
                      f.level === "warn" ? "text-amber-500" : "text-text-muted"
                    }`}
                  >
                    <span className="material-symbols-outlined text-[13px] leading-none mt-px shrink-0">
                      {f.level === "warn" ? "warning" : "info"}
                    </span>
                    <span>{f.text}</span>
                  </li>
                ))}
              </ul>
            )}

            <p className="text-[10px] text-text-muted leading-relaxed border-t border-border pt-2">
              BazaarLink&apos;s probe sends behavioural checks and compares how the
              endpoint answers against known baselines - it never trusts the name
              a model calls itself. This panel only catches metadata that would
              <em> read</em> as masked (a vendor claim your target does not
              match); an honest endpoint passes on behaviour alone, and no
              spelling of a name can make a probe pass or fail it.
            </p>
          </div>
          ) : null}
          <div>
            <label className="block text-xs font-medium text-text-main mb-1">
              Context window <span className="text-text-muted font-normal">(tokens)</span>
            </label>
            <Input
              type="number"
              min="0"
              value={contextWindow}
              onChange={(e) => {
                setContextWindow(e.target.value);
                setContextTouched(true);
              }}
              placeholder={targetCaps?.contextWindow ? String(targetCaps.contextWindow) : "0 = provider default"}
            />
            {targetCaps?.contextWindow ? (
              <div className="flex items-center gap-2 mt-1">
                <span className="text-[11px] text-text-muted">
                  {targetModel} is listed at{" "}
                  <code className="font-mono">{formatTokens(targetCaps.contextWindow)}</code>
                  {targetCaps.maxOutput ? (
                    <> · {formatTokens(targetCaps.maxOutput)} output</>
                  ) : null}
                </span>
                {Number(contextWindow || 0) !== targetCaps.contextWindow ? (
                  <button
                    type="button"
                    onClick={() => {
                      setContextWindow(String(targetCaps.contextWindow));
                      setContextTouched(false);
                    }}
                    className="text-[11px] text-primary hover:underline whitespace-nowrap"
                  >
                    use {formatTokens(targetCaps.contextWindow)}
                  </button>
                ) : null}
              </div>
            ) : null}
            <p className="text-[11px] text-text-muted mt-1">
              Advertised to clients reading <code className="font-mono">/v1/models</code>. Leave empty to
              keep the provider default. A custom model that renames a target keeps
              the target&apos;s own window unless you override it here.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-text-main mb-1">
                Input Multiplier <span className="text-text-muted font-normal">(optional)</span>
              </label>
              <Input
                type="number"
                step="0.1"
                min="0"
                value={inputMultiplier}
                onChange={(e) => setInputMultiplier(e.target.value)}
                placeholder="e.g. 1 or 2 (2x input)"
              />
              <p className="text-[11px] text-text-muted mt-1">
                Token input multiplier applied to usage and quota calculation.
              </p>
            </div>
            <div>
              <label className="block text-xs font-medium text-text-main mb-1">
                Output Multiplier <span className="text-text-muted font-normal">(optional)</span>
              </label>
              <Input
                type="number"
                step="0.1"
                min="0"
                value={outputMultiplier}
                onChange={(e) => setOutputMultiplier(e.target.value)}
                placeholder="e.g. 5 (5x output)"
              />
              <p className="text-[11px] text-text-muted mt-1">
                Token output multiplier applied to usage and quota calculation.
              </p>
            </div>
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
            <Button type="submit" disabled={!callName.trim() || !targetModel || !!nameError || !!cycleError || saving}>
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
          showStudioTargets
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
            One prefix per custom provider - clients call{" "}
            <code className="font-mono">prefix/model-id</code>.
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          {compatible.map((node) => (
            <div
              key={node.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-border-subtle bg-surface-2 px-2.5 py-2"
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

