"use client";

import { useState, useEffect } from "react";
import { Card, Button, ModelSelectModal, ManualConfigModal } from "@/shared/components";
import Image from "next/image";
import BaseUrlSelect from "./BaseUrlSelect";
import ApiKeySelect from "./ApiKeySelect";
import { matchKnownEndpoint } from "./cliEndpointMatch";

function readConfiguredModel(status) {
  return status?.config?.match(/^model\s*=\s*"([^"]+)"/m)?.[1] || "";
}

function readConfiguredSubagent(status) {
  return status?.config?.match(/\[agents\.subagent\]\s*\n\s*model\s*=\s*"([^"]+)"/m)?.[1] || "";
}

export default function CodexToolCard({ tool, isExpanded, onToggle, baseUrl, apiKeys, activeProviders, cloudEnabled, initialStatus, tunnelEnabled, tunnelPublicUrl, tailscaleEnabled, tailscaleUrl }) {
  const [codexStatus, setCodexStatus] = useState(initialStatus || null);
  const [checkingCodex, setCheckingCodex] = useState(false);
  const [applying, setApplying] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [message, setMessage] = useState(null);
  const [showInstallGuide, setShowInstallGuide] = useState(false);
  const [selectedApiKey, setSelectedApiKey] = useState(apiKeys?.[0]?.key || "");
  const [selectedModel, setSelectedModel] = useState(readConfiguredModel(initialStatus));
  const [subagentModel, setSubagentModel] = useState(readConfiguredSubagent(initialStatus));
  const [modalOpen, setModalOpen] = useState(false);
  const [subagentModalOpen, setSubagentModalOpen] = useState(false);
  const [modelAliases, setModelAliases] = useState({});
  const [showManualConfigModal, setShowManualConfigModal] = useState(false);
  const [customBaseUrl, setCustomBaseUrl] = useState("");
  const [mode, setMode] = useState(initialStatus?.mode || "universal");
  const [nativeCatalog, setNativeCatalog] = useState({ models: [], accounts: [], catalog: null });
  const [loadingNativeCatalog, setLoadingNativeCatalog] = useState(false);
  const [nativeReadiness, setNativeReadiness] = useState(initialStatus?.nativeReadiness || null);
  const [testingNative, setTestingNative] = useState(false);
  const [subagentCustomized, setSubagentCustomized] = useState(
    !!readConfiguredSubagent(initialStatus)
    && readConfiguredSubagent(initialStatus) !== readConfiguredModel(initialStatus)
  );

  async function fetchModelAliases() {
    try {
      const res = await fetch("/api/models/alias");
      const data = await res.json();
      if (res.ok) setModelAliases(data.aliases || {});
    } catch (error) {
      console.log("Error fetching model aliases:", error);
    }
  }

  async function fetchNativeCatalog(forceRefresh = false) {
    setLoadingNativeCatalog(true);
    try {
      const res = await fetch(`/api/cli-tools/codex-native/models${forceRefresh ? "?refresh=1" : ""}`);
      const data = await res.json();
      if (res.ok) {
        setNativeCatalog(data);
        const fallback = data.defaultModel || data.models?.[0]?.slug || "";
        const slugs = new Set((data.models || []).map((model) => model.slug));
        setSelectedModel((current) => slugs.has(current) ? current : fallback);
        setSubagentModel((current) => slugs.has(current) ? current : fallback);
      }
    } catch (error) {
      console.log("Error fetching Codex Native catalog:", error);
    } finally {
      setLoadingNativeCatalog(false);
    }
  }

  async function checkCodexStatus() {
    setCheckingCodex(true);
    try {
      const res = await fetch("/api/cli-tools/codex-settings");
      const data = await res.json();
      setCodexStatus(data);
      setNativeReadiness(data.nativeReadiness || null);
      if (data.mode) setMode(data.mode);
      const configuredModel = readConfiguredModel(data);
      const configuredSubagent = readConfiguredSubagent(data);
      if (configuredModel) setSelectedModel(configuredModel);
      if (configuredSubagent) setSubagentModel(configuredSubagent);
    } catch (error) {
      setCodexStatus({ installed: false, error: error.message });
    } finally {
      setCheckingCodex(false);
    }
  }

  useEffect(() => {
    if (!isExpanded) return;
    const timer = setTimeout(() => {
      if (!codexStatus) checkCodexStatus();
      fetchModelAliases();
      fetchNativeCatalog();
    }, 0);
    return () => clearTimeout(timer);
    // Opening the card is the synchronization boundary for external CLI state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isExpanded]);

  const getConfigStatus = () => {
    if (!codexStatus?.installed) return null;
    if (!codexStatus.config) return "not_configured";
    const parsed = codexStatus.config.match(/base_url\s*=\s*"([^"]+)"/);
    const currentUrl = parsed ? parsed[1] : "";
    return matchKnownEndpoint(currentUrl, { tunnelPublicUrl, tailscaleUrl }) ? "configured" : "other";
  };

  const configStatus = getConfigStatus();

  const getEffectiveBaseUrl = () => {
    const url = customBaseUrl || `${baseUrl}/v1`;
    // Ensure URL ends with /v1
    return url.endsWith("/v1") ? url : `${url}/v1`;
  };

  const getDisplayUrl = () => customBaseUrl || `${baseUrl}/v1`;

  const handleApplySettings = async () => {
    setApplying(true);
    setMessage(null);
    try {
      // Use sk_9router for localhost if no key, otherwise use selected key
      const keyToUse = (selectedApiKey && selectedApiKey.trim())
        ? selectedApiKey
        : (!cloudEnabled ? "sk_9router" : selectedApiKey);

      const res = await fetch("/api/cli-tools/codex-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: getEffectiveBaseUrl(),
          apiKey: keyToUse,
          model: selectedModel,
          subagentModel: subagentModel || selectedModel,
          mode,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: "Settings applied successfully!" });
        checkCodexStatus();
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
      const res = await fetch("/api/cli-tools/codex-settings", { method: "DELETE" });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: "Settings reset successfully!" });
        setSelectedModel("");
        setSubagentModel("");
        checkCodexStatus();
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
    setSelectedModel(model.value);
    // Auto-set subagent model if not set
    if (!subagentModel) {
      setSubagentModel(model.value);
    }
    setModalOpen(false);
  };

  const handleModeChange = (nextMode) => {
    setMode(nextMode);
    setMessage(null);
    if (nextMode === "native") {
      const slugs = new Set(nativeCatalog.models.map((model) => model.slug));
      const fallback = nativeCatalog.defaultModel || nativeCatalog.models[0]?.slug || "";
      setSelectedModel((current) => slugs.has(current) ? current : fallback);
      setSubagentModel((current) => slugs.has(current) ? current : fallback);
      setSubagentCustomized(false);
    } else {
      setSelectedModel((current) => current.includes("/") ? current : "");
      setSubagentModel((current) => current.includes("/") ? current : "");
    }
  };

  const handleNativeModelChange = (model) => {
    setSelectedModel(model);
    if (!subagentCustomized) setSubagentModel(model);
  };

  const handleRepairNative = async () => {
    setTestingNative(true);
    setMessage(null);
    try {
      const keyToUse = selectedApiKey?.trim() || (!cloudEnabled ? "sk_9router" : "");
      const res = await fetch("/api/cli-tools/codex-native/readiness", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: `${getEffectiveBaseUrl()}/codex`,
          apiKey: keyToUse,
        }),
      });
      const data = await res.json();
      setNativeReadiness(data);
      setMessage({
        type: data.supportsWebSockets ? "success" : "error",
        text: data.supportsWebSockets
          ? "Codex Native WebSocket and HTTP fallback are ready."
          : data.configuredWebSocket?.error || data.models?.error || "Native HTTP works, but WebSocket is not ready.",
      });
      await checkCodexStatus();
      await fetchNativeCatalog();
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    } finally {
      setTestingNative(false);
    }
  };

  const getManualConfigs = () => {
    const keyToUse = (selectedApiKey && selectedApiKey.trim())
      ? selectedApiKey
      : (!cloudEnabled ? "sk_9router" : "<API_KEY_FROM_DASHBOARD>");

    const effectiveSubagentModel = subagentModel || selectedModel;

    const providerId = mode === "native" ? "9router_codex" : "9router";
    const providerName = mode === "native" ? "9Router Codex Native" : "9Router Universal";
    const providerBaseUrl = mode === "native" ? `${getEffectiveBaseUrl()}/codex` : getEffectiveBaseUrl();
    const dataDir = codexStatus?.dataDir || "~/.9router";
    const configContent = `# 9Router Configuration for Codex CLI (${mode})
model = "${selectedModel}"
model_provider = "${providerId}"

[model_providers.${providerId}]
name = "${providerName}"
base_url = "${providerBaseUrl}"
wire_api = "responses"
${mode === "native" ? `supports_websockets = ${nativeReadiness?.supportsWebSockets === true}` : ""}

[model_providers.${providerId}.auth]
command = "9router"
args = ["codex", "auth-token", "--data-dir", "${dataDir}"]
refresh_interval_ms = 0

[agents.subagent]
model = "${effectiveSubagentModel}"
`;

    return [
      {
        filename: "~/.codex/config.toml",
        content: configContent,
      },
      {
        filename: `${dataDir}/secrets/codex-bridge-token`,
        content: keyToUse,
      },
    ];
  };

  return (
    <Card padding="xs" className="overflow-hidden">
      <div className="flex items-start justify-between gap-3 hover:cursor-pointer sm:items-center" onClick={onToggle}>
        <div className="flex min-w-0 items-center gap-3">
          <div className="size-8 flex items-center justify-center shrink-0">
            <Image src="/providers/codex.png" alt={tool.name} width={32} height={32} className="size-8 object-contain rounded-lg" sizes="32px" onError={(e) => { e.target.style.display = "none"; }} loading="lazy" decoding="async" />
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
          {checkingCodex && (
            <div className="flex items-center gap-2 text-text-muted">
              <span className="material-symbols-outlined animate-spin">progress_activity</span>
              <span>Checking Codex CLI...</span>
            </div>
          )}

          {!checkingCodex && codexStatus && !codexStatus.installed && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-3 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                <div className="flex items-start gap-3">
                  <span className="material-symbols-outlined text-yellow-500">warning</span>
                  <div className="flex-1">
                    <p className="font-medium text-yellow-600 dark:text-yellow-400">Codex CLI not detected locally</p>
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
                      <p className="text-text-muted mb-1">macOS / Linux / Windows:</p>
                      <code className="block px-3 py-2 bg-black/5 dark:bg-white/5 rounded font-mono text-xs">npm install -g @openai/codex</code>
                    </div>
                    <p className="text-text-muted">After installation, run <code className="px-1 bg-black/5 dark:bg-white/5 rounded">codex</code> to verify.</p>
                    <div className="pt-2 border-t border-border">
                      <p className="text-text-muted text-xs">
                        9Router uses Codex provider-scoped command auth, so your existing
                        <code className="mx-1 bg-black/5 px-1 dark:bg-white/5 rounded">~/.codex/auth.json</code>
                        login remains untouched. Click &quot;Apply&quot; to configure it.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {!checkingCodex && codexStatus?.installed && (
            <>
              <div className="grid grid-cols-2 gap-2 rounded-lg border border-border bg-surface/40 p-1">
                <button
                  type="button"
                  onClick={() => handleModeChange("universal")}
                  className={`rounded-md px-3 py-2 text-left transition-colors ${mode === "universal" ? "bg-background text-text-main shadow-sm" : "text-text-muted hover:text-text-main"}`}
                >
                  <span className="block text-xs font-semibold">Universal Models</span>
                  <span className="block text-[10px]">All providers and aliases</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleModeChange("native")}
                  className={`rounded-md px-3 py-2 text-left transition-colors ${mode === "native" ? "bg-primary/10 text-primary shadow-sm" : "text-text-muted hover:text-text-main"}`}
                >
                  <span className="block text-xs font-semibold">Codex Native</span>
                  <span className="block text-[10px]">Native metadata and account pool</span>
                </button>
              </div>

              {mode === "native" && (
                <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium text-text-main">
                      {loadingNativeCatalog ? "Refreshing native catalog…" : `${nativeCatalog.models.length} native models · ${nativeCatalog.accounts.length} accounts`}
                    </span>
                    <button type="button" onClick={() => fetchNativeCatalog(true)} className="text-primary hover:underline">
                      Refresh
                    </button>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-2 text-[10px] text-text-muted">
                    {["healthy", "draining", "critical", "exhausted", "locked"].map((status) => {
                      const count = nativeCatalog.accounts.filter((account) => account.status === status).length;
                      return count ? <span key={status}>{status}: {count}</span> : null;
                    })}
                    <span>catalog: {nativeCatalog.catalog?.source || "unavailable"}{nativeCatalog.catalog?.stale ? " (stale)" : ""}</span>
                    {nativeCatalog.catalog?.clientVersion && <span>client: {nativeCatalog.catalog.clientVersion}</span>}
                    <span>leases: {nativeCatalog.metrics?.activeLeases || 0}</span>
                    <span>HTTP fallback: {nativeCatalog.metrics?.httpFallbackCount || 0}</span>
                    <span className={nativeReadiness?.supportsWebSockets ? "text-green-600" : "text-amber-600"}>
                      WS: {nativeReadiness?.supportsWebSockets ? "ready" : "HTTP fallback"}
                    </span>
                  </div>
                  {nativeCatalog.accounts.some((account) => account.skippedReason) && (
                    <div className="mt-2 space-y-1 border-t border-primary/10 pt-2 text-[10px] text-text-muted">
                      {nativeCatalog.accounts.filter((account) => account.skippedReason).slice(0, 3).map((account) => (
                        <p key={account.connectionId}>{account.name}: {account.skippedReason}</p>
                      ))}
                    </div>
                  )}
                </div>
              )}

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
                {codexStatus?.config && (() => {
                  const parsed = codexStatus.config.match(/base_url\s*=\s*"([^"]+)"/);
                  const currentBaseUrl = parsed ? parsed[1] : null;
                  return currentBaseUrl ? (
                    <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
                      <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">Current</span>
                      <span className="material-symbols-outlined hidden text-text-muted text-[14px] sm:inline">arrow_forward</span>
                      <span className="min-w-0 truncate rounded bg-surface/40 px-2 py-2 text-xs text-text-muted sm:py-1.5">
                        {currentBaseUrl}
                      </span>
                    </div>
                  ) : null;
                })()}

                {/* API Key */}
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
                  <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">API Key</span>
                  <span className="material-symbols-outlined hidden text-text-muted text-[14px] sm:inline">arrow_forward</span>
                  <ApiKeySelect value={selectedApiKey} onChange={setSelectedApiKey} apiKeys={apiKeys} cloudEnabled={cloudEnabled} />
                </div>

                {/* Model */}
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
                  <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">Model</span>
                  <span className="material-symbols-outlined hidden text-text-muted text-[14px] sm:inline">arrow_forward</span>
                  {mode === "native" ? (
                    <>
                      <select value={selectedModel} onChange={(event) => handleNativeModelChange(event.target.value)} className="w-full min-w-0 rounded border border-border bg-surface px-2 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary/50 sm:py-1.5">
                        {nativeCatalog.models.map((model) => (
                          <option key={model.slug} value={model.slug}>{model.display_name} · {model.eligibleAccountCount} accounts</option>
                        ))}
                      </select>
                      <span className="text-[10px] text-text-muted">Native only</span>
                    </>
                  ) : (
                    <>
                      <div className="relative w-full min-w-0">
                        <input type="text" value={selectedModel} onChange={(e) => setSelectedModel(e.target.value)} placeholder="provider/model-id" className="w-full min-w-0 pl-2 pr-7 py-2 bg-surface rounded border border-border text-xs focus:outline-none focus:ring-1 focus:ring-primary/50 sm:py-1.5" />
                        {selectedModel && <button onClick={() => setSelectedModel("")} className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 text-text-muted hover:text-red-500 rounded transition-colors" title="Clear"><span className="material-symbols-outlined text-[14px]">close</span></button>}
                      </div>
                      <button onClick={() => setModalOpen(true)} disabled={!activeProviders?.length} className={`w-full sm:w-auto rounded border px-2 py-2 text-xs transition-colors sm:py-1.5 whitespace-nowrap sm:shrink-0 ${activeProviders?.length ? "bg-surface border-border text-text-main hover:border-primary cursor-pointer" : "opacity-50 cursor-not-allowed border-border"}`}>Select Model</button>
                    </>
                  )}
                </div>

                {/* Subagent Model */}
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
                  <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">Subagent Model</span>
                  <span className="material-symbols-outlined hidden text-text-muted text-[14px] sm:inline">arrow_forward</span>
                  {mode === "native" ? (
                    <select value={subagentModel} onChange={(event) => { setSubagentModel(event.target.value); setSubagentCustomized(true); }} className="w-full min-w-0 rounded border border-border bg-surface px-2 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary/50 sm:py-1.5">
                      {nativeCatalog.models.map((model) => (
                        <option key={model.slug} value={model.slug}>{model.display_name}</option>
                      ))}
                    </select>
                  ) : <div className="relative w-full min-w-0">
                    <input
                      type="text"
                      value={subagentModel}
                      onChange={(e) => setSubagentModel(e.target.value)}
                      placeholder={selectedModel || "provider/model-id (defaults to main model)"}
                      className="w-full min-w-0 pl-2 pr-7 py-2 bg-surface rounded border border-border text-xs focus:outline-none focus:ring-1 focus:ring-primary/50 sm:py-1.5"
                    />
                    {subagentModel && (
                      <button
                        onClick={() => setSubagentModel("")}
                        className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 text-text-muted hover:text-red-500 rounded transition-colors"
                        title="Clear (will use main model)"
                      >
                        <span className="material-symbols-outlined text-[14px]">close</span>
                      </button>
                    )}
                  </div>}
                  {mode === "universal" && <button
                    onClick={() => setSubagentModalOpen(true)}
                    disabled={!activeProviders?.length}
                    className={`w-full sm:w-auto rounded border px-2 py-2 text-xs transition-colors sm:py-1.5 whitespace-nowrap sm:shrink-0 ${activeProviders?.length ? "bg-surface border-border text-text-main hover:border-primary cursor-pointer" : "opacity-50 cursor-not-allowed border-border"}`}
                  >
                    Select Model
                  </button>}
                </div>
              </div>

              {message && (
                <div className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs ${message.type === "success" ? "bg-green-500/10 text-green-600" : "bg-red-500/10 text-red-600"}`}>
                  <span className="material-symbols-outlined text-[14px]">{message.type === "success" ? "check_circle" : "error"}</span>
                  <span>{message.text}</span>
                </div>
              )}

              <div className="grid grid-cols-1 gap-2 sm:flex sm:items-center">
                <Button variant="primary" size="sm" onClick={handleApplySettings} disabled={(!selectedApiKey && (cloudEnabled && apiKeys.length > 0)) || !selectedModel} loading={applying}>
                  <span className="material-symbols-outlined text-[14px] mr-1">save</span>Apply
                </Button>
                <Button variant="outline" size="sm" onClick={handleResetSettings} disabled={restoring} loading={restoring}>
                  <span className="material-symbols-outlined text-[14px] mr-1">restore</span>Reset
                </Button>
                {mode === "native" && (
                  <Button variant="outline" size="sm" onClick={handleRepairNative} disabled={testingNative} loading={testingNative}>
                    <span className="material-symbols-outlined text-[14px] mr-1">network_check</span>
                    {nativeReadiness ? "Test again / Repair Native" : "Test Native"}
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={() => setShowManualConfigModal(true)}>
                  <span className="material-symbols-outlined text-[14px] mr-1">content_copy</span>Manual Config
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      {mode === "universal" && modalOpen && (
        <ModelSelectModal
          isOpen={modalOpen}
          onClose={() => setModalOpen(false)}
          onSelect={handleModelSelect}
          selectedModel={selectedModel}
          activeProviders={activeProviders}
          modelAliases={modelAliases}
          title="Select Model for Codex"
        />
      )}

      {mode === "universal" && subagentModalOpen && (
        <ModelSelectModal
          isOpen={subagentModalOpen}
          onClose={() => setSubagentModalOpen(false)}
          onSelect={(model) => { setSubagentModel(model.value); setSubagentModalOpen(false); }}
          selectedModel={subagentModel}
          activeProviders={activeProviders}
          modelAliases={modelAliases}
          title="Select Subagent Model for Codex"
        />
      )}

      <ManualConfigModal
        isOpen={showManualConfigModal}
        onClose={() => setShowManualConfigModal(false)}
        title="Codex CLI - Manual Configuration"
        configs={getManualConfigs()}
      />
    </Card>
  );
}
