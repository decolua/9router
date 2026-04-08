"use client";

import { useState, useEffect } from "react";
import { Card, Button, ManualConfigModal, ModelSelectModal } from "@/shared/components";
import Image from "next/image";

const CLOUD_URL = process.env.NEXT_PUBLIC_CLOUD_URL;

export default function AmpToolCard({
  tool,
  isExpanded,
  onToggle,
  baseUrl,
  apiKeys,
  cloudEnabled,
  initialStatus,
  activeProviders,
  modelMappings,
  onModelMappingChange,
  hasActiveProviders,
}) {
  const [ampStatus, setAmpStatus] = useState(initialStatus || null);
  const [checkingAmp, setCheckingAmp] = useState(false);
  const [applying, setApplying] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);
  const [message, setMessage] = useState(null);
  const [showInstallGuide, setShowInstallGuide] = useState(false);
  const [selectedApiKey, setSelectedApiKey] = useState("");
  const [showManualConfigModal, setShowManualConfigModal] = useState(false);
  const [customBaseUrl, setCustomBaseUrl] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [currentEditingAlias, setCurrentEditingAlias] = useState(null);
  const [modelAliases, setModelAliases] = useState({});

  const getConfigStatus = () => {
    if (!ampStatus?.installed) return null;
    const currentUrl = ampStatus.settings?.["amp.url"];
    if (!currentUrl) return "not_configured";
    const localMatch = currentUrl.includes("localhost") || currentUrl.includes("127.0.0.1");
    const cloudMatch = cloudEnabled && CLOUD_URL && currentUrl.startsWith(CLOUD_URL);
    const tunnelMatch = baseUrl && currentUrl.startsWith(baseUrl);
    if (localMatch || cloudMatch || tunnelMatch) return "configured";
    return "other";
  };

  const configStatus = getConfigStatus();

  useEffect(() => {
    if (apiKeys?.length > 0 && !selectedApiKey) {
      setSelectedApiKey(apiKeys[0].key);
    }
  }, [apiKeys, selectedApiKey]);

  useEffect(() => {
    if (initialStatus) setAmpStatus(initialStatus);
  }, [initialStatus]);

  useEffect(() => {
    if (isExpanded && !ampStatus) {
      checkAmpStatus();
      fetchModelAliases();
      loadModelMappings();
    }
    if (isExpanded) {
      fetchModelAliases();
      loadModelMappings();
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

  const loadModelMappings = async () => {
    try {
      const res = await fetch("/api/settings");
      const data = await res.json();
      if (res.ok && data.ampModelMappings) {
        // Load saved model mappings into the component state
        Object.entries(data.ampModelMappings).forEach(([alias, model]) => {
          if (model) {
            onModelMappingChange?.(alias, model);
          }
        });
      }
    } catch (error) {
      console.log("Error loading model mappings:", error);
    }
  };

  const checkAmpStatus = async () => {
    setCheckingAmp(true);
    try {
      const res = await fetch("/api/cli-tools/amp-settings");
      const data = await res.json();
      setAmpStatus(data);
    } catch (error) {
      setAmpStatus({ installed: false, error: error.message });
    } finally {
      setCheckingAmp(false);
    }
  };

  const getEffectiveBaseUrl = () => {
    return customBaseUrl || baseUrl;
  };

  const getDisplayUrl = () => {
    return customBaseUrl || baseUrl;
  };

  const handleApplySettings = async () => {
    setApplying(true);
    setMessage(null);
    try {
      const url = getEffectiveBaseUrl();

      // Get key from dropdown, fallback to first key or sk_9router for localhost
      const keyToUse = selectedApiKey?.trim()
        || (apiKeys?.length > 0 ? apiKeys[0].key : null)
        || (!cloudEnabled ? "sk_9router" : null);

      const res = await fetch("/api/cli-tools/amp-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url,
          apiKey: keyToUse,
          modelMappings: modelMappings || {}
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: "Settings applied successfully!" });
        setAmpStatus(prev => ({
          ...prev,
          has9Router: true,
          settings: { ...prev?.settings, "amp.url": url }
        }));
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
      const res = await fetch("/api/cli-tools/amp-settings", { method: "DELETE" });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: "Settings reset successfully!" });
        setSelectedApiKey("");
        tool.defaultModels?.forEach((model) => onModelMappingChange?.(model.alias, ""));
      } else {
        setMessage({ type: "error", text: data.error || "Failed to reset settings" });
      }
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    } finally {
      setRestoring(false);
    }
  };

  const handleAmpLogin = async () => {
    setLoggingIn(true);
    setMessage(null);
    try {
      // Get key from dropdown or use default
      const keyToUse = selectedApiKey?.trim()
        || (apiKeys?.length > 0 ? apiKeys[0].key : null);

      if (!keyToUse) {
        setMessage({ type: "error", text: "Please select or create an API key first" });
        return;
      }

      // Request login from Amp
      const res = await fetch("/api/amp-cli-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: keyToUse }),
      });

      const data = await res.json();

      if (res.ok) {
        // Open auth URL in new window
        if (data.authUrl) {
          window.open(data.authUrl, "_blank");
          setMessage({
            type: "success",
            text: `Login initiated! Verification code: ${data.verificationCode}. Complete authentication in the opened window.`
          });
        }
      } else {
        setMessage({ type: "error", text: data.error || "Failed to initiate login" });
      }
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    } finally {
      setLoggingIn(false);
    }
  };

  const openModelSelector = (alias) => {
    setCurrentEditingAlias(alias);
    setModalOpen(true);
  };

  const handleModelSelect = (model) => {
    if (currentEditingAlias) onModelMappingChange?.(currentEditingAlias, model.value);
  };

  // Generate config files content for manual copy
  const getManualConfigs = () => {
    const url = getEffectiveBaseUrl();
    const keyToUse = (selectedApiKey && selectedApiKey.trim())
      ? selectedApiKey
      : (!cloudEnabled ? "sk_9router" : "<API_KEY_FROM_DASHBOARD>");

    return [
      {
        filename: "~/.config/amp/settings.json",
        content: JSON.stringify({ "amp.url": url }, null, 2),
      },
      {
        filename: "~/.local/share/amp/secrets.json",
        content: JSON.stringify({ [`apiKey@${url}`]: keyToUse }, null, 2),
      },
      {
        filename: "Environment Variables (Alternative)",
        content: `export AMP_URL="${url}"\nexport AMP_API_KEY="${keyToUse}"`,
      },
    ];
  };

  return (
    <Card padding="xs" className="overflow-hidden">
      <div className="flex items-center justify-between hover:cursor-pointer" onClick={onToggle}>
        <div className="flex items-center gap-3">
          <div className="size-8 flex items-center justify-center shrink-0">
            <Image
              src="/providers/amp.svg"
              alt={tool.name}
              width={32}
              height={32}
              className="size-8 object-contain"
              sizes="32px"
              onError={(e) => { e.target.style.display = "none"; }}
            />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
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
          {checkingAmp && (
            <div className="flex items-center gap-2 text-text-muted">
              <span className="material-symbols-outlined animate-spin">progress_activity</span>
              <span>Checking Amp CLI...</span>
            </div>
          )}

          {!checkingAmp && ampStatus && !ampStatus.installed && (
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-3 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                <span className="material-symbols-outlined text-yellow-500">warning</span>
                <div className="flex-1">
                  <p className="font-medium text-yellow-600 dark:text-yellow-400">Amp CLI not installed</p>
                  <p className="text-sm text-text-muted">Please install Amp CLI to use this feature.</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => setShowInstallGuide(!showInstallGuide)}>
                  <span className="material-symbols-outlined text-[18px] mr-1">{showInstallGuide ? "expand_less" : "help"}</span>
                  {showInstallGuide ? "Hide" : "How to Install"}
                </Button>
              </div>
              {showInstallGuide && (
                <div className="p-4 bg-surface border border-border rounded-lg">
                  <h4 className="font-medium mb-3">Installation Guide</h4>
                  <div className="space-y-3 text-sm">
                    <div>
                      <p className="text-text-muted mb-1">macOS / Linux:</p>
                      <code className="block px-3 py-2 bg-black/5 dark:bg-white/5 rounded font-mono text-xs">npm install -g @amp/cli</code>
                    </div>
                    <p className="text-text-muted">After installation, run <code className="px-1 bg-black/5 dark:bg-white/5 rounded">amp</code> to verify.</p>
                    <p className="text-text-muted text-xs mt-2">Visit <a href="https://ampcode.com" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">ampcode.com</a> for more information.</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {!checkingAmp && ampStatus?.installed && (
            <>
              <div className="flex flex-col gap-2">
                {/* Current URL */}
                {ampStatus?.settings?.["amp.url"] && (
                  <div className="flex items-center gap-2">
                    <span className="w-32 shrink-0 text-sm font-semibold text-text-main text-right">Current</span>
                    <span className="material-symbols-outlined text-text-muted text-[14px]">arrow_forward</span>
                    <span className="flex-1 px-2 py-1.5 text-xs text-text-muted truncate">
                      {ampStatus.settings["amp.url"]}
                    </span>
                  </div>
                )}

                {/* Base URL */}
                <div className="flex items-center gap-2">
                  <span className="w-32 shrink-0 text-sm font-semibold text-text-main text-right">Base URL</span>
                  <span className="material-symbols-outlined text-text-muted text-[14px]">arrow_forward</span>
                  <input
                    type="text"
                    value={getDisplayUrl()}
                    onChange={(e) => setCustomBaseUrl(e.target.value)}
                    placeholder="http://localhost:20128"
                    className="flex-1 px-2 py-1.5 bg-surface rounded border border-border text-xs focus:outline-none focus:ring-1 focus:ring-primary/50"
                  />
                  {customBaseUrl && customBaseUrl !== baseUrl && (
                    <button onClick={() => setCustomBaseUrl("")} className="p-1 text-text-muted hover:text-primary rounded transition-colors" title="Reset to default">
                      <span className="material-symbols-outlined text-[14px]">restart_alt</span>
                    </button>
                  )}
                </div>

                {/* API Key */}
                <div className="flex items-center gap-2">
                  <span className="w-32 shrink-0 text-sm font-semibold text-text-main text-right">API Key</span>
                  <span className="material-symbols-outlined text-text-muted text-[14px]">arrow_forward</span>
                  {apiKeys.length > 0 ? (
                    <select value={selectedApiKey} onChange={(e) => setSelectedApiKey(e.target.value)} className="flex-1 px-2 py-1.5 bg-surface rounded text-xs border border-border focus:outline-none focus:ring-1 focus:ring-primary/50">
                      {apiKeys.map((key) => <option key={key.id} value={key.key}>{key.key}</option>)}
                    </select>
                  ) : (
                    <span className="flex-1 text-xs text-text-muted px-2 py-1.5">
                      {cloudEnabled ? "No API keys - Create one in Keys page" : "sk_9router (default)"}
                    </span>
                  )}
                </div>

                {/* Model Mappings for Amp Modes */}
                {tool.defaultModels && tool.defaultModels.map((model) => (
                  <div key={model.alias} className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span className="w-32 shrink-0 text-sm font-semibold text-text-main text-right">{model.name}</span>
                      <span className="material-symbols-outlined text-text-muted text-[14px]">arrow_forward</span>
                      <input
                        type="text"
                        value={modelMappings?.[model.alias] || ""}
                        onChange={(e) => onModelMappingChange?.(model.alias, e.target.value)}
                        placeholder="provider/model-id"
                        className="flex-1 px-2 py-1.5 bg-surface rounded border border-border text-xs focus:outline-none focus:ring-1 focus:ring-primary/50"
                      />
                      <button
                        onClick={() => openModelSelector(model.alias)}
                        disabled={!hasActiveProviders}
                        className={`px-2 py-1.5 rounded border text-xs transition-colors shrink-0 whitespace-nowrap ${
                          hasActiveProviders
                            ? "bg-surface border-border text-text-main hover:border-primary cursor-pointer"
                            : "opacity-50 cursor-not-allowed border-border"
                        }`}
                      >
                        Select Model
                      </button>
                      {modelMappings?.[model.alias] && (
                        <button
                          onClick={() => onModelMappingChange?.(model.alias, "")}
                          className="p-1 text-text-muted hover:text-red-500 rounded transition-colors"
                          title="Clear"
                        >
                          <span className="material-symbols-outlined text-[14px]">close</span>
                        </button>
                      )}
                    </div>
                    {model.description && (
                      <p className="text-xs text-text-muted ml-[140px]">{model.description}</p>
                    )}
                  </div>
                ))}
              </div>

              {message && (
                <div className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs ${message.type === "success" ? "bg-green-500/10 text-green-600" : "bg-red-500/10 text-red-600"}`}>
                  <span className="material-symbols-outlined text-[14px]">{message.type === "success" ? "check_circle" : "error"}</span>
                  <span>{message.text}</span>
                </div>
              )}

              <div className="flex items-center gap-2">
                <Button variant="primary" size="sm" onClick={handleApplySettings} loading={applying}>
                  <span className="material-symbols-outlined text-[14px] mr-1">save</span>Apply
                </Button>
                <Button variant="outline" size="sm" onClick={handleAmpLogin} loading={loggingIn} disabled={!selectedApiKey && apiKeys?.length === 0}>
                  <span className="material-symbols-outlined text-[14px] mr-1">login</span>Amp Login
                </Button>
                <Button variant="outline" size="sm" onClick={handleResetSettings} disabled={!ampStatus?.has9Router} loading={restoring}>
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
        selectedModel={currentEditingAlias ? modelMappings?.[currentEditingAlias] : null}
        activeProviders={activeProviders}
        modelAliases={modelAliases}
        title={`Select model for ${currentEditingAlias}`}
      />

      <ManualConfigModal
        isOpen={showManualConfigModal}
        onClose={() => setShowManualConfigModal(false)}
        title="Amp CLI - Manual Configuration"
        configs={getManualConfigs()}
      />
    </Card>
  );
}
