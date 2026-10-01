"use client";

import { useState, useEffect } from "react";
import { Card, Button, ModelSelectModal, ManualConfigModal } from "@/shared/components";
import Image from "next/image";
import BaseUrlSelect from "./BaseUrlSelect";
import { rememberEndpoint } from "./cliEndpointPresets";
import ApiKeySelect from "./ApiKeySelect";
import { matchKnownEndpoint } from "./cliEndpointMatch";
import { getModelsByProviderId, PROVIDER_ID_TO_ALIAS } from "@/shared/constants/models";

export default function GenericCliToolCard({
  tool,
  isExpanded,
  onToggle,
  baseUrl,
  apiKeys,
  activeProviders = [],
  cloudEnabled,
  initialStatus,
  tunnelEnabled,
  tunnelPublicUrl,
  tailscaleEnabled,
  tailscaleUrl,
}) {
  const [status, setStatus] = useState(() => initialStatus || null);
  const [checking, setChecking] = useState(false);
  const [applying, setApplying] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [message, setMessage] = useState(null);
  const [showInstallGuide, setShowInstallGuide] = useState(false);
  const [selectedApiKey, setSelectedApiKey] = useState(() => apiKeys?.[0]?.key || "");
  const [selectedModel, setSelectedModel] = useState(() => {
    const cfg = initialStatus?.config;
    return cfg?.model || cfg?.openai?.model || cfg?.providers?.["9router"]?.models?.[0]?.id || "";
  });
  const [selectedModels, setSelectedModels] = useState(() => {
    const cfg = initialStatus?.config;
    const list = cfg?.providers?.["9router"]?.models;
    if (Array.isArray(list) && list.length > 0) {
      return list.map((m) => (typeof m === "string" ? m : m.id));
    }
    return [];
  });
  const [modalOpen, setModalOpen] = useState(false);
  const [showManualConfigModal, setShowManualConfigModal] = useState(false);
  const [customBaseUrl, setCustomBaseUrl] = useState("");

  const endpointUrl = `/api/cli-tools/${tool.id}-settings`;

  useEffect(() => {
    let active = true;
    if (isExpanded && !initialStatus) {
      fetch(endpointUrl)
        .then((res) => res.json())
        .then((data) => {
          if (active) {
            setStatus(data);
            const cfg = data?.config;
            if (tool.id === "pi") {
              const list = cfg?.providers?.["9router"]?.models;
              if (Array.isArray(list) && list.length > 0) {
                const ids = list.map((m) => (typeof m === "string" ? m : m.id));
                setSelectedModels(ids);
              }
            } else {
              const mod = cfg?.model || cfg?.openai?.model || cfg?.providers?.["9router"]?.models?.[0]?.id;
              if (mod) setSelectedModel((prev) => prev || mod);
            }
          }
        })
        .catch((error) => {
          if (active) setStatus({ installed: false, error: error.message });
        });
    }
    return () => {
      active = false;
    };
  }, [isExpanded, initialStatus, endpointUrl, tool.id]);

  const checkStatus = async () => {
    setChecking(true);
    try {
      const res = await fetch(endpointUrl);
      const data = await res.json();
      setStatus(data);
      const cfg = data?.config;
      if (tool.id === "pi") {
        const list = cfg?.providers?.["9router"]?.models;
        if (Array.isArray(list) && list.length > 0) {
          const ids = list.map((m) => (typeof m === "string" ? m : m.id));
          setSelectedModels(ids);
        }
      } else {
        const mod = cfg?.model || cfg?.openai?.model || cfg?.providers?.["9router"]?.models?.[0]?.id;
        if (mod && !selectedModel) setSelectedModel(mod);
      }
    } catch (error) {
      setStatus({ installed: false, error: error.message });
    } finally {
      setChecking(false);
    }
  };

  const getEffectiveBaseUrl = () => {
    const url = customBaseUrl || `${baseUrl}/v1`;
    return url.endsWith("/v1") ? url : `${url}/v1`;
  };

  const getCurrentBaseUrl = () => {
    if (!status?.config) return "";
    const cfg = status.config;
    if (typeof cfg.baseUrl === "string") return cfg.baseUrl;
    if (typeof cfg.openai?.base_url === "string") return cfg.openai.base_url;
    if (typeof cfg.providers?.["9router"]?.base_url === "string") return cfg.providers["9router"].base_url;
    if (typeof cfg.providers?.["9router"]?.baseUrl === "string") return cfg.providers["9router"].baseUrl;
    return "";
  };

  const currentBaseUrl = getCurrentBaseUrl();

  const getConfigStatus = () => {
    if (!status?.installed) return null;
    if (!status.has9Router) return "not_configured";
    if (currentBaseUrl && matchKnownEndpoint(currentBaseUrl, { tunnelPublicUrl, tailscaleUrl })) {
      return "configured";
    }
    return "configured";
  };

  const configStatus = getConfigStatus();

  const handleApply = async () => {
    setApplying(true);
    setMessage(null);
    try {
      const keyToUse = (selectedApiKey && selectedApiKey.trim())
        ? selectedApiKey
        : (!cloudEnabled ? "sk_9router" : selectedApiKey);

      const payload = {
        baseUrl: getEffectiveBaseUrl(),
        apiKey: keyToUse,
      };

      if (tool.id === "pi") {
        payload.models = selectedModels.length > 0 ? selectedModels : ["provider/model-id"];
      } else {
        payload.model = selectedModel;
      }

      const res = await fetch(endpointUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok) {
        rememberEndpoint(getEffectiveBaseUrl());
        setMessage({ type: "success", text: data.message || "Settings applied successfully!" });
        await checkStatus();
      } else {
        setMessage({ type: "error", text: data.error?.message || "Failed to apply settings." });
      }
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    } finally {
      setApplying(false);
    }
  };

  const handleRestore = async () => {
    setRestoring(true);
    setMessage(null);
    try {
      const res = await fetch(endpointUrl, { method: "DELETE" });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: data.message || "Settings removed successfully." });
        await checkStatus();
      } else {
        setMessage({ type: "error", text: data.error?.message || "Failed to reset settings." });
      }
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    } finally {
      setRestoring(false);
    }
  };

  const handleSelectModel = (model) => {
    if (tool.id === "pi") {
      if (!selectedModels.includes(model.value)) {
        setSelectedModels((prev) => [...prev, model.value]);
      }
    } else {
      setSelectedModel(model.value);
    }
    setModalOpen(false);
  };

  const handleAddAllActiveModels = () => {
    const allModels = [];
    activeProviders.forEach((conn) => {
      const alias = PROVIDER_ID_TO_ALIAS[conn.provider] || conn.provider;
      const providerModels = getModelsByProviderId(conn.provider);
      providerModels.forEach((m) => {
        const val = `${alias}/${m.id}`;
        if (!allModels.includes(val)) allModels.push(val);
      });
    });
    if (allModels.length > 0) {
      setSelectedModels((prev) => Array.from(new Set([...prev, ...allModels])));
    }
  };

  const handleRemoveModel = (modelToRemove) => {
    setSelectedModels((prev) => prev.filter((m) => m !== modelToRemove));
  };

  const getInstallCommand = () => {
    switch (tool.id) {
      case "pi":
        return "curl -fsSL https://pi.dev/install.sh | sh  # or: npm install -g --ignore-scripts @earendil-works/pi-coding-agent";
      case "omp":
        return "npm install -g oh-my-pi";
      case "crush":
        return "brew install charmbracelet/tap/crush  # or go install github.com/charmbracelet/crush@latest";
      case "forge":
        return "cargo install forgecode";
      case "smelt":
        return "cargo install smelt";
      case "codewhale":
        return "cargo install codewhale";
      default:
        return `npm install -g ${tool.id}`;
    }
  };

  const getManualConfigContent = () => {
    const effectiveUrl = getEffectiveBaseUrl();
    const key = selectedApiKey || "sk_9router";
    const mod = selectedModel || "provider/model-id";

    switch (tool.id) {
      case "pi": {
        const modelsList = selectedModels.length > 0 ? selectedModels : [mod];
        return [
          {
            filename: "~/.pi/agent/models.json",
            content: JSON.stringify(
              {
                providers: {
                  "9router": {
                    baseUrl: effectiveUrl,
                    apiKey: key,
                    api: "openai-completions",
                    models: modelsList.map((id) => ({
                      id,
                      name: id,
                      contextWindow: 128000,
                      maxTokens: 16384,
                    })),
                  },
                },
              },
              null,
              2
            ),
          },
        ];
      }
      case "omp":
        return [
          {
            filename: "~/.omp/agent/models.yml",
            content: `providers:\n  9router:\n    baseUrl: ${effectiveUrl}\n    apiKey: ${key}\n    api: openai-completions\n    authHeader: true\n    disableStrictTools: true\n    discovery:\n      type: proxy`,
          },
        ];
      case "crush":
        return [
          {
            filename: "~/.config/crush/crush.json",
            content: JSON.stringify(
              {
                providers: {
                  "9router": {
                    type: "openai-compat",
                    base_url: effectiveUrl,
                    api_key: key,
                    models: [{ id: mod, name: mod, context_window: 128000 }],
                  },
                },
              },
              null,
              2
            ),
          },
        ];
      case "forge":
        return [
          {
            filename: "~/.forge/config.toml",
            content: `# Forge config — managed by 9Router\n\n[openai]\napi_key = "${key}"\nbase_url = "${effectiveUrl}"\nmodel = "${mod}"`,
          },
        ];
      case "smelt":
        return [
          {
            filename: "~/.smelt/config.json",
            content: JSON.stringify({ baseUrl: effectiveUrl, apiKey: key, model: mod, _managedBy: "9router" }, null, 2),
          },
        ];
      case "codewhale":
        return [
          {
            filename: "~/.codewhale/config.toml",
            content: `# CodeWhale config — managed by 9Router\n\n[openai]\nbase_url = "${effectiveUrl}"\napi_key = "${key}"\nmodel = "${mod}"`,
          },
        ];
      default:
        return [];
    }
  };

  return (
    <Card padding="xs" className="overflow-hidden">
      {/* Header clickable */}
      <div className="flex items-start justify-between gap-3 hover:cursor-pointer sm:items-center" onClick={onToggle}>
        <div className="flex min-w-0 items-center gap-3">
          <div className="size-8 flex items-center justify-center shrink-0">
            {tool.image ? (
              <Image
                src={tool.image}
                alt={tool.name}
                width={32}
                height={32}
                className="size-8 object-contain rounded-lg"
                sizes="32px"
                onError={(e) => { e.target.style.display = "none"; }}
                loading="lazy"
                decoding="async"
              />
            ) : tool.icon ? (
              <span className="material-symbols-outlined text-[28px]" style={{ color: tool.color }}>
                {tool.icon}
              </span>
            ) : (
              <span className="material-symbols-outlined text-[28px] text-primary">terminal</span>
            )}
          </div>
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h3 className="font-medium text-sm">{tool.name}</h3>
              {configStatus === "configured" && (
                <span className="px-1.5 py-0.5 text-[10px] font-medium bg-green-500/10 text-green-600 dark:text-green-400 rounded-full">
                  Connected
                </span>
              )}
              {configStatus === "not_configured" && (
                <span className="px-1.5 py-0.5 text-[10px] font-medium bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 rounded-full">
                  Not configured
                </span>
              )}
              {configStatus === "other" && (
                <span className="px-1.5 py-0.5 text-[10px] font-medium bg-blue-500/10 text-blue-600 dark:text-blue-400 rounded-full">
                  Other
                </span>
              )}
            </div>
            <p className="text-xs text-text-muted truncate">{tool.description}</p>
          </div>
        </div>
        <span className={`material-symbols-outlined text-text-muted text-[20px] transition-transform ${isExpanded ? "rotate-180" : ""}`}>
          expand_more
        </span>
      </div>

      {isExpanded && (
        <div className="mt-4 pt-4 border-t border-border flex flex-col gap-4">
          {checking && (
            <div className="flex items-center gap-2 text-text-muted">
              <span className="material-symbols-outlined animate-spin">progress_activity</span>
              <span>Checking {tool.name}...</span>
            </div>
          )}

          {!checking && status && !status.installed && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-3 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                <div className="flex items-start gap-3">
                  <span className="material-symbols-outlined text-yellow-500">warning</span>
                  <div className="flex-1">
                    <p className="font-medium text-yellow-600 dark:text-yellow-400">{tool.name} not detected locally</p>
                    <p className="text-sm text-text-muted">Manual configuration is still available if 9router is deployed on a remote server.</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 pl-9">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setShowManualConfigModal(true)}
                    className="!bg-yellow-500/20 !border-yellow-500/40 !text-yellow-700 dark:!text-yellow-300 hover:!bg-yellow-500/30"
                  >
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
                      <p className="text-text-muted mb-1">Install command:</p>
                      <code className="block px-3 py-2 bg-black/5 dark:bg-white/5 rounded font-mono text-xs">{getInstallCommand()}</code>
                    </div>
                    {tool.docsUrl && (
                      <p className="text-xs text-text-muted">
                        Docs: <a href={tool.docsUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline">{tool.docsUrl}</a>
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {!checking && status?.installed && (
            <>
              <div className="flex flex-col gap-2">
                {/* Endpoint (selector) */}
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr] sm:items-center sm:gap-2">
                  <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">Select Endpoint</span>
                  <span className="material-symbols-outlined hidden text-text-muted text-[14px] sm:inline">arrow_forward</span>
                  <BaseUrlSelect
                    value={customBaseUrl || getEffectiveBaseUrl()}
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
                {currentBaseUrl ? (
                  <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
                    <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">Current</span>
                    <span className="material-symbols-outlined hidden text-text-muted text-[14px] sm:inline">arrow_forward</span>
                    <span className="min-w-0 truncate rounded bg-surface/40 px-2 py-2 text-xs text-text-muted sm:py-1.5">
                      {currentBaseUrl}
                    </span>
                  </div>
                ) : null}

                {/* API Key */}
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
                  <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">API Key</span>
                  <span className="material-symbols-outlined hidden text-text-muted text-[14px] sm:inline">arrow_forward</span>
                  <ApiKeySelect value={selectedApiKey} onChange={setSelectedApiKey} apiKeys={apiKeys} cloudEnabled={cloudEnabled} />
                </div>

                {/* Models selector cho Pi (multi-models) */}
                {tool.id === "pi" && (
                  <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr] sm:items-start sm:gap-2">
                    <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm mt-1">Models</span>
                    <span className="material-symbols-outlined hidden text-text-muted text-[14px] sm:inline mt-1.5">arrow_forward</span>
                    <div className="flex-1 flex flex-col gap-2">
                      <div className="flex flex-wrap gap-1.5 min-h-[36px] p-2 bg-surface rounded border border-border">
                        {selectedModels.length === 0 ? (
                          <span className="text-xs text-text-muted italic">No models selected. Add models to use in Pi.</span>
                        ) : (
                          selectedModels.map((modelId) => (
                            <span
                              key={modelId}
                              className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-bg-secondary text-xs text-text-main border border-border"
                            >
                              <span>{modelId}</span>
                              <button
                                type="button"
                                onClick={() => handleRemoveModel(modelId)}
                                className="text-text-muted hover:text-red-500 rounded p-0.5"
                              >
                                <span className="material-symbols-outlined text-[12px]">close</span>
                              </button>
                            </span>
                          ))
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          onClick={() => setModalOpen(true)}
                          disabled={!activeProviders?.length}
                        >
                          <span className="material-symbols-outlined text-[14px] mr-1">add</span>
                          Add Model
                        </Button>
                        {activeProviders?.length > 0 && (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={handleAddAllActiveModels}
                            className="text-xs text-primary hover:text-primary-hover"
                          >
                            + Add All Active Models
                          </Button>
                        )}
                        {selectedModels.length > 0 && (
                          <button
                            type="button"
                            onClick={() => setSelectedModels([])}
                            className="text-xs text-text-muted hover:text-red-500 ml-auto"
                          >
                            Clear all
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Model (1 model cho các tool khác, trừ omp) */}
                {tool.id !== "omp" && tool.id !== "pi" && (
                  <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
                    <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">Model</span>
                    <span className="material-symbols-outlined hidden text-text-muted text-[14px] sm:inline">arrow_forward</span>
                    <div className="relative w-full min-w-0">
                      <input
                        type="text"
                        value={selectedModel}
                        onChange={(e) => setSelectedModel(e.target.value)}
                        placeholder="provider/model-id"
                        className="w-full min-w-0 pl-2 pr-7 py-2 bg-surface rounded border border-border text-xs focus:outline-none focus:ring-1 focus:ring-primary/50 sm:py-1.5"
                      />
                      {selectedModel && (
                        <button
                          onClick={() => setSelectedModel("")}
                          className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 text-text-muted hover:text-red-500 rounded transition-colors"
                          title="Clear"
                        >
                          <span className="material-symbols-outlined text-[14px]">close</span>
                        </button>
                      )}
                    </div>
                    <button
                      onClick={() => setModalOpen(true)}
                      disabled={!activeProviders?.length}
                      className={`w-full sm:w-auto rounded border px-2 py-2 text-xs transition-colors sm:py-1.5 whitespace-nowrap sm:shrink-0 ${
                        activeProviders?.length
                          ? "bg-surface border-border text-text-main hover:border-primary cursor-pointer"
                          : "opacity-50 cursor-not-allowed border-border"
                      }`}
                    >
                      Select Model
                    </button>
                  </div>
                )}
              </div>

              {/* Messages */}
              {message && (
                <div
                  className={`p-3 rounded-lg text-sm ${
                    message.type === "success"
                      ? "bg-green-500/10 text-green-600 dark:text-green-400 border border-green-500/20"
                      : "bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20"
                  }`}
                >
                  {message.text}
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                <div className="flex items-center gap-2">
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={handleApply}
                    disabled={applying || checking}
                  >
                    {applying ? "Applying..." : "Apply Settings"}
                  </Button>
                  {status?.has9Router && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleRestore}
                      disabled={restoring || checking}
                      className="text-red-500 hover:text-red-600 hover:border-red-500/50"
                    >
                      {restoring ? "Removing..." : "Remove from Tool"}
                    </Button>
                  )}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowManualConfigModal(true)}
                >
                  <span className="material-symbols-outlined text-[18px] mr-1">code</span>
                  Manual Config
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      <ModelSelectModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onSelect={handleSelectModel}
        activeProviders={activeProviders}
      />

      <ManualConfigModal
        isOpen={showManualConfigModal}
        onClose={() => setShowManualConfigModal(false)}
        title={`${tool.name} Configuration`}
        configs={getManualConfigContent()}
      />
    </Card>
  );
}
