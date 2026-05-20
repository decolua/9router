"use client";

import { useState, useEffect, useRef } from "react";
import { Card, Button, ModelSelectModal, ManualConfigModal } from "@/shared/components";
import Image from "next/image";
import BaseUrlSelect from "./BaseUrlSelect";
import ApiKeySelect from "./ApiKeySelect";
import { matchKnownEndpoint } from "./cliEndpointMatch";
import { getProviderInfo, groupModelsByProvider } from "./providerPrefixMap";

export default function OpenCodeToolCard({ tool, isExpanded, onToggle, baseUrl, apiKeys, activeProviders, cloudEnabled, initialStatus, tunnelEnabled, tunnelPublicUrl, tailscaleEnabled, tailscaleUrl }) {
  const [status, setStatus] = useState(initialStatus || null);
  const [checking, setChecking] = useState(false);
  const [applying, setApplying] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [message, setMessage] = useState(null);
  const [showInstallGuide, setShowInstallGuide] = useState(false);
  const [selectedApiKey, setSelectedApiKey] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [subagentModel, setSubagentModel] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [subagentModalOpen, setSubagentModalOpen] = useState(false);
  const [modelAliases, setModelAliases] = useState({});
  const [showManualConfigModal, setShowManualConfigModal] = useState(false);
  const [customBaseUrl, setCustomBaseUrl] = useState("");
  const [selectedModels, setSelectedModels] = useState([]);
  const [activeModel, setActiveModel] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState({});
  const selectedModelsRef = useRef([]);

  useEffect(() => {
    selectedModelsRef.current = selectedModels;
  }, [selectedModels]);

  useEffect(() => {
    if (apiKeys?.length > 0 && !selectedApiKey) {
      setSelectedApiKey(apiKeys[0].key);
    }
  }, [apiKeys, selectedApiKey]);

  useEffect(() => {
    if (initialStatus) setStatus(initialStatus);
  }, [initialStatus]);

  useEffect(() => {
    if (isExpanded && !status) {
      checkStatus();
      fetchModelAliases();
    }
    if (isExpanded) fetchModelAliases();
  }, [isExpanded]);

  // Sync models from existing config
  useEffect(() => {
    if (status?.opencode?.models) {
      setSelectedModels(status.opencode.models);
    }
    if (status?.opencode?.activeModel) {
      setActiveModel(status.opencode.activeModel);
    }

    // Parse subagent settings from agent.explorer if exists
    if (status?.config?.agent?.explorer?.model?.startsWith("9router/")) {
      setSubagentModel(status.config.agent.explorer.model.replace("9router/", ""));
    }
  }, [status]);

  // Collapse all groups by default, expand only the group containing activeModel
  useEffect(() => {
    const models = status?.opencode?.models || selectedModels;
    const active = status?.opencode?.activeModel || activeModel;
    const groups = groupModelsByProvider(models);
    const activeGroupKey = active ? (getProviderInfo(active).prefix || "__other__") : null;
    const initial = {};
    for (const key of Object.keys(groups)) {
      initial[key] = key !== activeGroupKey;
    }
    setCollapsedGroups(initial);
  }, [status?.opencode?.models, status?.opencode?.activeModel]);

  const fetchModelAliases = async () => {
    try {
      const res = await fetch("/api/models/alias");
      const data = await res.json();
      if (res.ok) setModelAliases(data.aliases || {});
    } catch (error) {
      console.log("Error fetching model aliases:", error);
    }
  };

  const saveModels = async (models) => {
    try {
      const keyToUse = (selectedApiKey && selectedApiKey.trim())
        ? selectedApiKey
        : (!cloudEnabled ? "sk_9router" : selectedApiKey);
      const validActiveModel = models.includes(activeModel) ? activeModel : (models[0] || "");
      await fetch("/api/cli-tools/opencode-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: getEffectiveBaseUrl(),
          apiKey: keyToUse,
          models,
          activeModel: validActiveModel,
          subagentModel,
        }),
      });
    } catch (error) {
      console.log("Error saving models:", error);
    }
  };

  const getConfigStatus = () => {
    if (!status?.installed) return null;
    if (!status.config) return "not_configured";
    if (!status.has9Router) return "not_configured";
    const url = status.config?.provider?.["9router"]?.options?.baseURL || "";
    return matchKnownEndpoint(url, { tunnelPublicUrl, tailscaleUrl }) ? "configured" : "other";
  };

  const configStatus = getConfigStatus();

  const getEffectiveBaseUrl = () => {
    const url = customBaseUrl || baseUrl;
    return url.endsWith("/v1") ? url : `${url}/v1`;
  };

  const getDisplayUrl = () => customBaseUrl || `${baseUrl}/v1`;

  const checkStatus = async () => {
    setChecking(true);
    try {
      const res = await fetch("/api/cli-tools/opencode-settings");
      const data = await res.json();
      setStatus(data);
    } catch (error) {
      setStatus({ installed: false, error: error.message });
    } finally {
      setChecking(false);
    }
  };

  const handleApply = async () => {
    setApplying(true);
    setMessage(null);
    try {
      const keyToUse = (selectedApiKey && selectedApiKey.trim())
        ? selectedApiKey
        : (!cloudEnabled ? "sk_9router" : selectedApiKey);

      const res = await fetch("/api/cli-tools/opencode-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: getEffectiveBaseUrl(),
          apiKey: keyToUse,
          models: selectedModels,
          activeModel: activeModel === "" ? "" : (activeModel || selectedModels[0]),
          subagentModel: subagentModel
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: "Settings applied successfully!" });
        checkStatus();
      } else {
        setMessage({ type: "error", text: data.error || "Failed to apply settings" });
      }
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
      const res = await fetch("/api/cli-tools/opencode-settings", { method: "DELETE" });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: "Settings reset successfully!" });
        setSelectedModel("");
        setSubagentModel("");
        setSelectedModels([]);
        setActiveModel("");
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

  const getManualConfigs = () => {
    const keyToUse = (selectedApiKey && selectedApiKey.trim())
      ? selectedApiKey
      : (!cloudEnabled ? "sk_9router" : "<API_KEY_FROM_DASHBOARD>");

    const modelsToShow = selectedModels.length > 0 ? selectedModels : ["provider/model-id"];
    const activeModelToShow = activeModel || selectedModels[0] || modelsToShow[0];
    const effectiveSubagentModel = subagentModel || activeModelToShow;

    const modelsObj = {};
    modelsToShow.forEach(m => {
      modelsObj[m] = { name: m, modalities: { input: ["text", "image"], output: ["text"] } };
    });

    return [{
      filename: "~/.config/opencode/opencode.json",
      content: JSON.stringify({
        provider: {
          "9router": {
            npm: "@ai-sdk/openai-compatible",
            options: { baseURL: getEffectiveBaseUrl(), apiKey: keyToUse },
            models: modelsObj,
          },
        },
        model: `9router/${activeModelToShow}`,
        agent: {
          explorer: {
            description: "Fast explorer subagent for codebase exploration",
            mode: "subagent",
            model: `9router/${effectiveSubagentModel}`
          }
        }
      }, null, 2),
    }];
  };

  return (
    <Card padding="xs" className="overflow-hidden">
      <div className="flex items-start justify-between gap-3 hover:cursor-pointer sm:items-center" onClick={onToggle}>
        <div className="flex min-w-0 items-center gap-3">
          <div className="size-8 flex items-center justify-center shrink-0">
            <Image src="/providers/opencode.png" alt={tool.name} width={32} height={32} className="size-8 object-contain rounded-lg" sizes="32px" onError={(e) => { e.target.style.display = "none"; }} />
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
              <span>Checking OpenCode CLI...</span>
            </div>
          )}

          {!checking && status && !status.installed && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-3 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                <div className="flex items-start gap-3">
                  <span className="material-symbols-outlined text-yellow-500">warning</span>
                  <div className="flex-1">
                    <p className="font-medium text-yellow-600 dark:text-yellow-400">OpenCode CLI not detected locally</p>
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
                      <code className="block px-3 py-2 bg-black/5 dark:bg-white/5 rounded font-mono text-xs">npm install -g opencode-ai</code>
                    </div>
                    <p className="text-text-muted">After installation, run <code className="px-1 bg-black/5 dark:bg-white/5 rounded">opencode</code> to verify.</p>
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
                {status?.config?.provider?.["9router"]?.options?.baseURL && (
                  <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
                    <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">Current</span>
                    <span className="material-symbols-outlined hidden text-text-muted text-[14px] sm:inline">arrow_forward</span>
                    <span className="min-w-0 truncate rounded bg-surface/40 px-2 py-2 text-xs text-text-muted sm:py-1.5">
                      {status.config.provider["9router"].options.baseURL}
                    </span>
                  </div>
                )}

                {/* API Key */}
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
                  <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">API Key</span>
                  <span className="material-symbols-outlined hidden text-text-muted text-[14px] sm:inline">arrow_forward</span>
                  <ApiKeySelect value={selectedApiKey} onChange={setSelectedApiKey} apiKeys={apiKeys} cloudEnabled={cloudEnabled} />
                </div>

                {/* Models */}
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr] sm:items-start sm:gap-2">
                  <span className="w-32 shrink-0 text-sm font-semibold text-text-main text-right pt-1">Models</span>
                  <span className="material-symbols-outlined text-text-muted text-[14px] mt-1.5">arrow_forward</span>
                  <div className="flex-1 flex flex-col gap-2">
                    <div className="rounded border border-border overflow-hidden">
                      {selectedModels.length === 0 ? (
                        <div className="flex items-center min-h-[28px] px-2 py-1.5 bg-surface">
                          <span className="text-xs text-text-muted">No models selected</span>
                        </div>
                      ) : (
                        <div className="flex flex-col">
                          {Object.entries(groupModelsByProvider(selectedModels)).map(([groupKey, group], idx, arr) => {
                            const isCollapsed = collapsedGroups[groupKey];
                            return (
                              <div key={groupKey} className={idx < arr.length - 1 ? "border-b border-border" : ""}>
                                {/* Group header */}
                                <button
                                  type="button"
                                  onClick={() => setCollapsedGroups(prev => ({ ...prev, [groupKey]: !prev[groupKey] }))}
                                  className="w-full flex items-center gap-1.5 px-2 py-1.5 bg-surface hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                                >
                                   {group.isCombo ? (
                                     <span className="material-symbols-outlined text-primary shrink-0" style={{ fontSize: "14px", width: "14px", height: "14px" }}>layers</span>
                                   ) : group.icon ? (
                                     <Image src={group.icon} alt={group.name} width={14} height={14} className="size-3.5 object-contain rounded-sm shrink-0" onError={(e) => { e.target.style.display = "none"; }} />
                                   ) : (
                                     <span className="material-symbols-outlined text-text-muted shrink-0" style={{ fontSize: "14px", width: "14px", height: "14px" }}>smart_toy</span>
                                   )}
                                  <span className="text-xs font-medium text-text-main flex-1 text-left">{group.name}</span>
                                   <span className="text-xs text-text-muted mr-1">{group.models.length}</span>
                                  <span className={`material-symbols-outlined text-[14px] text-text-muted transition-transform ${isCollapsed ? "-rotate-90" : ""}`}>expand_more</span>
                                </button>
                                 {/* Group models */}
                                 {!isCollapsed && (
                                   <div className="flex flex-wrap gap-1.5 px-2 py-1.5 bg-black/[0.02] dark:bg-white/[0.02] border-t border-border">
                                     {group.models.slice().sort((a, b) => a.localeCompare(b)).map((model) => {
                                       const { modelName } = getProviderInfo(model);
                                       const isActive = model === activeModel;
                                       return (
                                         <span
                                           key={model}
                                           onClick={async () => {
                                             if (isActive) {
                                               try {
                                                 const res = await fetch("/api/cli-tools/opencode-settings", {
                                                   method: "PATCH",
                                                   headers: { "Content-Type": "application/json" },
                                                   body: JSON.stringify({ clearActiveModel: true }),
                                                 });
                                                 if (res.ok) {
                                                   setActiveModel("");
                                                   // Don't collapse group when clearing active
                                                   checkStatus();
                                                 }
                                               } catch (error) {
                                                 console.log("Error clearing active model:", error);
                                               }
                                             } else {
                                               const newGroupKey = getProviderInfo(model).prefix || "__other__";
                                               const oldGroupKey = activeModel ? (getProviderInfo(activeModel).prefix || "__other__") : null;
                                               setActiveModel(model);
                                               setCollapsedGroups(prev => {
                                                 const next = { ...prev, [newGroupKey]: false };
                                                 if (oldGroupKey && oldGroupKey !== newGroupKey) next[oldGroupKey] = true;
                                                 return next;
                                               });
                                             }
                                           }}
                                           className={`group/chip relative inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs cursor-pointer transition-colors overflow-hidden ${
                                             isActive
                                               ? "bg-primary/10 text-primary border border-primary pl-10"
                                               : "bg-black/5 dark:bg-white/5 text-text-muted border border-transparent hover:border-border"
                                           }`}
                                           title={isActive ? "Click to clear active model" : "Click to set as active"}
                                         >
                                           {isActive && (
                                             <span className="absolute left-0 top-0 bottom-0 aspect-square flex items-center justify-center bg-primary text-white">
                                               <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>check</span>
                                             </span>
                                           )}
                                           {modelName}
                                            <button
                                              onClick={async (e) => {
                                                e.stopPropagation();
                                                try {
                                                  const res = await fetch(`/api/cli-tools/opencode-settings?model=${encodeURIComponent(model)}`, { method: "DELETE" });
                                                  if (res.ok) {
                                                    const newModels = selectedModels.filter((m) => m !== model);
                                                    setSelectedModels(newModels);
                                                    if (activeModel === model) setActiveModel("");
                                                    checkStatus();
                                                  }
                                                } catch (error) {
                                                  console.log("Error removing model:", error);
                                                }
                                              }}
                                              title="Remove model"
                                              className="flex items-center justify-center shrink-0 ml-0.5 cursor-pointer text-white hover:text-red-400 transition-colors"
                                            >
                                              <span className="material-symbols-outlined text-[12px]">close</span>
                                            </button>
                                         </span>
                                       );
                                     })}
                                   </div>
                                 )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        onClick={() => setModalOpen(true)}
                        disabled={!activeProviders?.length}
                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition-colors ${activeProviders?.length ? "bg-primary text-white hover:bg-primary-hover cursor-pointer" : "opacity-50 cursor-not-allowed bg-surface border border-border text-text-muted"}`}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: "12px" }}>add</span>
                        Add Model
                      </button>
                      {selectedModels.length > 0 && !activeModel && (
                        <span className="text-xs text-yellow-500">Click a model to set as active</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Subagent Model */}
                 <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
                   <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">Subagent Model</span>
                   <span className="material-symbols-outlined hidden text-text-muted text-[14px] sm:inline">arrow_forward</span>
                   <div className="relative w-full min-w-0">
                     <input
                       type="text"
                       value={subagentModel}
                       onChange={(e) => setSubagentModel(e.target.value)}
                       placeholder={selectedModel || "provider/model-id (defaults to main model)"}
                       className="w-full min-w-0 px-2 py-2 bg-surface rounded border border-border text-xs focus:outline-none focus:ring-1 focus:ring-primary/50 sm:py-1.5 pr-7"
                     />
                     {subagentModel && (
                       <button
                         onClick={() => setSubagentModel("")}
                         className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 text-text-muted hover:text-red-500 rounded transition-colors"
                         title="Clear (will use main model)"
                       >
                         <span className="material-symbols-outlined text-[14px]">close</span>
                       </button>
                     )}
                   </div>
                   <button
                     onClick={() => setSubagentModalOpen(true)}
                     disabled={!activeProviders?.length}
                     className={`w-full sm:w-auto inline-flex items-center gap-1 rounded px-2.5 py-2 text-xs font-medium transition-colors sm:py-1.5 whitespace-nowrap sm:shrink-0 ${activeProviders?.length ? "bg-primary text-white hover:bg-primary-hover cursor-pointer" : "opacity-50 cursor-not-allowed bg-surface border border-border text-text-muted"}`}
                   >
                     <span className="material-symbols-outlined" style={{ fontSize: "12px" }}>smart_toy</span>
                     Select Model
                   </button>
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

      <ModelSelectModal
        isOpen={modalOpen}
        onClose={() => {
          setModalOpen(false);
          saveModels(selectedModelsRef.current);
        }}
        onSelect={(model) => {
          if (!selectedModels.includes(model.value)) {
            setSelectedModels(prev => {
              const next = [...prev, model.value];
              if (!activeModel) setActiveModel(model.value);
              return next;
            });
          }
        }}
        onSelectMany={(models) => {
          setSelectedModels(prev => {
            const toAdd = models.map(m => m.value).filter(v => !prev.includes(v));
            const next = [...prev, ...toAdd];
            if (!activeModel && toAdd.length > 0) setActiveModel(toAdd[0]);
            return next;
          });
        }}
        onDeselect={(model) => {
          setSelectedModels(prev => {
            const remaining = prev.filter(m => m !== model.value);
            if (activeModel === model.value) setActiveModel(remaining[0] || "");
            return remaining;
          });
        }}
        onDeselectMany={(models) => {
          const values = new Set(models.map(m => m.value));
          setSelectedModels(prev => {
            const remaining = prev.filter(m => !values.has(m));
            if (values.has(activeModel)) setActiveModel(remaining[0] || "");
            return remaining;
          });
        }}
        selectedModel={null}
        activeProviders={activeProviders}
        modelAliases={modelAliases}
        addedModelValues={selectedModels}
        closeOnSelect={false}
        title="Add Model for OpenCode"
      />

      <ModelSelectModal
        isOpen={subagentModalOpen}
        onClose={() => setSubagentModalOpen(false)}
        onSelect={(model) => { setSubagentModel(model.value); setSubagentModalOpen(false); }}
        selectedModel={subagentModel}
        activeProviders={activeProviders}
        modelAliases={modelAliases}
        title="Select Subagent Model for OpenCode"
      />

      <ManualConfigModal
        isOpen={showManualConfigModal}
        onClose={() => setShowManualConfigModal(false)}
        title="OpenCode - Manual Configuration"
        configs={getManualConfigs()}
      />
    </Card>
  );
}
