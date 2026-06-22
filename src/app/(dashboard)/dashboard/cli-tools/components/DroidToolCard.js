"use client";

import { useState, useEffect, useRef } from "react";
import { Card, Button, ModelSelectModal, ManualConfigModal } from "@/shared/components";
import Image from "next/image";
import BaseUrlSelect from "./BaseUrlSelect";
import ApiKeySelect from "./ApiKeySelect";
import { matchKnownEndpoint } from "./cliEndpointMatch";

const CLOUD_URL = process.env.NEXT_PUBLIC_CLOUD_URL;

export default function DroidToolCard({
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
  // Local fetch result only. Parent initialStatus flows through without a sync effect.
  const [fetchedDroidStatus, setFetchedDroidStatus] = useState(null);
  const [applying, setApplying] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [message, setMessage] = useState(null);
  // Stores only explicit user selections. Falls back to apiKeys[0] at read time.
  const [userSelectedApiKey, setUserSelectedApiKey] = useState("");
  // modelList: explicit user edits or fetch-discovered value (set inside .then).
  // modelListResetByUser suppresses stale prop fallback after reset.
  const [modelList, setModelList] = useState([]);
  const [modelListResetByUser, setModelListResetByUser] = useState(false);
  const [modelInput, setModelInput] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [modelAliases, setModelAliases] = useState({});
  const [showManualConfigModal, setShowManualConfigModal] = useState(false);
  const [showInstallGuide, setShowInstallGuide] = useState(false);
  const [customBaseUrl, setCustomBaseUrl] = useState("");
  const hasInitializedModel = useRef(false);

  // Derived: local fetch/mutation result takes precedence over parent prop.
  const droidStatus = fetchedDroidStatus ?? initialStatus ?? null;

  // Derived API key: explicit user selection > first available key > empty.
  const selectedApiKey = userSelectedApiKey || apiKeys?.[0]?.key || "";

  // Derived model list: explicit user edits > initialStatus config value (unless reset) > [].
  // Computed once at render time — no setState needed.
  const initialFileModels = !modelListResetByUser && modelList.length === 0 && droidStatus?.installed
    ? (() => {
        const models = (droidStatus.settings?.customModels || [])
          .filter(m => m.id?.startsWith("custom:9Router"))
          .sort((a, b) => (a.index || 0) - (b.index || 0))
          .map(m => m.model);
        if (models.length > 0) return models;
        const legacy = droidStatus.settings?.customModels?.find(m => m.id === "custom:9Router-0");
        return legacy?.model ? [legacy.model] : [];
      })()
    : null;
  // Use initialFileModels as display list only when user hasn't edited yet.
  const effectiveModelList = modelList.length > 0 || modelListResetByUser
    ? modelList
    : (initialFileModels || []);

  const getConfigStatus = () => {
    if (!droidStatus?.installed) return null;
    // Check for any 9Router model entry (support multi-model: custom:9Router-0, custom:9Router-1, ...)
    const currentConfig = droidStatus.settings?.customModels?.find(m => m.id?.startsWith("custom:9Router"));
    if (!currentConfig) return "not_configured";
    return matchKnownEndpoint(currentConfig.baseUrl, { tunnelPublicUrl, tailscaleUrl, cloudUrl: cloudEnabled ? CLOUD_URL : null }) ? "configured" : "other";
  };

  const configStatus = getConfigStatus();

  const getEffectiveBaseUrl = () => {
    const url = customBaseUrl || baseUrl;
    return url.endsWith("/v1") ? url : `${url}/v1`;
  };

  const getDisplayUrl = () => {
    const url = customBaseUrl || baseUrl;
    return url.endsWith("/v1") ? url : `${url}/v1`;
  };

  // Spinner derived from status — no checkingDroid state needed.
  const checkingDroid = isExpanded && !droidStatus;

  // Auto-check on expand: inline fetch chain — all setState inside .then/.catch only.
  useEffect(() => {
    if (isExpanded && !droidStatus) {
      fetch("/api/cli-tools/droid-settings")
        .then(r => r.json())
        .then(data => {
          setFetchedDroidStatus(data);
          if (!hasInitializedModel.current && data?.installed) {
            hasInitializedModel.current = true;
            const models = (data.settings?.customModels || [])
              .filter(m => m.id?.startsWith("custom:9Router"))
              .sort((a, b) => (a.index || 0) - (b.index || 0))
              .map(m => m.model);
            if (models.length > 0) {
              setModelList(models);
            } else {
              const legacy = data.settings?.customModels?.find(m => m.id === "custom:9Router-0");
              if (legacy?.model) setModelList([legacy.model]);
            }
          }
        })
        .catch(err => setFetchedDroidStatus({ installed: false, error: err.message }));
    }
  }, [isExpanded, droidStatus]);

  // Alias fetch: separate effect — setState only inside .then callback.
  useEffect(() => {
    if (isExpanded) {
      fetch("/api/models/alias")
        .then(r => r.json())
        .then(data => { if (data) setModelAliases(data.aliases || {}); })
        .catch(() => {});
    }
  }, [isExpanded]);

  const refetchStatus = () => {
    fetch("/api/cli-tools/droid-settings")
      .then(r => r.json())
      .then(data => setFetchedDroidStatus(data))
      .catch(err => setFetchedDroidStatus({ installed: false, error: err.message }));
  };

  const addModel = () => {
    const val = modelInput.trim();
    if (!val || effectiveModelList.includes(val)) return;
    setModelListResetByUser(true);
    setModelList([...effectiveModelList, val]);
    setModelInput("");
  };

  const removeModel = (id) => {
    setModelListResetByUser(true);
    setModelList(effectiveModelList.filter((m) => m !== id));
  };

  const handleModelSelect = (model) => {
    if (!model.value || effectiveModelList.includes(model.value)) return;
    setModelListResetByUser(true);
    setModelList([...effectiveModelList, model.value]);
    setModalOpen(false);
  };

  const handleApplySettings = async () => {
    setApplying(true);
    setMessage(null);
    try {
      const keyToUse = selectedApiKey?.trim()
        || (apiKeys?.length > 0 ? apiKeys[0].key : null)
        || (!cloudEnabled ? "sk_9router" : null);

      const res = await fetch("/api/cli-tools/droid-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: getEffectiveBaseUrl(),
          apiKey: keyToUse,
          models: effectiveModelList,
          activeModel: effectiveModelList[0] || "",
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: "Settings applied successfully!" });
        refetchStatus();
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
      const res = await fetch("/api/cli-tools/droid-settings", { method: "DELETE" });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: "Settings reset successfully!" });
        setModelListResetByUser(true);
        setModelList([]);
        refetchStatus();
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

    const settingsContent = {
      customModels: effectiveModelList.map((m, i) => ({
        model: m,
        id: `custom:9Router-${i}`,
        index: i,
        baseUrl: getEffectiveBaseUrl(),
        apiKey: keyToUse,
        displayName: m,
        maxOutputTokens: 131072,
        noImageSupport: false,
        provider: "openai",
      })),
    };

    const platform = typeof navigator !== "undefined" && navigator.platform;
    const isWindows = platform?.toLowerCase().includes("win");
    const settingsPath = isWindows
      ? "%USERPROFILE%\\.factory\\settings.json"
      : "~/.factory/settings.json";

    return [
      {
        filename: settingsPath,
        content: JSON.stringify(settingsContent, null, 2),
      },
    ];
  };

  return (
    <Card padding="xs" className="overflow-hidden">
      <div className="flex items-start justify-between gap-3 hover:cursor-pointer sm:items-center" onClick={onToggle}>
        <div className="flex min-w-0 items-center gap-3">
          <div className="size-8 flex items-center justify-center shrink-0">
            <Image src="/providers/droid.png" alt={tool.name} width={32} height={32} className="size-8 object-contain rounded-lg" sizes="32px" onError={(e) => { e.target.style.display = "none"; }} />
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
          {checkingDroid && (
            <div className="flex items-center gap-2 text-text-muted">
              <span className="material-symbols-outlined animate-spin">progress_activity</span>
              <span>Checking Factory Droid CLI...</span>
            </div>
          )}

          {!checkingDroid && droidStatus && !droidStatus.installed && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-3 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                <div className="flex items-start gap-3">
                  <span className="material-symbols-outlined text-yellow-500">warning</span>
                  <div className="flex-1">
                    <p className="font-medium text-yellow-600 dark:text-yellow-400">Factory Droid CLI not detected locally</p>
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
                      <p className="text-text-muted mb-1">macOS / Linux / Windows:</p>
                      <code className="block px-3 py-2 bg-black/5 dark:bg-white/5 rounded font-mono text-xs">curl -fsSL https://app.factory.ai/cli | sh</code>
                    </div>
                    <p className="text-text-muted">After installation, run <code className="px-1 bg-black/5 dark:bg-white/5 rounded">droid</code> to verify.</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {!checkingDroid && droidStatus?.installed && (
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
                {droidStatus?.settings?.customModels?.find(m => m.id?.startsWith("custom:9Router"))?.baseUrl && (
                  <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
                    <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">Current</span>
                    <span className="material-symbols-outlined hidden text-text-muted text-[14px] sm:inline">arrow_forward</span>
                    <span className="min-w-0 truncate rounded bg-surface/40 px-2 py-2 text-xs text-text-muted sm:py-1.5">
                      {droidStatus.settings.customModels.find(m => m.id?.startsWith("custom:9Router")).baseUrl}
                    </span>
                  </div>
                )}

                {/* API Key */}
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
                  <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">API Key</span>
                  <span className="material-symbols-outlined hidden text-text-muted text-[14px] sm:inline">arrow_forward</span>
                  <ApiKeySelect value={selectedApiKey} onChange={setUserSelectedApiKey} apiKeys={apiKeys} cloudEnabled={cloudEnabled} />
                </div>

                {/* Models */}
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
                  <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">
                    Models {effectiveModelList.length > 0 && <span className="text-primary">({effectiveModelList.length})</span>}
                  </span>
                  <span className="material-symbols-outlined hidden text-text-muted text-[14px] sm:inline">arrow_forward</span>
                  <div className="flex-1 flex flex-col gap-1">
                    {/* Model list */}
                    {effectiveModelList.length > 0 && (
                      <div className="flex flex-col gap-0.5 mb-1">
                        {effectiveModelList.map((id) => (
                          <div key={id} className="flex items-center gap-1.5 px-2 py-1 bg-bg-secondary rounded border border-border">
                            <span className="flex-1 text-xs font-mono truncate">{id}</span>
                            <button onClick={() => removeModel(id)} className="text-text-muted hover:text-red-500 transition-colors shrink-0" title="Remove">
                              <span className="material-symbols-outlined text-[12px]">close</span>
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    {/* Model input row */}
                    <div className="flex items-center gap-1.5">
                      <input
                        type="text"
                        value={modelInput}
                        onChange={(e) => setModelInput(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addModel(); } }}
                        placeholder="provider/model-id"
                        className="w-full min-w-0 px-2 py-2 bg-surface rounded border border-border text-xs focus:outline-none focus:ring-1 focus:ring-primary/50 sm:py-1.5"
                      />
                      <button
                        onClick={() => setModalOpen(true)}
                        disabled={!hasActiveProviders}
                        className={`px-2 py-1.5 rounded border text-xs shrink-0 ${hasActiveProviders ? "bg-surface border-border hover:border-primary cursor-pointer" : "opacity-50 cursor-not-allowed border-border"}`}
                      >
                        Select
                      </button>
                      <button onClick={addModel} disabled={!modelInput.trim()} className="px-2 py-1.5 rounded border bg-surface border-border hover:border-primary text-xs shrink-0 disabled:opacity-50" title="Add model">
                        <span className="material-symbols-outlined text-[14px]">add</span>
                      </button>
                    </div>
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
                <Button variant="primary" size="sm" onClick={handleApplySettings} disabled={effectiveModelList.length === 0} loading={applying}>
                  <span className="material-symbols-outlined text-[14px] mr-1">save</span>Apply
                </Button>
                <Button variant="outline" size="sm" onClick={handleResetSettings} disabled={!droidStatus?.has9Router} loading={restoring}>
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
        selectedModel={null}
        activeProviders={activeProviders}
        modelAliases={modelAliases}
        title="Select Model for Factory Droid"
      />

      <ManualConfigModal
        isOpen={showManualConfigModal}
        onClose={() => setShowManualConfigModal(false)}
        title="Factory Droid - Manual Configuration"
        configs={getManualConfigs()}
      />
    </Card>
  );
}
