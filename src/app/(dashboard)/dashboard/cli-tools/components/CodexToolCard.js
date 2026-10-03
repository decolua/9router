"use client";

import { useState, useEffect } from "react";
import { Card, Button, ModelSelectModal, ManualConfigModal } from "@/shared/components";
import Image from "next/image";
import ProviderIcon from "@/shared/components/ProviderIcon";
import BaseUrlSelect from "./BaseUrlSelect";
import ApiKeySelect from "./ApiKeySelect";
import { matchKnownEndpoint } from "./cliEndpointMatch";
import { rememberEndpoint } from "./cliEndpointPresets";
import { getCurrentCodexProviderSettings, deriveProfileNameFromModel } from "./codexConfig";

export default function CodexToolCard({ tool, isExpanded, onToggle, baseUrl, apiKeys, activeProviders, cloudEnabled, initialStatus, tunnelEnabled, tunnelPublicUrl, tailscaleEnabled, tailscaleUrl }) {
  const [codexStatus, setCodexStatus] = useState(initialStatus || null);
  const [checkingCodex, setCheckingCodex] = useState(false);
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
  const [profiles, setProfiles] = useState([]);
  const [aliasInput, setAliasInput] = useState("");
  const [modelInput, setModelInput] = useState("");
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [creatingProfile, setCreatingProfile] = useState(false);
  const [deletingProfile, setDeletingProfile] = useState(null);
  const [copiedCommand, setCopiedCommand] = useState("");

  useEffect(() => {
    fetchProfiles();
  }, []);

  useEffect(() => {
    if (apiKeys?.length > 0 && !selectedApiKey && !codexStatus?.config) {
      setSelectedApiKey(apiKeys[0].key);
    }
  }, [apiKeys, selectedApiKey, codexStatus?.config]);

  useEffect(() => {
    if (initialStatus) setCodexStatus(initialStatus);
  }, [initialStatus]);

  useEffect(() => {
    if (isExpanded) {
      if (!codexStatus) checkCodexStatus();
      fetchModelAliases();
      fetchProfiles();
    }
  }, [isExpanded]);

  const fetchModelAliases = async () => {
    try {
      const res = await fetch("/api/models/alias");
      const data = await res.json();
      if (res.ok) setModelAliases(data.aliases || {});
    } catch (error) {
      console.log("Error fetching model aliases:", error);
    }
  };

  const fetchProfiles = async () => {
    try {
      const res = await fetch("/api/cli-tools/codex-profiles");
      const data = await res.json();
      if (res.ok) setProfiles(data.profiles || []);
    } catch (error) {
      console.log("Error fetching codex profiles:", error);
    }
  };

  const handleModelSelectForAlias = (model) => {
    setProfileModalOpen(false);
    const selectedModelId = model?.value || model?.id;
    if (!selectedModelId) return;

    setModelInput(selectedModelId);
    const providerName = model?.provider || (selectedModelId.includes("/") ? selectedModelId.split("/")[0] : selectedModelId);
    const existingNames = profiles.map((p) => p.name);
    setAliasInput(deriveProfileNameFromModel(providerName, existingNames));
  };

  const handleAddProfileWithAlias = async () => {
    const cleanAlias = aliasInput.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
    const cleanModel = modelInput.trim();
    if (!cleanAlias || !cleanModel) return;

    setCreatingProfile(true);
    try {
      const res = await fetch("/api/cli-tools/codex-profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: cleanAlias,
          model: cleanModel,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setAliasInput("");
        setModelInput("");
        fetchProfiles();
      } else {
        setMessage({ type: "error", text: data.error || "Failed to add model" });
      }
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    } finally {
      setCreatingProfile(false);
    }
  };

  const handleDeleteProfile = async (name) => {
    setDeletingProfile(name);
    try {
      const res = await fetch("/api/cli-tools/codex-profiles", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (res.ok) fetchProfiles();
    } catch (error) {
      console.log("Error deleting codex profile:", error);
    } finally {
      setDeletingProfile(null);
    }
  };

  const handleCopyCommand = async (cmd) => {
    try {
      await navigator.clipboard.writeText(cmd);
      setCopiedCommand(cmd);
      setTimeout(() => setCopiedCommand(""), 2000);
    } catch (e) {
      console.log("Copy failed", e);
    }
  };

  // Sync only when config content changes so local form edits are retained.
  useEffect(() => {
    const config = codexStatus?.config;
    if (config) {
      const { baseUrl, apiKey } = getCurrentCodexProviderSettings(config);
      setCustomBaseUrl(baseUrl);
      setSelectedApiKey(apiKey);

      const modelMatch = config.match(/^model\s*=\s*"([^"]+)"/m);
      if (modelMatch) setSelectedModel(modelMatch[1]);

      // Parse subagent settings
      const subagentModelMatch = config.match(/^default_subagent_model\s*=\s*"([^"]+)"/m);
      if (subagentModelMatch) setSubagentModel(subagentModelMatch[1]);
    }
  }, [codexStatus?.config]);

  const currentBaseUrl = getCurrentCodexProviderSettings(codexStatus?.config).baseUrl;

  const getConfigStatus = () => {
    if (!codexStatus?.installed) return null;
    if (!codexStatus.config) return "not_configured";
    return matchKnownEndpoint(currentBaseUrl, { tunnelPublicUrl, tailscaleUrl }) ? "configured" : "other";
  };

  const configStatus = getConfigStatus();

  const getEffectiveBaseUrl = () => {
    const url = (customBaseUrl || `${baseUrl}/v1`).replace(/\/+$/, "");
    // Ensure URL ends with /v1
    return url.endsWith("/v1") ? url : `${url}/v1`;
  };

  const getDisplayUrl = () => customBaseUrl || `${baseUrl}/v1`;

  const checkCodexStatus = async () => {
    setCheckingCodex(true);
    try {
      const res = await fetch("/api/cli-tools/codex-settings", { cache: "no-store" });
      const data = await res.json();
      setCodexStatus(data);
    } catch (error) {
      setCodexStatus({ installed: false, error: error.message });
    } finally {
      setCheckingCodex(false);
    }
  };

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
          subagentModel: subagentModel || selectedModel
        }),
      });
      const data = await res.json();
      if (res.ok) {
        // Remember the endpoint so it stays selectable next time
        rememberEndpoint(getEffectiveBaseUrl(), { tunnelPublicUrl, tailscaleUrl });
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

  const getManualConfigs = () => {
    const keyToUse = (selectedApiKey && selectedApiKey.trim())
      ? selectedApiKey
      : (!cloudEnabled ? "sk_9router" : "<API_KEY_FROM_DASHBOARD>");

    const effectiveSubagentModel = subagentModel || selectedModel;

    const configContent = `# 9Router Configuration for Codex CLI
model = "${selectedModel}"
model_provider = "9router"

[model_providers.9router]
name = "9Router"
base_url = "${getEffectiveBaseUrl()}"
wire_api = "responses"

[model_providers.9router.http_headers]
Authorization = "Bearer ${keyToUse}"

[agents]
default_subagent_model = "${effectiveSubagentModel}"
`;

    return [
      {
        filename: "~/.codex/config.toml",
        content: configContent,
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
                        Codex reads custom providers from <code className="px-1 bg-black/5 dark:bg-white/5 rounded">~/.codex/config.toml</code>.
                        Click &quot;Apply&quot; to auto-configure.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {!checkingCodex && codexStatus?.installed && (
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
                    currentUrl={currentBaseUrl}
                  />
                </div>

                {/* Current configured */}
                {codexStatus?.config && (() => {
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
                  <div className="relative w-full min-w-0">
                    <input type="text" value={selectedModel} onChange={(e) => setSelectedModel(e.target.value)} placeholder="provider/model-id" className="w-full min-w-0 pl-2 pr-7 py-2 bg-surface rounded border border-border text-xs focus:outline-none focus:ring-1 focus:ring-primary/50 sm:py-1.5" />
                    {selectedModel && <button onClick={() => setSelectedModel("")} className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 text-text-muted hover:text-red-500 rounded transition-colors" title="Clear"><span className="material-symbols-outlined text-[14px]">close</span></button>}
                  </div>
                  <button onClick={() => setModalOpen(true)} disabled={!activeProviders?.length} className={`w-full sm:w-auto rounded border px-2 py-2 text-xs transition-colors sm:py-1.5 whitespace-nowrap sm:shrink-0 ${activeProviders?.length ? "bg-surface border-border text-text-main hover:border-primary cursor-pointer" : "opacity-50 cursor-not-allowed border-border"}`}>Select Model</button>
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
                  </div>
                  <button
                    onClick={() => setSubagentModalOpen(true)}
                    disabled={!activeProviders?.length}
                    className={`w-full sm:w-auto rounded border px-2 py-2 text-xs transition-colors sm:py-1.5 whitespace-nowrap sm:shrink-0 ${activeProviders?.length ? "bg-surface border-border text-text-main hover:border-primary cursor-pointer" : "opacity-50 cursor-not-allowed border-border"}`}
                  >
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
                <Button variant="primary" size="sm" onClick={handleApplySettings} disabled={(!selectedApiKey && (cloudEnabled && apiKeys.length > 0)) || !selectedModel} loading={applying}>
                  <span className="material-symbols-outlined text-[14px] mr-1">save</span>Apply
                </Button>
                <Button variant="outline" size="sm" onClick={handleResetSettings} disabled={restoring} loading={restoring}>
                  <span className="material-symbols-outlined text-[14px] mr-1">restore</span>Reset
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setShowManualConfigModal(true)}>
                  <span className="material-symbols-outlined text-[14px] mr-1">content_copy</span>Manual Config
                </Button>
              </div>

              {/* Additional Models */}
              <div className="mt-4 pt-4 border-t border-border flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-text-main flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-[16px] text-primary">layers</span>
                      Additional Models
                    </span>
                    {profiles.length > 0 && (
                      <span className="px-1.5 py-0.2 bg-primary/10 text-primary text-[10px] font-medium rounded-full">
                        {profiles.length}
                      </span>
                    )}
                  </div>
                </div>

                {/* Quick Add Model bar */}
                <div className="flex flex-col gap-1.5 p-2.5 bg-surface/40 border border-border rounded-lg">
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-[10rem_1fr_auto_auto] sm:items-center">
                    <input
                      type="text"
                      value={aliasInput}
                      onChange={(e) => setAliasInput(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""))}
                      placeholder="Alias (e.g. claude)"
                      className="w-full min-w-0 px-2.5 py-1.5 bg-surface rounded border border-border text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary/50"
                      onKeyDown={(e) => e.key === "Enter" && handleAddProfileWithAlias()}
                    />
                    <div className="relative w-full min-w-0">
                      <input
                        type="text"
                        value={modelInput}
                        onChange={(e) => {
                          const val = e.target.value;
                          setModelInput(val);
                          const provider = val.includes("/") ? val.split("/")[0] : val;
                          setAliasInput(deriveProfileNameFromModel(provider, profiles.map((p) => p.name)));
                        }}
                        placeholder="provider/model-id"
                        className="w-full min-w-0 pl-2.5 pr-7 py-1.5 bg-surface rounded border border-border text-xs focus:outline-none focus:ring-1 focus:ring-primary/50"
                        onKeyDown={(e) => e.key === "Enter" && handleAddProfileWithAlias()}
                      />
                      {modelInput && (
                        <button
                          onClick={() => setModelInput("")}
                          className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 text-text-muted hover:text-red-500 rounded transition-colors"
                          title="Clear"
                        >
                          <span className="material-symbols-outlined text-[14px]">close</span>
                        </button>
                      )}
                    </div>
                    <button
                      onClick={() => setProfileModalOpen(true)}
                      disabled={!activeProviders?.length}
                      className={`w-full sm:w-auto rounded border px-2.5 py-1.5 text-xs transition-colors whitespace-nowrap sm:shrink-0 ${
                        activeProviders?.length
                          ? "bg-surface border-border text-text-main hover:border-primary cursor-pointer"
                          : "opacity-50 cursor-not-allowed border-border"
                      }`}
                    >
                      Select Model
                    </button>
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={handleAddProfileWithAlias}
                      disabled={!aliasInput.trim() || !modelInput.trim() || creatingProfile}
                      loading={creatingProfile}
                      className="!h-7.5 whitespace-nowrap"
                    >
                      <span className="material-symbols-outlined text-[15px] mr-1">add</span>
                      Add
                    </Button>
                  </div>
                </div>

                {profiles.length === 0 ? (
                  <div className="flex flex-col items-center justify-center p-4 border border-dashed border-border rounded-lg text-center bg-surface/30">
                    <span className="material-symbols-outlined text-[20px] text-text-muted mb-1 opacity-60">
                      terminal
                    </span>
                    <p className="text-xs text-text-muted">
                      Only the main model is active. Add an alias above to configure more models for Codex CLI.
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {profiles.map((p) => {
                      const providerId = p.model.includes("/") ? p.model.split("/")[0] : p.name;
                      const isCopied = copiedCommand === p.command;
                      return (
                        <div
                          key={p.name}
                          className="flex items-center justify-between gap-2 p-2.5 bg-surface/50 border border-border hover:border-border-hover rounded-lg transition-colors group"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className="size-6 flex items-center justify-center shrink-0 rounded bg-black/5 dark:bg-white/5 p-0.5">
                              <ProviderIcon providerId={providerId} size={18} fallbackText={p.name.slice(0, 2).toUpperCase()} />
                            </div>
                            <div className="min-w-0 flex flex-col">
                              <span className="font-medium text-xs text-text-main truncate">
                                {p.name}
                              </span>
                              <span className="text-[11px] text-text-muted truncate font-mono">
                                {p.model}
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              onClick={() => handleCopyCommand(p.command)}
                              className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-mono border transition-all ${
                                isCopied
                                  ? "bg-green-500/10 border-green-500/30 text-green-600 dark:text-green-400"
                                  : "bg-surface border-border text-text-muted hover:text-text-main hover:border-primary/50 cursor-pointer"
                              }`}
                              title="Click to copy command"
                            >
                              <span className="material-symbols-outlined text-[13px]">
                                {isCopied ? "check" : "terminal"}
                              </span>
                              <span className="hidden md:inline">{p.command}</span>
                              <span className="md:hidden">copy</span>
                            </button>

                            <button
                              onClick={() => handleDeleteProfile(p.name)}
                              disabled={deletingProfile === p.name}
                              className="p-1 text-text-muted hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity rounded"
                              title="Delete model"
                            >
                              <span className="material-symbols-outlined text-[15px]">close</span>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {modalOpen && (
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

      {subagentModalOpen && (
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

      {profileModalOpen && (
        <ModelSelectModal
          isOpen={profileModalOpen}
          onClose={() => setProfileModalOpen(false)}
          onSelect={handleModelSelectForAlias}
          selectedModel={modelInput}
          activeProviders={activeProviders}
          modelAliases={modelAliases}
          title="Select Model for Codex CLI"
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
