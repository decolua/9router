"use client";

import { useState, useCallback, useEffect } from "react";
import PropTypes from "prop-types";
import { Card, Button, Modal } from "@/shared/components";
import { getModelsByProviderId, getModelKind } from "@/shared/constants/models";
import { getProviderAlias } from "@/shared/constants/providers";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";

// ── Lifecycle chip (T-D) ───────────────────────────────────────
// models.dev `status`, surfaced by /v1/models as `lifecycle` metadata.
// Purely informative: deprecated/alpha models keep working, retired ones only
// appear here while an account still lists them. Any failure to read the list
// just means no chips.
const LIFECYCLE_CHIP = {
  retired: { label: "EOL", cls: "text-red-500 bg-red-500/10", tip: "Retired upstream (models.dev) — listed only because a connected account still offers it" },
  deprecated: { label: "DEPRECATED", cls: "text-amber-500 bg-amber-500/10", tip: "Deprecated upstream (models.dev)" },
  alpha: { label: "ALPHA", cls: "text-sky-500 bg-sky-500/10", tip: "Alpha/pre-release upstream (models.dev)" },
  beta: { label: "BETA", cls: "text-sky-500 bg-sky-500/10", tip: "Beta/preview upstream (models.dev)" },
};

// The dashboard card's kindFilter → the /v1/models/{kind} slug that lists it.
const LIFECYCLE_LIST_URL = {
  image: "/v1/models/image",
  tts: "/v1/models/tts",
  stt: "/v1/models/stt",
  embedding: "/v1/models/embedding",
  imageToText: "/v1/models/image-to-text",
  webSearch: "/v1/models/web",
  webFetch: "/v1/models/web",
};

// ── ModelRow ───────────────────────────────────────────────────
export function ModelRow({ model, fullModel, copied, onCopy, testStatus, isCustom, isFree, lifecycle, onDeleteAlias, onTest, isTesting }) {
  const borderColor = testStatus === "ok" ? "border-green-500/40" : testStatus === "error" ? "border-red-500/40" : "border-border";
  const iconColor = testStatus === "ok" ? "#22c55e" : testStatus === "error" ? "#ef4444" : undefined;

  return (
    <div className={`group px-3 py-2 rounded-lg border ${borderColor} hover:bg-sidebar/50`}>
      <div className="flex items-center gap-2">
        <span className="material-symbols-outlined text-base" style={iconColor ? { color: iconColor } : undefined}>
          {testStatus === "ok" ? "check_circle" : testStatus === "error" ? "cancel" : "smart_toy"}
        </span>
        <div className="flex flex-col gap-1">
          <code className="text-xs text-text-muted font-mono bg-sidebar px-1.5 py-0.5 rounded">{fullModel}</code>
          {model.name && <span className="text-[9px] text-text-muted/70 italic pl-1">{model.name}</span>}
        </div>
        {onTest && (
          <div className="relative group/btn">
            <button onClick={onTest} disabled={isTesting} className={`p-0.5 hover:bg-sidebar rounded text-text-muted hover:text-primary transition-opacity ${isTesting ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
              <span className="material-symbols-outlined text-sm" style={isTesting ? { animation: "spin 1s linear infinite" } : undefined}>
                {isTesting ? "progress_activity" : "science"}
              </span>
            </button>
            <span className="pointer-events-none absolute mt-1 top-5 left-1/2 -translate-x-1/2 text-[10px] text-text-muted whitespace-nowrap opacity-0 group-hover/btn:opacity-100 transition-opacity">
              {isTesting ? "Testing..." : "Test"}
            </span>
          </div>
        )}
        <div className="relative group/btn">
          <button onClick={() => onCopy(fullModel, `model-${model.id}`)} className="p-0.5 hover:bg-sidebar rounded text-text-muted hover:text-primary">
            <span className="material-symbols-outlined text-sm">{copied === `model-${model.id}` ? "check" : "content_copy"}</span>
          </button>
          <span className="pointer-events-none absolute mt-1 top-5 left-1/2 -translate-x-1/2 text-[10px] text-text-muted whitespace-nowrap opacity-0 group-hover/btn:opacity-100 transition-opacity">
            {copied === `model-${model.id}` ? "Copied!" : "Copy"}
          </span>
        </div>
        {isFree && <span className="text-[10px] font-bold text-green-500 bg-green-500/10 px-1.5 py-0.5 rounded">FREE</span>}
        {lifecycle && (
          <span
            title={LIFECYCLE_CHIP[lifecycle]?.tip || `Upstream lifecycle: ${lifecycle}`}
            className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${LIFECYCLE_CHIP[lifecycle]?.cls || "text-text-muted bg-sidebar"}`}
          >
            {LIFECYCLE_CHIP[lifecycle]?.label || lifecycle.toUpperCase()}
          </span>
        )}
        {isCustom && (
          <button onClick={onDeleteAlias} className="p-0.5 hover:bg-red-500/10 rounded text-text-muted hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity ml-auto" title="Remove custom model">
            <span className="material-symbols-outlined text-sm">close</span>
          </button>
        )}
      </div>
    </div>
  );
}

ModelRow.propTypes = {
  model: PropTypes.shape({ id: PropTypes.string.isRequired }).isRequired,
  fullModel: PropTypes.string.isRequired,
  copied: PropTypes.string,
  onCopy: PropTypes.func.isRequired,
  testStatus: PropTypes.oneOf(["ok", "error"]),
  isCustom: PropTypes.bool,
  isFree: PropTypes.bool,
  lifecycle: PropTypes.string,
  onDeleteAlias: PropTypes.func,
  onTest: PropTypes.func,
  isTesting: PropTypes.bool,
};

// ── AddCustomModelModal ────────────────────────────────────────
function AddCustomModelModal({ isOpen, onSave, onClose }) {
  const [modelId, setModelId] = useState("");

  const handleSave = () => {
    if (!modelId.trim()) return;
    onSave(modelId.trim());
    setModelId("");
  };

  return (
    <Modal isOpen={isOpen} title="Add Custom Model" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div>
          <label className="text-xs text-text-muted mb-1 block">Model ID</label>
          <input
            className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary"
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSave()}
            placeholder="e.g. tts-1-hd"
            autoFocus
          />
        </div>
        <div className="flex gap-2">
          <Button onClick={handleSave} fullWidth disabled={!modelId.trim()}>Add</Button>
          <Button onClick={onClose} variant="ghost" fullWidth>Cancel</Button>
        </div>
      </div>
    </Modal>
  );
}

AddCustomModelModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onSave: PropTypes.func.isRequired,
  onClose: PropTypes.func.isRequired,
};

// ── ModelsCard ─────────────────────────────────────────────────
// Self-contained card: shows models for a provider, filtered by optional `kindFilter`.
// kindFilter: if provided, only shows models with matching type/kinds field.
export default function ModelsCard({ providerId, kindFilter, providerAliasOverride }) {
  const { copied, copy } = useCopyToClipboard();
  const [modelAliases, setModelAliases] = useState({});
  const [customModels, setCustomModels] = useState([]);
  const [modelLifecycleById, setModelLifecycleById] = useState({});
  const [modelTestResults, setModelTestResults] = useState({});
  const [testingModelId, setTestingModelId] = useState(null);
  const [testError, setTestError] = useState("");
  const [showAddCustomModel, setShowAddCustomModel] = useState(false);

  const providerAlias = providerAliasOverride || getProviderAlias(providerId);
  const effectiveType = kindFilter || "llm";

  // Each `ok` response replaces its slice; a failed slice stays `undefined` so
  // `applySnapshot` leaves whatever the last good fetch put there.
  const fetchSnapshot = useCallback(async () => {
    const modelsListUrl = LIFECYCLE_LIST_URL[kindFilter || "llm"] || "/v1/models";
    const [aliasRes, customRes, listRes] = await Promise.all([
      fetch("/api/models/alias"),
      fetch("/api/models/custom", { cache: "no-store" }),
      // Only read for the `lifecycle` annotations. The internal header keeps
      // this off the upstream providers (no dynamic /models fan-out), and its
      // failure must never cost the card its alias/custom data.
      fetch(modelsListUrl, { cache: "no-store", headers: { "x-9r-internal-models-fetch": "1" } })
        .catch(() => null),
    ]);
    const aliasData = await aliasRes.json();
    const customData = await customRes.json();
    const snapshot = {
      aliases: aliasRes.ok ? (aliasData.aliases || {}) : undefined,
      customs: customRes.ok ? (customData.models || []) : undefined,
      lifecycleById: undefined,
    };
    if (listRes?.ok) {
      const listData = await listRes.json().catch(() => null);
      const byId = {};
      for (const m of listData?.data || []) {
        if (typeof m?.id !== "string" || !m.lifecycle) continue;
        byId[m.id] = m.lifecycle;
        const slash = m.id.indexOf("/");
        if (slash >= 0) byId[m.id.slice(slash + 1)] = m.lifecycle;
      }
      snapshot.lifecycleById = byId;
    }
    return snapshot;
  }, [kindFilter]);

  const applySnapshot = useCallback((snapshot) => {
    if (snapshot.aliases) setModelAliases(snapshot.aliases);
    if (snapshot.customs) setCustomModels(snapshot.customs);
    if (snapshot.lifecycleById) setModelLifecycleById(snapshot.lifecycleById);
  }, []);

  // Fetch + apply for event handlers (post-mutation refreshes).
  const refresh = useCallback(async () => {
    try {
      applySnapshot(await fetchSnapshot());
    } catch (e) { console.log("ModelsCard fetch error:", e); }
  }, [fetchSnapshot, applySnapshot]);

  useEffect(() => {
    // Initial data load: the setState lands in the promise callback, never the
    // effect body, and `active` drops a late response after unmount.
    let active = true;
    fetchSnapshot()
      .then((snapshot) => { if (active) applySnapshot(snapshot); })
      .catch((e) => console.log("ModelsCard fetch error:", e));
    return () => { active = false; };
  }, [fetchSnapshot, applySnapshot]);

  const handleSetAlias = async (modelId, alias) => {
    const fullModel = `${providerAlias}/${modelId}`;
    try {
      const res = await fetch("/api/models/alias", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: fullModel, alias }),
      });
      if (res.ok) await refresh();
    } catch (e) { console.log("set alias error:", e); }
  };

  const handleDeleteAlias = async (alias) => {
    try {
      const res = await fetch(`/api/models/alias?alias=${encodeURIComponent(alias)}`, { method: "DELETE" });
      if (res.ok) await refresh();
    } catch (e) { console.log("delete alias error:", e); }
  };

  const handleAddCustomModel = async (modelId) => {
    try {
      const res = await fetch("/api/models/custom", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerAlias, id: modelId, type: effectiveType }),
      });
      if (res.ok) {
        await refresh();
        window.dispatchEvent(new CustomEvent("customModelChanged"));
      }
    } catch (e) { console.log("add custom model error:", e); }
  };

  const handleDeleteCustomModel = async (modelId) => {
    try {
      const params = new URLSearchParams({ providerAlias, id: modelId, type: effectiveType });
      const res = await fetch(`/api/models/custom?${params}`, { method: "DELETE" });
      if (res.ok) {
        await refresh();
        window.dispatchEvent(new CustomEvent("customModelChanged"));
      }
    } catch (e) { console.log("delete custom model error:", e); }
  };

  const handleTestModel = async (modelId) => {
    if (testingModelId) return;
    setTestingModelId(modelId);
    try {
      const res = await fetch("/api/models/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: `${providerAlias}/${modelId}`, kind: kindFilter }),
      });
      const data = await res.json();
      setModelTestResults((prev) => ({ ...prev, [modelId]: data.ok ? "ok" : "error" }));
      setTestError(data.ok ? "" : (data.error || "Model not reachable"));
    } catch {
      setModelTestResults((prev) => ({ ...prev, [modelId]: "error" }));
      setTestError("Network error");
    } finally { setTestingModelId(null); }
  };

  // Built-in models — filter by kindFilter if provided
  const allBuiltIn = getModelsByProviderId(providerId);
  const builtInModels = kindFilter
    ? allBuiltIn.filter((m) => {
        if (m.kinds) return m.kinds.includes(kindFilter);
        return getModelKind(m, "llm") === kindFilter;
      })
    : allBuiltIn;

  // Custom models for this provider + kind, dedupe vs built-in
  const myCustomModels = customModels.filter(
    (m) => m.providerAlias === providerAlias
      && getModelKind(m, "llm") === effectiveType
      && !builtInModels.some((b) => b.id === m.id)
  );

  const displayModels = builtInModels;

  return (
    <>
      <Card>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Models{kindFilter ? ` — ${kindFilter.toUpperCase()}` : ""}</h2>
        </div>
        {testError && <p className="text-xs text-red-500 mb-3 break-words">{testError}</p>}

        <div className="flex flex-wrap gap-3">
          {displayModels.map((model) => {
            const fullModel = `${providerAlias}/${model.id}`;
            const existingAlias = Object.entries(modelAliases).find(([, m]) => m === fullModel)?.[0];
            return (
              <ModelRow
                key={model.id}
                model={model}
                fullModel={`${providerAlias}/${model.id}`}
                alias={existingAlias}
                copied={copied}
                onCopy={copy}
                onSetAlias={(alias) => handleSetAlias(model.id, alias)}
                onDeleteAlias={() => handleDeleteAlias(existingAlias)}
                testStatus={modelTestResults[model.id]}
                onTest={() => handleTestModel(model.id)}
                isTesting={testingModelId === model.id}
                isFree={model.isFree}
                lifecycle={modelLifecycleById[fullModel] || modelLifecycleById[model.id] || undefined}
              />
            );
          })}

          {myCustomModels.map((model) => (
            <ModelRow
              key={`${model.id}-${model.type}`}
              model={{ id: model.id, name: model.name }}
              fullModel={`${providerAlias}/${model.id}`}
              copied={copied}
              onCopy={copy}
              onSetAlias={() => {}}
              onDeleteAlias={() => handleDeleteCustomModel(model.id)}
              testStatus={modelTestResults[model.id]}
              onTest={() => handleTestModel(model.id)}
              isTesting={testingModelId === model.id}
              isCustom
            />
          ))}

          <button
            onClick={() => setShowAddCustomModel(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-dashed border-black/15 dark:border-white/15 text-xs text-text-muted hover:text-primary hover:border-primary/40 transition-colors"
          >
            <span className="material-symbols-outlined text-sm">add</span>
            Add Model
          </button>
        </div>
      </Card>

      <AddCustomModelModal
        isOpen={showAddCustomModel}
        onSave={async (modelId) => {
          await handleAddCustomModel(modelId);
          setShowAddCustomModel(false);
        }}
        onClose={() => setShowAddCustomModel(false)}
      />
    </>
  );
}

ModelsCard.propTypes = {
  providerId: PropTypes.string.isRequired,
  kindFilter: PropTypes.string, // e.g. "tts", "embedding" — filters models shown
  providerAliasOverride: PropTypes.string, // override alias (e.g. for custom-embedding nodes using prefix)
};
