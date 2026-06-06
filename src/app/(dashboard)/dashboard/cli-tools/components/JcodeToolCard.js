"use client";

import { useState, useEffect, useRef } from "react";
import { Card, Button, ModelSelectModal, ManualConfigModal } from "@/shared/components";
import ConfigStatusBadge from "@/shared/components/ConfigStatusBadge";
import InlineAlert from "@/shared/components/InlineAlert";
import Image from "next/image";
import BaseUrlSelect from "./BaseUrlSelect";
import ApiKeySelect from "./ApiKeySelect";
import { matchKnownEndpoint } from "./cliEndpointMatch";
import { revealApiKey } from "@/shared/utils/revealApiKey";
import CliNotDetectedPanel from "./CliNotDetectedPanel";

export default function JcodeToolCard({
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
  const [jcodeStatus, setJcodeStatus] = useState(initialStatus || null);
  const [checkingJcode, setCheckingJcode] = useState(false);
  const [applying, setApplying] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [message, setMessage] = useState(null);
  const [selectedApiKey, setSelectedApiKey] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [modelAliases, setModelAliases] = useState({});
  const [showManualConfigModal, setShowManualConfigModal] = useState(false);
  const [customBaseUrl, setCustomBaseUrl] = useState("");
  const hasInitializedModel = useRef(false);

  const getConfigStatus = () => {
    if (!jcodeStatus?.installed) return null;
    if (!jcodeStatus?.has9Router) return "not_configured";
    const currentProvider = jcodeStatus.config?.providers?.["9router"];
    if (!currentProvider) return "not_configured";
    return matchKnownEndpoint(currentProvider.base_url, { tunnelPublicUrl, tailscaleUrl }) ? "configured" : "other";
  };

  const configStatus = getConfigStatus();

  const fetchModelAliases = async () => {
    try {
      const res = await fetch("/api/models/alias");
      const data = await res.json();
      if (res.ok) setModelAliases(data.aliases || {});
    } catch (error) {
      console.log("Error fetching model aliases:", error);
    }
  };

  const checkJcodeStatus = async () => {
    setCheckingJcode(true);
    try {
      const res = await fetch("/api/cli-tools/jcode-settings");
      const data = await res.json();
      setJcodeStatus(data);
    } catch (error) {
      setJcodeStatus({ installed: false, error: error.message });
    } finally {
      setCheckingJcode(false);
    }
  };
useEffect(() => {
    if (initialStatus) queueMicrotask(() => setJcodeStatus(initialStatus));
  }, [initialStatus]);

  useEffect(() => {
    if (isExpanded && !jcodeStatus) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      checkJcodeStatus();
      fetchModelAliases();
    }
    if (isExpanded) fetchModelAliases();
  }, [isExpanded]);


  useEffect(() => {
    if (jcodeStatus?.installed && !hasInitializedModel.current) {
      hasInitializedModel.current = true;
      const provider = jcodeStatus.config?.providers?.["9router"];
      if (provider) {
        if (provider.default_model) {
          queueMicrotask(() => setSelectedModel(provider.default_model));
        }
        // Try to match API key from env file
        const envApiKey = jcodeStatus.envApiKey;
        if (envApiKey && apiKeys?.some(k => k.key === envApiKey)) {
          queueMicrotask(() => setSelectedApiKey(envApiKey));
        }
      }
    }
  }, [jcodeStatus, apiKeys]);


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

  const handleApplySettings = async () => {
    setApplying(true);
    setMessage(null);
    try {
      const keyToUse = selectedApiKey?.trim()
        || (apiKeys?.length > 0 ? await revealApiKey(apiKeys[0].id) : null)
        || (!cloudEnabled ? "sk_9router" : null);

      const res = await fetch("/api/cli-tools/jcode-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: getEffectiveBaseUrl(),
          apiKey: keyToUse,
          models: selectedModel ? [selectedModel] : [],
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: "Settings applied successfully!" });
        checkJcodeStatus();
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
      const res = await fetch("/api/cli-tools/jcode-settings", { method: "DELETE" });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: "Settings reset successfully!" });
        setSelectedModel("");
        setSelectedApiKey("");
        checkJcodeStatus();
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
    setModalOpen(false);
  };

  const getManualConfigs = () => {
    const keyToUse = (selectedApiKey && selectedApiKey.trim())
      ? selectedApiKey
      : (!cloudEnabled ? "sk_9router" : "<API_KEY_FROM_DASHBOARD>");

    const configToml = `[providers.9router]
type = "openai-compatible"
base_url = "${getEffectiveBaseUrl()}"
auth = "bearer"
api_key_env = "JCODE_9ROUTER_API_KEY"
env_file = "provider-9router.env"
default_model = "${selectedModel || "cc/claude-opus-4-7"}"
requires_api_key = true

[[providers.9router.models]]
id = "${selectedModel || "cc/claude-opus-4-7"}"`;

    const envContent = `JCODE_9ROUTER_API_KEY="${keyToUse}"`;

    return [
      {
        filename: "~/.jcode/config.toml",
        content: configToml,
      },
      {
        filename: "~/.config/jcode/provider-9router.env",
        content: envContent,
      },
    ];
  };

  return (
    <Card padding="xs" className="overflow-hidden">
      <div className="flex items-start justify-between gap-3 hover:cursor-pointer sm:items-center" onClick={onToggle}>
        <div className="flex min-w-0 items-center gap-3">
          <div className="size-8 flex items-center justify-center shrink-0">
            <Image src={tool.image || "/providers/jcode.png"} alt={tool.name} width={32} height={32} className="size-8 object-contain rounded-lg" sizes="32px" onError={(e) => { e.target.style.display = "none"; }} />
          </div>
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h3 className="font-medium text-sm">{tool.name}</h3>
              <ConfigStatusBadge status={configStatus} />
            </div>
            <p className="text-xs text-text-muted truncate">{tool.description}</p>
          </div>
        </div>
        <span className={`material-symbols-outlined text-text-muted text-[20px] transition-transform ${isExpanded ? "rotate-180" : ""}`}>expand_more</span>
      </div>

      {isExpanded && (
        <div className="mt-4 pt-4 border-t border-border flex flex-col gap-4">
          {checkingJcode && (
            <div className="flex items-center gap-2 text-text-muted">
              <span className="material-symbols-outlined animate-spin">progress_activity</span>
              <span>Checking jcode CLI...</span>
            </div>
          )}

          {!checkingJcode && jcodeStatus && !jcodeStatus.installed && (
            <div className="flex flex-col gap-4">
              <CliNotDetectedPanel
                cliName="jcode CLI"
                onManualConfig={() => setShowManualConfigModal(true)}
              />
            </div>
          )}

          {!checkingJcode && jcodeStatus?.installed && (
            <>
              <div className="flex flex-col gap-2">
                {/* Info notes */}
                {tool.notes && tool.notes.length > 0 && (
                  <div className="flex flex-col gap-2 mb-2">
                    {tool.notes.map((note, idx) => (
                      <InlineAlert
                        key={idx}
                        variant={note.type === "warning" ? "caution" : note.type === "error" ? "danger" : "info"}
                        message={note.text}
                        compact
                      />
                    ))}
                  </div>
                )}

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
                {jcodeStatus?.config?.providers?.["9router"]?.base_url && (
                  <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
                    <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">Current</span>
                    <span className="material-symbols-outlined hidden text-text-muted text-[14px] sm:inline">arrow_forward</span>
                    <span className="min-w-0 truncate rounded bg-surface/40 px-2 py-2 text-xs text-text-muted sm:py-1.5">
                      {jcodeStatus.config.providers["9router"].base_url}
                    </span>
                  </div>
                )}

                {/* API Key */}
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
                  <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">API Key</span>
                  <span className="material-symbols-outlined hidden text-text-muted text-[14px] sm:inline">arrow_forward</span>
                  <ApiKeySelect value={selectedApiKey} onChange={setSelectedApiKey} apiKeys={apiKeys} cloudEnabled={cloudEnabled} />
                </div>

                {/* Default Model */}
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
                  <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">Default Model</span>
                  <span className="material-symbols-outlined hidden text-text-muted text-[14px] sm:inline">arrow_forward</span>
                  <div className="relative w-full min-w-0">
                    <input type="text" value={selectedModel} onChange={(e) => setSelectedModel(e.target.value)} placeholder="cc/claude-opus-4-7" className="w-full min-w-0 pl-2 pr-7 py-2 bg-surface rounded border border-border text-xs focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500/40 sm:py-1.5" />
                    {selectedModel && <button onClick={() => setSelectedModel("")} className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 text-text-muted hover:text-danger rounded transition-colors" title="Clear"><span className="material-symbols-outlined text-[14px]">close</span></button>}
                  </div>
                  <button onClick={() => setModalOpen(true)} disabled={!hasActiveProviders} className={`w-full sm:w-auto rounded border px-2 py-2 text-xs transition-colors sm:py-1.5 whitespace-nowrap sm:shrink-0 ${hasActiveProviders ? "bg-surface border-border text-text-main hover:border-primary cursor-pointer" : "opacity-50 cursor-not-allowed border-border"}`}>Select</button>
                </div>

                {/* Usage hint */}
                <div className="flex flex-col gap-1 p-3 bg-info/5 border border-info/20 rounded-lg">
                  <p className="text-xs font-medium text-info">Usage:</p>
                  <code className="text-xs font-mono text-text-muted">jcode --provider-profile 9router</code>
                  <code className="text-xs font-mono text-text-muted">jcode --provider-profile 9router --model {selectedModel || "cc/claude-opus-4-7"}</code>
                </div>
              </div>

              {message && (
                <div className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs ${message.type === "success" ? "bg-success/10 text-success" : "bg-danger/10 text-danger"}`}>
                  <span className="material-symbols-outlined text-[14px]">{message.type === "success" ? "check_circle" : "error"}</span>
                  <span>{message.text}</span>
                </div>
              )}

              <div className="grid grid-cols-1 gap-2 sm:flex sm:items-center">
                <Button variant="primary" size="sm" onClick={handleApplySettings} disabled={!selectedModel} loading={applying}>
                  <span className="material-symbols-outlined text-[14px] mr-1">save</span>Apply
                </Button>
                <Button variant="outline" size="sm" onClick={handleResetSettings} disabled={!jcodeStatus?.has9Router} loading={restoring}>
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
        selectedModel={selectedModel}
        activeProviders={activeProviders}
        modelAliases={modelAliases}
        title="Select Model for jcode"
      />

      <ManualConfigModal
        isOpen={showManualConfigModal}
        onClose={() => setShowManualConfigModal(false)}
        title="jcode - Manual Configuration"
        configs={getManualConfigs()}
      />
    </Card>
  );
}
