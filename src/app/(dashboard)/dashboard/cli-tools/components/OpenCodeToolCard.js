"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { Card, Button, ModelSelectModal, ManualConfigModal } from "@/shared/components";
import Image from "next/image";
import BaseUrlSelect from "./BaseUrlSelect";
import ApiKeySelect from "./ApiKeySelect";
import { matchKnownEndpoint } from "./cliEndpointMatch";

export default function OpenCodeToolCard({ tool, isExpanded, onToggle, baseUrl, apiKeys, activeProviders, cloudEnabled, initialStatus, tunnelEnabled, tunnelPublicUrl, tailscaleEnabled, tailscaleUrl }) {
  // Local fetch/mutation result only. Parent initialStatus flows through without sync effect.
  const [fetchedStatus, setFetchedStatus] = useState(null);
  const [checking, setChecking] = useState(false);
  const [applying, setApplying] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [message, setMessage] = useState(null);
  const [showInstallGuide, setShowInstallGuide] = useState(false);
  // Explicit user selections only — derived values computed at render time.
  const [userSelectedApiKey, setUserSelectedApiKey] = useState("");
  // null = not yet overridden (fall through to status); [] = explicitly cleared.
  const [userSelectedModels, setUserSelectedModels] = useState(null);
  const [userActiveModel, setUserActiveModel] = useState(null);
  const [userSubagentModel, setUserSubagentModel] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [subagentModalOpen, setSubagentModalOpen] = useState(false);
  const [modelAliases, setModelAliases] = useState({});
  const [showManualConfigModal, setShowManualConfigModal] = useState(false);
  const [customBaseUrl, setCustomBaseUrl] = useState("");
  // Suppress stale status fallbacks after user resets, until re-fetch completes.
  const [modelsResetByUser, setModelsResetByUser] = useState(false);

  // Derived: local fetch/mutation result takes precedence over parent prop.
  const status = fetchedStatus ?? initialStatus ?? null;

  // Effective models: user list (if explicitly set) > status list (unless reset) > [].
  const effectiveModels = useMemo(
    () => userSelectedModels !== null
      ? userSelectedModels
      : (!modelsResetByUser ? (status?.opencode?.models ?? []) : []),
    [userSelectedModels, modelsResetByUser, status]
  );

  // Effective active model: user pick > status value (unless reset) > "".
  const statusActiveModel = status?.opencode?.activeModel || "";
  const effectiveActiveModel =
    userActiveModel !== null
      ? userActiveModel
      : (!modelsResetByUser ? statusActiveModel : "");

  // Effective subagent model: null = not overridden (use status); "" = explicit clear; string = user value.
  const statusSubagentModel = (status?.config?.agent?.explorer?.model || "").replace("9router/", "");
  const effectiveSubagentModel =
    userSubagentModel !== null
      ? userSubagentModel
      : (!modelsResetByUser ? statusSubagentModel : "");

  // Effective api key: explicit user selection > first available > empty.
  const effectiveSelectedApiKey = userSelectedApiKey || apiKeys?.[0]?.key || "";

  // Ref so modal onClose can call saveModels with latest effectiveModels without stale closure.
  const effectiveModelsRef = useRef(effectiveModels);
  useEffect(() => { effectiveModelsRef.current = effectiveModels; }, [effectiveModels]);

  const getConfigStatus = () => {
    if (!status?.installed) return null;
    if (!status.config) return "not_configured";
    if (!status.has9Router) return "not_configured";
    const url = status.config?.provider?.["9router"]?.options?.baseURL || "";
    return matchKnownEndpoint(url, { tunnelPublicUrl, tailscaleUrl }) ? "configured" : "other";
  };

  const configStatus = getConfigStatus();

  // showChecking: explicit check in progress OR initial auto-check still pending.
  const showChecking = checking || (isExpanded && !status);

  // Auto-check: inline fetch chain — no synchronous setState in effect body.
  useEffect(() => {
    if (isExpanded && !status) {
      fetch("/api/cli-tools/opencode-settings")
        .then(r => r.json())
        .then(data => { setFetchedStatus(data); })
        .catch(err => { setFetchedStatus({ installed: false, error: err.message }); });
    }
  }, [isExpanded, status]);

  // Alias fetch: separate effect so status changes while expanded don't re-fire it.
  useEffect(() => {
    if (isExpanded) {
      fetch("/api/models/alias")
        .then(r => r.json())
        .then(data => { if (data) setModelAliases(data.aliases || {}); })
        .catch(() => {});
    }
  }, [isExpanded]);

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
      setFetchedStatus(data);
    } catch (error) {
      setFetchedStatus({ installed: false, error: error.message });
    } finally {
      setChecking(false);
    }
  };

  const saveModels = async (models) => {
    try {
      const keyToUse = (effectiveSelectedApiKey && effectiveSelectedApiKey.trim())
        ? effectiveSelectedApiKey
        : (!cloudEnabled ? "sk_9router" : effectiveSelectedApiKey);
      const validActiveModel = models.includes(effectiveActiveModel) ? effectiveActiveModel : (models[0] || "");
      await fetch("/api/cli-tools/opencode-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: getEffectiveBaseUrl(),
          apiKey: keyToUse,
          models,
          activeModel: validActiveModel,
          subagentModel: effectiveSubagentModel,
        }),
      });
    } catch (error) {
      console.log("Error saving models:", error);
    }
  };

  const handleApply = async () => {
    setApplying(true);
    setMessage(null);
    try {
      const keyToUse = (effectiveSelectedApiKey && effectiveSelectedApiKey.trim())
        ? effectiveSelectedApiKey
        : (!cloudEnabled ? "sk_9router" : effectiveSelectedApiKey);

      const res = await fetch("/api/cli-tools/opencode-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: getEffectiveBaseUrl(),
          apiKey: keyToUse,
          models: effectiveModels,
          activeModel: effectiveActiveModel === "" ? "" : (effectiveActiveModel || effectiveModels[0]),
          subagentModel: effectiveSubagentModel,
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
        // Clear user overrides and suppress stale status fallbacks until re-fetch.
        setUserSelectedModels([]);
        setUserActiveModel("");
        setUserSubagentModel("");
        setModelsResetByUser(true);
        checkStatus().then(() => setModelsResetByUser(false));
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
    const keyToUse = (effectiveSelectedApiKey && effectiveSelectedApiKey.trim())
      ? effectiveSelectedApiKey
      : (!cloudEnabled ? "sk_9router" : "<API_KEY_FROM_DASHBOARD>");

    const modelsToShow = effectiveModels.length > 0 ? effectiveModels : ["provider/model-id"];
    const activeModelToShow = effectiveActiveModel || effectiveModels[0] || modelsToShow[0];
    const subagentModelToShow = effectiveSubagentModel || activeModelToShow;

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
            model: `9router/${subagentModelToShow}`,
          },
        },
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
          {showChecking && (
            <div className="flex items-center gap-2 text-text-muted">
              <span className="material-symbols-outlined animate-spin">progress_activity</span>
              <span>Checking OpenCode CLI...</span>
            </div>
          )}

          {!showChecking && status && !status.installed && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-3 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                <div className="flex items-start gap-3">
                  <span className="material-symbols-outlined text-yellow-500">warning</span>
                  <div className="flex-1">
                    <p className="font-medium text-yellow-600 dark:text-yellow-400">OpenCode CLI not detected locally</p>
                    <p className="text-sm text-text-muted">Manual configuration is still available if DurinDoor is deployed on a remote server.</p>
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

          {!showChecking && status?.installed && (
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
                  <ApiKeySelect value={effectiveSelectedApiKey} onChange={setUserSelectedApiKey} apiKeys={apiKeys} cloudEnabled={cloudEnabled} />
                </div>

                {/* Models */}
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr] sm:items-start sm:gap-2">
                  <span className="w-32 shrink-0 text-sm font-semibold text-text-main text-right pt-1">Models</span>
                  <span className="material-symbols-outlined text-text-muted text-[14px] mt-1.5">arrow_forward</span>
                  <div className="flex-1 flex flex-col gap-2">
                    <div className="flex flex-wrap gap-1.5 min-h-[28px] px-2 py-1.5 bg-surface rounded border border-border">
                      {effectiveModels.length === 0 ? (
                        <span className="text-xs text-text-muted">No models selected</span>
                      ) : (
                        effectiveModels.map((model) => (
                          <span
                            key={model}
                            onClick={async () => {
                              if (model === effectiveActiveModel) {
                                try {
                                  const res = await fetch("/api/cli-tools/opencode-settings", {
                                    method: "PATCH",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({ clearActiveModel: true }),
                                  });
                                  if (res.ok) {
                                    setUserActiveModel("");
                                    checkStatus();
                                  }
                                } catch (error) {
                                  console.log("Error clearing active model:", error);
                                }
                              } else {
                                setUserActiveModel(model);
                              }
                            }}
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs cursor-pointer transition-colors ${
                              model === effectiveActiveModel
                                ? "bg-primary/10 text-primary border border-primary"
                                : "bg-black/5 dark:bg-white/5 text-text-muted border border-transparent hover:border-border"
                            }`}
                            title={model === effectiveActiveModel ? "Click to clear active model" : "Click to set as active"}
                          >
                            {model === effectiveActiveModel && <span className="material-symbols-outlined text-[10px]">star</span>}
                            {model}
                            <button
                              onClick={async (e) => {
                                e.stopPropagation();
                                try {
                                  const res = await fetch(`/api/cli-tools/opencode-settings?model=${encodeURIComponent(model)}`, { method: "DELETE" });
                                  if (res.ok) {
                                    const newModels = effectiveModels.filter((m) => m !== model);
                                    setUserSelectedModels(newModels);
                                    if (effectiveActiveModel === model) {
                                      setUserActiveModel("");
                                    }
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
                    <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
                      <button onClick={() => setModalOpen(true)} disabled={!activeProviders?.length} className={`px-2 py-1 rounded border text-xs transition-colors ${activeProviders?.length ? "bg-surface border-border text-text-main hover:border-primary cursor-pointer" : "opacity-50 cursor-not-allowed border-border"}`}>Add Model</button>
                      <span className="text-xs text-text-muted">
                        {effectiveModels.length > 0 && effectiveActiveModel ? (
                          <>Active: <span className="text-primary">{effectiveActiveModel}</span></>
                        ) : effectiveModels.length > 0 ? (
                          <span className="text-yellow-500">Click a model to set/clear active</span>
                        ) : (
                          "Select models to add"
                        )}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Subagent Model */}
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
                  <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">Subagent Model</span>
                  <span className="material-symbols-outlined hidden text-text-muted text-[14px] sm:inline">arrow_forward</span>
                  <input
                    type="text"
                    value={effectiveSubagentModel}
                    onChange={(e) => setUserSubagentModel(e.target.value)}
                    placeholder={effectiveModels[0] || "provider/model-id (defaults to main model)"}
                    className="w-full min-w-0 px-2 py-2 bg-surface rounded border border-border text-xs focus:outline-none focus:ring-1 focus:ring-primary/50 sm:py-1.5"
                  />
                  <button
                    onClick={() => setSubagentModalOpen(true)}
                    disabled={!activeProviders?.length}
                    className={`w-full sm:w-auto rounded border px-2 py-2 text-xs transition-colors sm:py-1.5 whitespace-nowrap sm:shrink-0 ${activeProviders?.length ? "bg-surface border-border text-text-main hover:border-primary cursor-pointer" : "opacity-50 cursor-not-allowed border-border"}`}
                  >
                    Select Model
                  </button>
                  {effectiveSubagentModel && (
                    <button
                      onClick={() => setUserSubagentModel("")}
                      className="p-1 text-text-muted hover:text-red-500 rounded transition-colors"
                      title="Clear (will use main model)"
                    >
                      <span className="material-symbols-outlined text-[14px]">close</span>
                    </button>
                  )}
                </div>
              </div>

              {message && (
                <div className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs ${message.type === "success" ? "bg-green-500/10 text-green-600" : "bg-red-500/10 text-red-600"}`}>
                  <span className="material-symbols-outlined text-[14px]">{message.type === "success" ? "check_circle" : "error"}</span>
                  <span>{message.text}</span>
                </div>
              )}

              <div className="grid grid-cols-1 gap-2 sm:flex sm:items-center">
                <Button variant="primary" size="sm" onClick={handleApply} disabled={effectiveModels.length === 0} loading={applying}>
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
          saveModels(effectiveModelsRef.current);
        }}
        onSelect={(model) => {
          if (!effectiveModels.includes(model.value)) {
            const next = [...effectiveModels, model.value];
            setUserSelectedModels(next);
            if (!effectiveActiveModel) setUserActiveModel(model.value);
          }
        }}
        onDeselect={(model) => {
          const remaining = effectiveModels.filter(m => m !== model.value);
          setUserSelectedModels(remaining);
          if (effectiveActiveModel === model.value) {
            setUserActiveModel(remaining[0] || "");
          }
        }}
        selectedModel={null}
        activeProviders={activeProviders}
        modelAliases={modelAliases}
        addedModelValues={effectiveModels}
        closeOnSelect={false}
        title="Add Model for OpenCode"
      />

      <ModelSelectModal
        isOpen={subagentModalOpen}
        onClose={() => setSubagentModalOpen(false)}
        onSelect={(model) => { setUserSubagentModel(model.value); setSubagentModalOpen(false); }}
        selectedModel={effectiveSubagentModel}
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
