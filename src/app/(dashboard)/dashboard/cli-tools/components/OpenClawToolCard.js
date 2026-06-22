"use client";

import { useState, useEffect } from "react";
import { Card, Button, ModelSelectModal, ManualConfigModal } from "@/shared/components";
import Image from "next/image";
import BaseUrlSelect from "./BaseUrlSelect";
import ApiKeySelect from "./ApiKeySelect";
import { matchKnownEndpoint } from "./cliEndpointMatch";

export default function OpenClawToolCard({
  tool,
  isExpanded,
  onToggle,
  baseUrl,
  hasActiveProviders,
  apiKeys,
  activeProviders,
  cloudEnabled,
  initialStatus,
  tunnelEnabled,
  tunnelPublicUrl,
  tailscaleEnabled,
  tailscaleUrl,
}) {
  // Local fetch/mutation result only. Parent initialStatus flows through without sync effect.
  const [fetchedOpenclawStatus, setFetchedOpenclawStatus] = useState(null);
  const [checkingOpenclaw, setCheckingOpenclaw] = useState(false);
  const [applying, setApplying] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [message, setMessage] = useState(null);
  // Explicit user selections only — derived values computed at render time.
  const [userSelectedApiKey, setUserSelectedApiKey] = useState("");
  const [userSelectedModel, setUserSelectedModel] = useState("");
  // Per-agent model overrides: only explicit user edits stored here.
  // Reads back from status (agent.currentModel) at render time for unedited agents.
  const [userAgentModels, setUserAgentModels] = useState({});
  const [agentModalFor, setAgentModalFor] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [modelAliases, setModelAliases] = useState({});
  const [showManualConfigModal, setShowManualConfigModal] = useState(false);
  const [customBaseUrl, setCustomBaseUrl] = useState("");
  // Suppress stale status fallbacks after user resets, until re-fetch completes.
  const [modelResetByUser, setModelResetByUser] = useState(false);
  const [apiKeyResetByUser, setApiKeyResetByUser] = useState(false);

  // Derived: local fetch/mutation result takes precedence over parent prop.
  const openclawStatus = fetchedOpenclawStatus ?? initialStatus ?? null;

  // Effective api key: explicit user selection > status file value (unless reset) > first available > empty.
  const provider9router = openclawStatus?.settings?.models?.providers?.["9router"];
  const statusApiKey = provider9router?.apiKey || "";
  const statusApiKeyValid = !!(statusApiKey && apiKeys?.some(k => k.key === statusApiKey));
  const effectiveSelectedApiKey =
    userSelectedApiKey ||
    (!apiKeyResetByUser && statusApiKeyValid ? statusApiKey : "") ||
    apiKeys?.[0]?.key ||
    "";

  // Effective model: explicit user > status primary model (unless reset) > empty.
  const rawStatusModel = openclawStatus?.settings?.agents?.defaults?.model?.primary || "";
  const statusModel = rawStatusModel.replace("9router/", "");
  const effectiveModel = userSelectedModel || (!modelResetByUser ? statusModel : "") || "";

  // Effective per-agent models: user override > agent.currentModel from status > "".
  const getEffectiveAgentModel = (agent) =>
    Object.hasOwn(userAgentModels, agent.id)
      ? userAgentModels[agent.id]
      : (agent.currentModel || "");

  const getConfigStatus = () => {
    if (!openclawStatus?.installed) return null;
    const currentProvider = openclawStatus.settings?.models?.providers?.["9router"];
    if (!currentProvider) return "not_configured";
    return matchKnownEndpoint(currentProvider.baseUrl, { tunnelPublicUrl, tailscaleUrl }) ? "configured" : "other";
  };

  const configStatus = getConfigStatus();

  // showChecking: explicit check in progress OR initial auto-check still pending.
  const showChecking = checkingOpenclaw || (isExpanded && !openclawStatus);

  // Auto-check: inline fetch chain — no synchronous setState in effect body.
  useEffect(() => {
    if (isExpanded && !openclawStatus) {
      fetch("/api/cli-tools/openclaw-settings")
        .then(r => r.json())
        .then(data => { setFetchedOpenclawStatus(data); })
        .catch(err => { setFetchedOpenclawStatus({ installed: false, error: err.message }); });
    }
  }, [isExpanded, openclawStatus]);

  // Alias fetch: separate effect so status changes while expanded don't re-fire it.
  useEffect(() => {
    if (isExpanded) {
      fetch("/api/models/alias")
        .then(r => r.json())
        .then(data => { if (data) setModelAliases(data.aliases || {}); })
        .catch(() => {});
    }
  }, [isExpanded]);

  const normalizeLocalhost = (url) => url.replace("://localhost", "://127.0.0.1");

  const getLocalBaseUrl = () => {
    if (typeof window !== "undefined") {
      return normalizeLocalhost(window.location.origin);
    }
    return "http://127.0.0.1:20128";
  };

  const getEffectiveBaseUrl = () => {
    const url = customBaseUrl || getLocalBaseUrl();
    return url.endsWith("/v1") ? url : `${url}/v1`;
  };

  const getDisplayUrl = () => {
    const url = customBaseUrl || getLocalBaseUrl();
    return url.endsWith("/v1") ? url : `${url}/v1`;
  };

  const checkOpenclawStatus = async () => {
    setCheckingOpenclaw(true);
    try {
      const res = await fetch("/api/cli-tools/openclaw-settings");
      const data = await res.json();
      setFetchedOpenclawStatus(data);
    } catch (error) {
      setFetchedOpenclawStatus({ installed: false, error: error.message });
    } finally {
      setCheckingOpenclaw(false);
    }
  };

  // Build the agentModels payload for Apply: merge status defaults with user overrides.
  const buildAgentModelsPayload = () => {
    const agentList = openclawStatus?.agents || [];
    const result = {};
    agentList.forEach((agent) => {
      const m = getEffectiveAgentModel(agent);
      if (m) result[agent.id] = m;
    });
    return result;
  };

  const handleApplySettings = async () => {
    setApplying(true);
    setMessage(null);
    try {
      const keyToUse = effectiveSelectedApiKey?.trim()
        || (!cloudEnabled ? "sk_9router" : null);

      const res = await fetch("/api/cli-tools/openclaw-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: getEffectiveBaseUrl(),
          apiKey: keyToUse,
          model: effectiveModel,
          agentModels: buildAgentModelsPayload(),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: "Settings applied successfully!" });
        checkOpenclawStatus();
      } else {
        setMessage({ type: "error", text: data.error || "Failed to apply settings" });
      }
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    } finally {
      setApplying(false);
    }
  };

  const handleResetSettings = async () => {
    setRestoring(true);
    setMessage(null);
    try {
      const res = await fetch("/api/cli-tools/openclaw-settings", { method: "DELETE" });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: "Settings reset successfully!" });
        // Clear user overrides and suppress stale status fallbacks until re-fetch.
        setUserSelectedModel("");
        setModelResetByUser(true);
        setUserSelectedApiKey("");
        setApiKeyResetByUser(true);
        setUserAgentModels({});
        checkOpenclawStatus().then(() => {
          setModelResetByUser(false);
          setApiKeyResetByUser(false);
        });
      } else {
        setMessage({ type: "error", text: data.error || "Failed to reset settings" });
      }
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    } finally {
      setRestoring(false);
    }
  };

  const handleModelSelect = (model) => {
    if (agentModalFor) {
      setUserAgentModels(prev => ({ ...prev, [agentModalFor]: model.value }));
      setAgentModalFor(null);
    } else {
      setUserSelectedModel(model.value);
      setModelResetByUser(false);
    }
    setModalOpen(false);
  };

  const getManualConfigs = () => {
    const keyToUse = (effectiveSelectedApiKey && effectiveSelectedApiKey.trim())
      ? effectiveSelectedApiKey
      : (!cloudEnabled ? "sk_9router" : "<API_KEY_FROM_DASHBOARD>");

    const settingsContent = {
      agents: {
        defaults: {
          model: {
            primary: `9router/${effectiveModel || "provider/model-id"}`,
          },
        },
      },
      models: {
        providers: {
          "9router": {
            baseUrl: getEffectiveBaseUrl(),
            apiKey: keyToUse,
            api: "openai-completions",
            models: [
              {
                id: effectiveModel || "provider/model-id",
                name: (effectiveModel || "provider/model-id").split("/").pop(),
              },
            ],
          },
        },
      },
    };

    return [
      {
        filename: "~/.openclaw/openclaw.json",
        content: JSON.stringify(settingsContent, null, 2),
      },
    ];
  };

  return (
    <Card padding="xs" className="overflow-hidden">
      <div className="flex items-start justify-between gap-3 hover:cursor-pointer sm:items-center" onClick={onToggle}>
        <div className="flex min-w-0 items-center gap-3">
          <div className="size-8 flex items-center justify-center shrink-0">
            <Image src="/providers/openclaw.png" alt={tool.name} width={32} height={32} className="size-8 object-contain rounded-lg" sizes="32px" onError={(e) => { e.target.style.display = "none"; }} />
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
              <span>Checking Open Claw CLI...</span>
            </div>
          )}

          {!showChecking && openclawStatus && !openclawStatus.installed && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-3 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                <div className="flex items-start gap-3">
                  <span className="material-symbols-outlined text-yellow-500">warning</span>
                  <div className="flex-1">
                    <p className="font-medium text-yellow-600 dark:text-yellow-400">Open Claw CLI not detected locally</p>
                    <p className="text-sm text-text-muted">Manual configuration is still available if 9router is deployed on a remote server.</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 pl-9">
                  <Button variant="secondary" size="sm" onClick={() => setShowManualConfigModal(true)} className="!bg-yellow-500/20 !border-yellow-500/40 !text-yellow-700 dark:!text-yellow-300 hover:!bg-yellow-500/30">
                    <span className="material-symbols-outlined text-[18px] mr-1">content_copy</span>
                    Manual Config
                  </Button>
                </div>
              </div>
            </div>
          )}

          {!showChecking && openclawStatus?.installed && (
            <>
              <div className="flex flex-col gap-2">
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
                {openclawStatus?.settings?.models?.providers?.["9router"]?.baseUrl && (
                  <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
                    <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">Current</span>
                    <span className="material-symbols-outlined hidden text-text-muted text-[14px] sm:inline">arrow_forward</span>
                    <span className="min-w-0 truncate rounded bg-surface/40 px-2 py-2 text-xs text-text-muted sm:py-1.5">
                      {openclawStatus.settings.models.providers["9router"].baseUrl}
                    </span>
                  </div>
                )}

                {/* API Key */}
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
                  <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">API Key</span>
                  <span className="material-symbols-outlined hidden text-text-muted text-[14px] sm:inline">arrow_forward</span>
                  <ApiKeySelect value={effectiveSelectedApiKey} onChange={setUserSelectedApiKey} apiKeys={apiKeys} cloudEnabled={cloudEnabled} />
                </div>

                {/* Default Model */}
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
                  <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">Default Model</span>
                  <span className="material-symbols-outlined hidden text-text-muted text-[14px] sm:inline">arrow_forward</span>
                  <div className="relative w-full min-w-0">
                    <input type="text" value={effectiveModel} onChange={(e) => { setUserSelectedModel(e.target.value); setModelResetByUser(false); }} placeholder="provider/model-id" className="w-full min-w-0 pl-2 pr-7 py-2 bg-surface rounded border border-border text-xs focus:outline-none focus:ring-1 focus:ring-primary/50 sm:py-1.5" />
                    {effectiveModel && <button onClick={() => { setUserSelectedModel(""); setModelResetByUser(true); }} className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 text-text-muted hover:text-red-500 rounded transition-colors" title="Clear"><span className="material-symbols-outlined text-[14px]">close</span></button>}
                  </div>
                  <button onClick={() => { setAgentModalFor(null); setModalOpen(true); }} disabled={!hasActiveProviders} className={`w-full sm:w-auto rounded border px-2 py-2 text-xs transition-colors sm:py-1.5 whitespace-nowrap sm:shrink-0 ${hasActiveProviders ? "bg-surface border-border text-text-main hover:border-primary cursor-pointer" : "opacity-50 cursor-not-allowed border-border"}`}>Select</button>
                </div>

                {/* Per-agent model overrides */}
                {(openclawStatus.agents || []).filter(a => a.agentDir).map((agent) => (
                  <div key={agent.id} className="flex items-center gap-2 pl-4">
                    <span className="w-32 shrink-0 text-xs text-primary text-right truncate" title={agent.name || agent.id}>Agent {agent.name || agent.id}</span>
                    <span className="material-symbols-outlined hidden text-text-muted text-[14px] sm:inline">arrow_forward</span>
                    <div className="relative w-full min-w-0">
                      <input
                        type="text"
                        value={getEffectiveAgentModel(agent)}
                        onChange={(e) => setUserAgentModels(prev => ({ ...prev, [agent.id]: e.target.value }))}
                        placeholder={`default (${effectiveModel || "provider/model-id"})`}
                        className="w-full min-w-0 pl-2 pr-7 py-2 bg-surface rounded border border-border text-xs focus:outline-none focus:ring-1 focus:ring-primary/50 sm:py-1.5"
                      />
                      {getEffectiveAgentModel(agent) && <button onClick={() => setUserAgentModels(prev => ({ ...prev, [agent.id]: "" }))} className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 text-text-muted hover:text-red-500 rounded transition-colors" title="Clear"><span className="material-symbols-outlined text-[14px]">close</span></button>}
                    </div>
                    <button onClick={() => { setAgentModalFor(agent.id); setModalOpen(true); }} disabled={!hasActiveProviders} className={`w-full sm:w-auto rounded border px-2 py-2 text-xs transition-colors sm:py-1.5 whitespace-nowrap sm:shrink-0 ${hasActiveProviders ? "bg-surface border-border text-text-main hover:border-primary cursor-pointer" : "opacity-50 cursor-not-allowed border-border"}`}>Select</button>
                  </div>
                ))}
              </div>

              {message && (
                <div className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs ${message.type === "success" ? "bg-green-500/10 text-green-600" : "bg-red-500/10 text-red-600"}`}>
                  <span className="material-symbols-outlined text-[14px]">{message.type === "success" ? "check_circle" : "error"}</span>
                  <span>{message.text}</span>
                </div>
              )}

              <div className="grid grid-cols-1 gap-2 sm:flex sm:items-center">
                <Button variant="primary" size="sm" onClick={handleApplySettings} disabled={!effectiveModel} loading={applying}>
                  <span className="material-symbols-outlined text-[14px] mr-1">save</span>Apply
                </Button>
                <Button variant="outline" size="sm" onClick={handleResetSettings} disabled={!openclawStatus?.has9Router} loading={restoring}>
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
        onClose={() => setModalOpen(false)}
        onSelect={handleModelSelect}
        selectedModel={effectiveModel}
        activeProviders={activeProviders}
        modelAliases={modelAliases}
        title="Select Model for Open Claw"
      />

      <ManualConfigModal
        isOpen={showManualConfigModal}
        onClose={() => setShowManualConfigModal(false)}
        title="Open Claw - Manual Configuration"
        configs={getManualConfigs()}
      />
    </Card>
  );
}
