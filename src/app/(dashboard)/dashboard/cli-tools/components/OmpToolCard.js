"use client";

import { useState, useEffect, useRef } from "react";
import { Card, Button, ModelSelectModal, ManualConfigModal } from "@/shared/components";
import Image from "next/image";
import BaseUrlSelect from "./BaseUrlSelect";
import ApiKeySelect from "./ApiKeySelect";
import { matchKnownEndpoint } from "./cliEndpointMatch";
import { OMP_MODEL_ROLES, emptyOmpRoleAssignments } from "@/shared/constants/ompRoles";
import { toOmpCapabilityPayload, formatContextWindow } from "@/shared/constants/ompModelSchema";
import { persistOmpModelSelection } from "./ompModelSelection";


export default function OmpToolCard({ tool, isExpanded, onToggle, baseUrl, apiKeys, activeProviders, cloudEnabled, initialStatus, tunnelEnabled, tunnelPublicUrl, tailscaleEnabled, tailscaleUrl }) {
  const [status, setStatus] = useState(initialStatus || null);
  const [checking, setChecking] = useState(false);
  const [applying, setApplying] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [message, setMessage] = useState(null);
  const [showInstallGuide, setShowInstallGuide] = useState(false);
  const [selectedApiKey, setSelectedApiKey] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [modelAliases, setModelAliases] = useState({});
  const [showManualConfigModal, setShowManualConfigModal] = useState(false);
  const [customBaseUrl, setCustomBaseUrl] = useState("");
  const [selectedModels, setSelectedModels] = useState([]);
  const [catalogModels, setCatalogModels] = useState([]);
  // Role drafts are keyed by scope ("global" | "project:<index>"). A single
  // shared map would leak edits across layers: editing a project role then
  // switching to Global would apply it to the wrong file.
  const [roleDrafts, setRoleDrafts] = useState(() => ({ global: emptyOmpRoleAssignments() }));
  const [roleScope, setRoleScope] = useState("global");
  const [projectIndex, setProjectIndex] = useState(0);
  const [scopeInfo, setScopeInfo] = useState(null);
  const [scopeTouched, setScopeTouched] = useState(false);
  const selectedModelsRef = useRef([]);
  const modalInitialModelsRef = useRef([]);
  // Which layers hold unapplied edits, keyed the same way, so a catalog save
  // never discards pending role changes for any layer.
  const dirtyRoleKeys = useRef(new Set());
  // Which individual role ids the user edited, per scope key. Apply sends only
  // these: shipping the whole map would clear assignments that merely point at
  // models absent from the current picker (manual catalog entries, roles set
  // directly in omp), which is silent data loss.
  const touchedRoleIds = useRef(new Map());
  const markRoleTouched = (key, roleId) => {
    if (!touchedRoleIds.current.has(key)) touchedRoleIds.current.set(key, new Set());
    touchedRoleIds.current.get(key).add(roleId);
  };

  const scopeKeyFor = (scope, index) => (scope === "project" ? `project:${index}` : "global");
  const currentScopeKey = scopeKeyFor(roleScope, projectIndex);
  const roleAssignments = roleDrafts[currentScopeKey] || emptyOmpRoleAssignments();
  const setRoleAssignments = (next) => {
    dirtyRoleKeys.current.add(currentScopeKey);
    setRoleDrafts((prev) => ({
      ...prev,
      [currentScopeKey]:
        typeof next === "function" ? next(prev[currentScopeKey] || emptyOmpRoleAssignments()) : next,
    }));
  };
  const effectiveSelectedApiKey = selectedApiKey || apiKeys?.[0]?.key || "";
  // Async checkStatus() reads scope through refs: by the time a response lands
  // the user may have switched layers, and a stale closure would write the
  // fetched roles into the wrong draft.
  const roleScopeRef = useRef(roleScope);
  const projectIndexRef = useRef(projectIndex);
  // Set synchronously by the selectors so an in-flight response cannot
  // re-apply auto-detection over a choice the user just made.
  const scopeTouchedRef = useRef(false);
  useEffect(() => { roleScopeRef.current = roleScope; }, [roleScope]);
  useEffect(() => { projectIndexRef.current = projectIndex; }, [projectIndex]);


  useEffect(() => {
    selectedModelsRef.current = selectedModels;
  }, [selectedModels]);




  async function fetchModelAliases() {
    try {
      const [aliasRes, modelsRes] = await Promise.all([
        fetch("/api/models/alias"),
        fetch("/api/models"),
      ]);
      const aliasData = await aliasRes.json();
      if (aliasRes.ok) setModelAliases(aliasData.aliases || {});
      const modelsData = await modelsRes.json();
      if (modelsRes.ok && Array.isArray(modelsData.models)) setCatalogModels(modelsData.models);
    } catch (error) {
      console.log("Error fetching model aliases:", error);
    }
  };
  // Keep only assignments whose model is still selected. Custom roles (omp
  // supports more than the ten built-ins) must survive the prune, or applying
  // would silently clear a role the user never touched.
  const pruneRoleAssignments = (assignments, models) => {
    const allowed = new Set(models || []);
    const next = emptyOmpRoleAssignments();
    for (const role of Object.keys(assignments || {})) {
      if (!(role in next)) next[role] = "";
    }
    for (const role of Object.keys(next)) {
      next[role] = allowed.has(assignments?.[role]) ? assignments[role] : "";
    }
    return next;
  };

  // Label a model in the role picker with the capabilities that actually get
  // written to models.yml, so the assignment is an informed one: context
  // window first (the field that most often decides a role), then the
  // capability flags omp keys off.
  const describeModelOption = (modelId) => {
    const m = catalogModels.find((x) => x.fullModel === modelId);
    const caps = m?.caps;
    if (!caps) return modelId;
    const parts = [];
    const ctx = formatContextWindow(caps.contextWindow);
    if (ctx) parts.push(`${ctx} ctx`);
    if (caps.reasoning) parts.push("reasoning");
    if (caps.vision) parts.push("vision");
    if (caps.search) parts.push("search");
    return parts.length ? `${modelId} — ${parts.join(" · ")}` : modelId;
  };

  // Catalog autosave (OpenCode-style): fires on add/remove. Catalog only —
  // roles are scoped and go through Apply's PATCH, so sending them here would
  // write to a layer the user never chose.
  const saveModels = async (models) => {
    const keyToUse = (effectiveSelectedApiKey && effectiveSelectedApiKey.trim())
      ? effectiveSelectedApiKey
      : (!cloudEnabled ? "sk_9router" : effectiveSelectedApiKey);
    const capabilities = {};
    for (const id of models || []) {
      const m = catalogModels.find((x) => x.fullModel === id);
      const payload = toOmpCapabilityPayload(m?.caps);
      if (payload) capabilities[id] = payload;
    }

    try {
      await persistOmpModelSelection({
        request: fetch,
        previousModels: modalInitialModelsRef.current,
        models,
        payload: {
          baseUrl: getEffectiveBaseUrl(),
          apiKey: keyToUse,
          capabilities,
        },
      });
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    } finally {
      await checkStatus();
    }
  };

  const getConfigStatus = () => {
    if (!status?.installed) return null;
    if (!status.config) return "not_configured";
    if (!status.has9Router) return "not_configured";
    const url = status.omp?.baseURL || status.config?.providers?.["9router"]?.baseUrl || "";
    return matchKnownEndpoint(url, { tunnelPublicUrl, tailscaleUrl }) ? "configured" : "other";
  };

  const configStatus = getConfigStatus();

  const getEffectiveBaseUrl = () => {
    const url = customBaseUrl || baseUrl;
    return url.endsWith("/v1") ? url : `${url}/v1`;
  };

  const getDisplayUrl = () => customBaseUrl || `${baseUrl}/v1`;

  async function checkStatus({ scope, index } = {}) {
    setChecking(true);
    try {
      const wantScope = scope ?? roleScopeRef.current;
      const wantIndex = index ?? projectIndexRef.current;
      const requestKey = scopeKeyFor(wantScope, wantIndex);
      // Only ask for a project layer when one is actually selected — the API
      // refuses to guess which project is active.
      const qs = wantScope === "project" ? `?projectIndex=${wantIndex}` : "";
      const res = await fetch(`/api/cli-tools/omp-settings${qs}`);
      const data = await res.json();
      setStatus(data);
      setSelectedModels(data?.omp?.models || []);

      const info = data?.omp?.roleScope || null;
      setScopeInfo(info);

      // Follow omp's own storage setting until the user picks a scope. When
      // detection lands on "project", seed the refs, the index and the draft
      // together — updating state alone would leave the ref stale and show an
      // empty draft for a project whose roles we already have in `info`.
      let effScope = wantScope;
      let effIndex = wantIndex;
      if (info && !scopeTouchedRef.current) {
        const firstAvailable = (info.projects || []).find((p) => p.available && !p.corrupt && !p.unsafe);
        if (info.storageMode === "project" && info.projectScopeEnabled && firstAvailable) {
          effScope = "project";
          effIndex = firstAvailable.index;
          roleScopeRef.current = effScope;
          projectIndexRef.current = effIndex;
          setRoleScope(effScope);
          setProjectIndex(effIndex);
        } else {
          effScope = "global";
          roleScopeRef.current = effScope;
          setRoleScope(effScope);
        }
      }
      const effKey = scopeKeyFor(effScope, effIndex);

      // Read the layer actually in effect, not `omp.roles` — that is the
      // *effective* layer, which differs whenever the selected scope is not
      // the one omp currently reads.
      const layer =
        effScope === "project"
          ? (info?.projects || []).find((p) => p.index === effIndex) || {}
          : info?.global || {};
      const layerRoles = layer.roles || {};
      // Roles that exist in the file but are backed by another provider still
      // need a row in the picker, or they are invisible and unassignable.
      const layerRoleIds = Array.isArray(layer.availableRoles) ? layer.availableRoles : [];

      // Populate only that layer, and only if it has no pending edits.
      if (!dirtyRoleKeys.current.has(effKey)) {
        const nextRoles = emptyOmpRoleAssignments();
        for (const key of new Set([...Object.keys(nextRoles), ...layerRoleIds, ...Object.keys(layerRoles)])) {
          if (typeof layerRoles[key] === "string") nextRoles[key] = layerRoles[key];
          else if (!(key in nextRoles)) nextRoles[key] = "";
        }
        setRoleDrafts((prev) => ({ ...prev, [effKey]: nextRoles }));
      }
    } catch (error) {
      setStatus({ installed: false, error: error.message });
    } finally {
      setChecking(false);
    }
  };
  useEffect(() => {
    if (!isExpanded) return undefined;
    // Defer so the effect body itself performs no synchronous setState;
    // checkStatus() flips `checking` immediately when called inline.
    let cancelled = false;
    const id = setTimeout(() => {
      if (cancelled) return;
      checkStatus();
      fetchModelAliases();
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
    // checkStatus/fetchModelAliases are stable declarations in this component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isExpanded]);

  const handleApply = async () => {
    setApplying(true);
    setMessage(null);
    // Snapshot the target layer and its draft at click time: the catalog POST
    // is awaited, and a scope switch mid-flight would otherwise PATCH roles
    // into a file the user never chose.
    const applyScope = roleScope;
    const applyIndex = projectIndex;
    const applyKey = scopeKeyFor(applyScope, applyIndex);
    const applyRoles = roleDrafts[applyKey] || emptyOmpRoleAssignments();
    try {
      const keyToUse = (effectiveSelectedApiKey && effectiveSelectedApiKey.trim())
        ? effectiveSelectedApiKey
        : (!cloudEnabled ? "sk_9router" : effectiveSelectedApiKey);
      const capabilities = {};
      for (const id of selectedModels || []) {
        const m = catalogModels.find((x) => x.fullModel === id);
        const caps = toOmpCapabilityPayload(m?.caps);
        if (caps) capabilities[id] = caps;
      }

      // 1. Catalog (always global). Roles are rejected by POST by design.
      const catalogRes = await fetch("/api/cli-tools/omp-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: getEffectiveBaseUrl(),
          apiKey: keyToUse,
          models: selectedModels,
          capabilities,
        }),
      });
      const catalogData = await catalogRes.json();
      if (!catalogRes.ok) {
        setMessage({ type: "error", text: catalogData.error || "Failed to apply model catalog" });
        return;
      }

      // 2. Roles, into the selected layer only.
      // Delta only: never resend untouched roles, or Apply would clear any
      // assignment whose model is not in the current picker.
      const touched = touchedRoleIds.current.get(applyKey) || new Set();
      const pruned = pruneRoleAssignments(applyRoles, selectedModels);
      const roles = {};
      for (const id of touched) roles[id] = pruned[id] ?? "";
      const roleRes = await fetch("/api/cli-tools/omp-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope: applyScope,
          ...(applyScope === "project" ? { projectIndex: applyIndex } : {}),
          roles,
        }),
      });
      const roleData = await roleRes.json();
      if (!roleRes.ok) {
        // The catalog landed; say so rather than implying nothing happened.
        setMessage({
          type: "error",
          text: `Models saved, but roles failed: ${roleData.error || "unknown error"}`,
        });
        await checkStatus();
        return;
      }

      dirtyRoleKeys.current.delete(applyKey);
      touchedRoleIds.current.delete(applyKey);
      const where = applyScope === "project" ? roleData.configPath || "project config" : "global config";
      setMessage({ type: "success", text: `Applied — roles written to ${where}` });
      await checkStatus();
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    } finally {
      setApplying(false);
    }
  };

  const handleReset = async () => {
    setRestoring(true);
    setMessage(null);
    try {
      const res = await fetch("/api/cli-tools/omp-settings", { method: "DELETE" });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: "Oh My Pi settings reset successfully!" });
        setSelectedModels([]);
        setRoleAssignments(emptyOmpRoleAssignments());
        checkStatus();
      } else {
        setMessage({ type: "error", text: data.error || "Failed to reset settings" });
      }
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    } finally {
      setRestoring(false);
    }
  };

  // omp writes ~/.omp/agent/models.yml with discovery.enabled openai-models-list
  // so the picker auto-discovers /v1/models. Capability values come from
  // /api/models at run time and are persisted by Apply, not by the modal.
  const getManualConfigs = () => {
    const keyToUse = (effectiveSelectedApiKey && effectiveSelectedApiKey.trim())
      ? effectiveSelectedApiKey
      : (!cloudEnabled ? "sk_9router" : "<API_KEY_FROM_DASHBOARD>");
    const id = selectedModels[0] || "cc/claude-opus-4-7";
    const yaml = [
      "providers:",
      "  9router:",
      "    baseUrl: " + getEffectiveBaseUrl(),
      "    api: openai-completions",
      "    apiKey: " + keyToUse,
      "    authHeader: true",
      "    discovery:",
      "      type: openai-models-list",
      "    models:",
      "      - id: " + id,
      "        name: \"" + id + "\"",
      "        input: [text]",
    ].join("\n") + "\n";
    return [{ filename: "~/.omp/agent/models.yml", content: yaml }];
  };

  return (
    <Card padding="xs" className="overflow-hidden">
      <div className="flex items-start justify-between gap-3 hover:cursor-pointer sm:items-center" onClick={onToggle}>
        <div className="flex min-w-0 items-center gap-3">
          <div className="size-8 flex items-center justify-center shrink-0">
            <Image src="/providers/oh-my-pi.svg" alt={tool.name} width={32} height={32} className="size-8 object-contain rounded-lg" sizes="32px" onError={(e) => { e.target.style.display = "none"; }} loading="lazy" decoding="async" />
          </div>
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h3 className="font-medium text-sm">{tool.name}</h3>
              {configStatus === "configured" && <span className="px-1.5 py-0.5 text-[10px] font-medium bg-green-500/10 text-green-600 dark:text-green-400 rounded-full">Connected</span>}
              {configStatus === "not_configured" && <span className="px-1.5 py-0.5 text-[10px] font-medium bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 rounded-full">Not configured</span>}
              {configStatus === "other" && <span className="px-1.5 py-0.5 text-[10px] font-medium bg-blue-500/10 text-blue-600 dark:text-blue-400 rounded-full">Other</span>}
            </div>
            <p className="text-xs text-text-muted truncate">{tool.description}</p>
          </div>
        </div>
        <span className={`material-symbols-outlined text-text-muted text-[20px] transition-transform ${isExpanded ? "rotate-180" : ""}`}>expand_more</span>
      </div>

      {isExpanded && (
        <div className="mt-4 pt-4 border-t border-border flex flex-col gap-4">
          {checking && (
            <div className="flex items-center gap-2 text-text-muted">
              <span className="material-symbols-outlined animate-spin">progress_activity</span>
              <span>Checking Oh My Pi...</span>
            </div>
          )}

          {!checking && status && !status.installed && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-3 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                <div className="flex items-start gap-3">
                  <span className="material-symbols-outlined text-yellow-500">warning</span>
                  <div className="flex-1">
                    <p className="font-medium text-yellow-600 dark:text-yellow-400">Oh My Pi (omp) CLI not detected locally</p>
                    <p className="text-sm text-text-muted">Manual configuration is still available if 9router is deployed on a remote server.</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 pl-9">
                  <Button variant="secondary" size="sm" onClick={() => setShowManualConfigModal(true)} className="!bg-yellow-500/20 !border-yellow-500/40 !text-yellow-700 dark:!text-yellow-300 hover:!bg-yellow-500/30">
                    <span className="material-symbols-outlined text-[18px] mr-1">content_copy</span>
                    Manual Config
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setShowInstallGuide(!showInstallGuide)}>
                    <span className="material-symbols-outlined text-[18px] mr-1">{showInstallGuide ? "expand_less" : "help"}</span>
                    {showInstallGuide ? "Hide" : "How to Install"}
                  </Button>
                </div>
              </div>
              {showInstallGuide && (
                <div className="p-4 bg-surface border border-border rounded-lg">
                  <h4 className="font-medium mb-3">Installation Guide</h4>
                  <div className="space-y-3 text-sm">
                    <div>
                      <p className="text-text-muted mb-1">macOS / Linux:</p>
                      <code className="block px-3 py-2 bg-black/5 dark:bg-white/5 rounded font-mono text-xs">curl -fsSL https://omp.sh/install | sh</code>
                    </div>
                    <p className="text-text-muted">After installation, run <code className="px-1 bg-black/5 dark:bg-white/5 rounded">omp --version</code> to verify.</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {!checking && status?.installed && (
            <>
              <div className="flex flex-col gap-2">
                {/* Current base URL */}
                {/* Endpoint (selector) */}
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr] sm:items-center sm:gap-2">
                  <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">Select Endpoint</span>
                  <span className="material-symbols-outlined hidden text-text-muted text-[14px] sm:inline">arrow_forward</span>
                  <BaseUrlSelect
                    value={customBaseUrl || getDisplayUrl()}
                    onChange={setCustomBaseUrl}
                    requiresExternalUrl={tool.requiresExternalUrl}
                    tunnelEnabled={tunnelEnabled}
                    tunnelPublicUrl={tunnelPublicUrl}
                    tailscaleEnabled={tailscaleEnabled}
                    tailscaleUrl={tailscaleUrl}
                  />
                </div>

                {/* Current configured */}
                {status?.omp?.baseURL && (
                  <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
                    <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">Current</span>
                    <span className="material-symbols-outlined hidden text-text-muted text-[14px] sm:inline">arrow_forward</span>
                    <span className="min-w-0 truncate rounded bg-surface/40 px-2 py-2 text-xs text-text-muted sm:py-1.5">
                      {status.omp.baseURL}
                    </span>
                  </div>
                )}

                {/* API Key */}
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
                  <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">API Key</span>
                  <span className="material-symbols-outlined hidden text-text-muted text-[14px] sm:inline">arrow_forward</span>
                  <ApiKeySelect value={effectiveSelectedApiKey} onChange={setSelectedApiKey} apiKeys={apiKeys} cloudEnabled={cloudEnabled} />
                </div>

                {/* Models */}
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr] sm:items-start sm:gap-2">
                  <span className="w-32 shrink-0 text-sm font-semibold text-text-main text-right pt-1">Models</span>
                  <span className="material-symbols-outlined text-text-muted text-[14px] mt-1.5">arrow_forward</span>
                  <div className="flex-1 flex flex-col gap-2">
                    <div className="flex flex-wrap gap-1.5 min-h-[28px] px-2 py-1.5 bg-surface rounded border border-border">
                      {selectedModels.length === 0 ? (
                        <span className="text-xs text-text-muted">No models selected</span>
                      ) : (
                        selectedModels.map((model) => (
                          <span
                            key={model}
                            onClick={() => {
                              if (model === roleAssignments.default) {
                                markRoleTouched(currentScopeKey, "default");
                                setRoleAssignments((prev) => ({ ...prev, default: "" }));
                              } else {
                                markRoleTouched(currentScopeKey, "default");
                                setRoleAssignments((prev) => ({ ...prev, default: model }));
                              }
                            }}
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs cursor-pointer transition-colors ${
                              model === roleAssignments.default
                                ? "bg-primary/10 text-primary border border-primary"
                                : "bg-black/5 dark:bg-white/5 text-text-muted border border-transparent hover:border-border"
                            }`}
                            title={model === roleAssignments.default ? "Click to clear default role" : "Click to set as default role"}
                          >
                            {model === roleAssignments.default && <span className="material-symbols-outlined text-[10px]">star</span>}
                            {model}
                            <button
                              onClick={async (e) => {
                                e.stopPropagation();
                                try {
                                  const res = await fetch(`/api/cli-tools/omp-settings?model=${encodeURIComponent(model)}`, { method: "DELETE" });
                                  if (res.ok) {
                                    setSelectedModels((prev) => prev.filter((id) => id !== model));
                                    // DELETE already blanked these server-side, so
                                    // this only mirrors disk into the picker. Do NOT
                                    // markRoleTouched: that would make a later Apply
                                    // PATCH "" and clobber any external reassignment
                                    // made since, which checkStatus() cannot correct
                                    // while the scope is dirty.
                                    setRoleAssignments((prev) => {
                                      const next = { ...prev };
                                      for (const role of Object.keys(next)) {
                                        if (next[role] === model) next[role] = "";
                                      }
                                      return next;
                                    });
                                    checkStatus();
                                  }
                                } catch (error) {
                                  console.log("Error removing model:", error);
                                }
                              }}
                              className="ml-0.5 hover:text-red-500"
                            >
                              <span className="material-symbols-outlined text-[12px]">close</span>
                            </button>
                          </span>
                        ))
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => { modalInitialModelsRef.current = [...selectedModelsRef.current]; setModalOpen(true); }} disabled={!activeProviders?.length} className={`px-2 py-1 rounded border text-xs transition-colors ${activeProviders?.length ? "bg-surface border-border text-text-main hover:border-primary cursor-pointer" : "opacity-50 cursor-not-allowed border-border"}`}>Add Model</button>
                      <span className="text-xs text-text-muted">
                        {selectedModels.length > 0 && roleAssignments.default ? (
                          <>Default: <span className="text-primary">{roleAssignments.default}</span></>
                        ) : selectedModels.length > 0 ? (
                          <span className="text-yellow-500">Assign OMP roles below, then Apply</span>
                        ) : (
                          "Select models to add"
                        )}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr] sm:items-start sm:gap-2">
                  <span className="w-32 shrink-0 text-sm font-semibold text-text-main text-right pt-1">Role scope</span>
                  <span className="material-symbols-outlined text-text-muted text-[14px] mt-1.5">arrow_forward</span>
                  <div className="flex-1 flex flex-col gap-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <select
                        value={roleScope}
                        onChange={(e) => {
                          const next = e.target.value;
                          scopeTouchedRef.current = true;
                          setScopeTouched(true);
                          roleScopeRef.current = next;
                          setRoleScope(next);
                          checkStatus({ scope: next, index: projectIndex });
                        }}
                        className="px-2 py-1 rounded border border-border bg-surface text-xs text-text-main"
                      >
                        <option value="global">Global (~/.omp/agent/config.yml)</option>
                        <option value="project" disabled={!scopeInfo?.projectScopeEnabled}>
                          Project (&lt;project&gt;/.omp/config.yml)
                        </option>
                      </select>

                      {roleScope === "project" && (scopeInfo?.projects || []).length > 1 && (
                        <select
                          value={projectIndex}
                          onChange={(e) => {
                            const idx = Number(e.target.value);
                            scopeTouchedRef.current = true;
                          setScopeTouched(true);
                            projectIndexRef.current = idx;
                            setProjectIndex(idx);
                            checkStatus({ scope: "project", index: idx });
                          }}
                          className="px-2 py-1 rounded border border-border bg-surface text-xs text-text-main"
                        >
                          {(scopeInfo?.projects || []).map((p) => (
                            <option key={p.index} value={p.index} disabled={!p.available}>
                              {p.path}{p.available ? "" : " (unavailable)"}
                            </option>
                          ))}
                        </select>
                      )}

                      {scopeInfo?.storageMode && (
                        <span className="text-[11px] text-text-muted">
                          omp reads: <span className="font-medium text-text-main">{scopeInfo.storageMode}</span>
                        </span>
                      )}
                    </div>

                    {!scopeInfo?.projectScopeEnabled && (
                      <p className="text-[11px] text-text-muted">
                        Project scope is disabled. Set <code>OMP_PROJECT_ROOTS</code> to the absolute
                        project path(s) allowed to receive role writes, then restart 9Router.
                      </p>
                    )}
                    {scopeInfo?.storageMode === "project" && roleScope === "global" && (
                      <p className="text-[11px] text-yellow-500">
                        omp is reading project roles — assignments written here will not take effect.
                      </p>
                    )}
                    {scopeInfo?.storageMode === "global" && roleScope === "project" && (
                      <p className="text-[11px] text-yellow-500">
                        omp is reading global roles — assignments written here will not take effect
                        until <code>modelRoleStorage: project</code> is set.
                      </p>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr] sm:items-start sm:gap-2">
                  <span className="w-32 shrink-0 text-sm font-semibold text-text-main text-right pt-1">OMP roles</span>
                  <span className="material-symbols-outlined text-text-muted text-[14px] mt-1.5">arrow_forward</span>
                  <div className="flex-1 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                    {OMP_MODEL_ROLES.map((role) => (
                      <label key={role.id} className="flex flex-col gap-0.5 min-w-0">
                        <span className="text-[11px] font-medium text-text-main">
                          {role.name}
                          <span className="ml-1 font-normal text-text-muted">({role.id})</span>
                        </span>
                        <select
                          value={roleAssignments[role.id] || ""}
                          disabled={selectedModels.length === 0}
                          title={role.hint}
                          onChange={(e) => {
                            const value = e.target.value;
                            markRoleTouched(currentScopeKey, role.id);
                            setRoleAssignments((prev) => ({ ...prev, [role.id]: value }));
                          }}
                          className="w-full min-w-0 px-2 py-1 rounded border border-border bg-surface text-xs text-text-main disabled:opacity-50"
                        >
                          <option value="">Unset</option>
                          {selectedModels.map((modelId) => (
                            <option key={modelId} value={modelId}>{describeModelOption(modelId)}</option>
                          ))}
                        </select>
                      </label>
                    ))}

                    {/* Custom roles omp reports beyond the ten built-ins. */}
                    {Object.keys(roleAssignments)
                      .filter((id) => !OMP_MODEL_ROLES.some((r) => r.id === id))
                      .map((id) => (
                        <label key={id} className="flex flex-col gap-0.5 min-w-0">
                          <span className="text-[11px] font-medium text-text-main">
                            {id}
                            <span className="ml-1 font-normal text-text-muted">(custom)</span>
                          </span>
                          <select
                            value={roleAssignments[id] || ""}
                            disabled={selectedModels.length === 0}
                            onChange={(e) => {
                              const value = e.target.value;
                              markRoleTouched(currentScopeKey, id);
                              setRoleAssignments((prev) => ({ ...prev, [id]: value }));
                            }}
                            className="w-full min-w-0 px-2 py-1 rounded border border-border bg-surface text-xs text-text-main disabled:opacity-50"
                          >
                            <option value="">Unset</option>
                            {selectedModels.map((modelId) => (
                              <option key={modelId} value={modelId}>{describeModelOption(modelId)}</option>
                            ))}
                          </select>
                        </label>
                      ))}
                  </div>
                </div>

              </div>

              {message && (
                <div className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs ${message.type === "success" ? "bg-green-500/10 text-green-600" : "bg-red-500/10 text-red-600"}`}>
                  <span className="material-symbols-outlined text-[14px]">{message.type === "success" ? "check_circle" : "error"}</span>
                  <span>{message.text}</span>
                </div>
              )}

              <div className="grid grid-cols-1 gap-2 sm:flex sm:items-center">
                <Button variant="primary" size="sm" onClick={handleApply} disabled={selectedModels.length === 0} loading={applying}>
                  <span className="material-symbols-outlined text-[14px] mr-1">save</span>Apply
                </Button>
                <Button variant="outline" size="sm" onClick={handleReset} disabled={!status.has9Router} loading={restoring}>
                  <span className="material-symbols-outlined text-[14px] mr-1">restore</span>Reset
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setShowManualConfigModal(true)}>
                  <span className="material-symbols-outlined text-[14px] mr-1">content_copy</span>Manual Config
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      {modalOpen && (
        <ModelSelectModal
          isOpen={modalOpen}
          onClose={() => {
            setModalOpen(false);
            saveModels(selectedModelsRef.current);
          }}
          onSelect={(model) => {
            if (!selectedModels.includes(model.value)) {
              setSelectedModels([...selectedModels, model.value]);
            }
          }}
          onDeselect={(model) => {
            const remaining = selectedModels.filter((id) => id !== model.value);
            setSelectedModels(remaining);
            setRoleAssignments((prev) => pruneRoleAssignments(prev, remaining));
          }}
          selectedModel={null}
          activeProviders={activeProviders}
          modelAliases={modelAliases}
          addedModelValues={selectedModels}
          closeOnSelect={false}
          title="Add Model for Oh My Pi"
        />
      )}


      <ManualConfigModal
        isOpen={showManualConfigModal}
        onClose={() => setShowManualConfigModal(false)}
        title="Oh My Pi - Manual Configuration"
        configs={getManualConfigs()}
      />
    </Card>
  );
}
