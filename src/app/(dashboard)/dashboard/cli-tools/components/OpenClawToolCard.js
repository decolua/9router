"use client";

import { useState, useEffect, useRef } from "react";
import { Card, Button, ModelSelectModal, ManualConfigModal } from "@/shared/components";
import Image from "next/image";
import { useTranslations } from "next-intl";

export default function OpenClawToolCard({
  tool,
  isExpanded,
  onToggle,
  baseUrl,
  hasActiveProviders,
  apiKeys,
  activeProviders,
  cloudEnabled,
}) {
  const t = useTranslations();
  const [openclawStatus, setOpenclawStatus] = useState(null);
  const [checkingOpenclaw, setCheckingOpenclaw] = useState(false);
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
    if (!openclawStatus?.installed) return null;
    const currentProvider = openclawStatus.settings?.models?.providers?.["9router"];
    if (!currentProvider) return "not_configured";
    const localMatch = currentProvider.baseUrl?.includes("localhost") || currentProvider.baseUrl?.includes("127.0.0.1") || currentProvider.baseUrl?.includes("0.0.0.0");
    if (localMatch) return "configured";
    return "other";
  };

  const configStatus = getConfigStatus();

  useEffect(() => {
    if (apiKeys?.length > 0 && !selectedApiKey) {
      setSelectedApiKey(apiKeys[0].key);
    }
  }, [apiKeys, selectedApiKey]);

  useEffect(() => {
    if (isExpanded && !openclawStatus) {
      checkOpenclawStatus();
      fetchModelAliases();
    }
  }, [isExpanded, openclawStatus]);

  const fetchModelAliases = async () => {
    try {
      const res = await fetch("/api/models/alias");
      const data = await res.json();
      if (res.ok) setModelAliases(data.aliases || {});
    } catch (error) {
      console.log("Error fetching model aliases:", error);
    }
  };

  useEffect(() => {
    if (openclawStatus?.installed && !hasInitializedModel.current) {
      hasInitializedModel.current = true;
      const provider = openclawStatus.settings?.models?.providers?.["9router"];
      if (provider) {
        const primaryModel = openclawStatus.settings?.agents?.defaults?.model?.primary;
        if (primaryModel) {
          const modelId = primaryModel.replace("9router/", "");
          setSelectedModel(modelId);
        }
        if (provider.apiKey && apiKeys?.some(k => k.key === provider.apiKey)) {
          setSelectedApiKey(provider.apiKey);
        }
      }
    }
  }, [openclawStatus, apiKeys]);

  const checkOpenclawStatus = async () => {
    setCheckingOpenclaw(true);
    try {
      const res = await fetch("/api/cli-tools/openclaw-settings");
      const data = await res.json();
      setOpenclawStatus(data);
    } catch (error) {
      setOpenclawStatus({ installed: false, error: error.message });
    } finally {
      setCheckingOpenclaw(false);
    }
  };

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
        || (apiKeys?.length > 0 ? apiKeys[0].key : null)
        || (!cloudEnabled ? t("cliTools.common.apiKeyDefault") : null);

      const res = await fetch("/api/cli-tools/openclaw-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          baseUrl: getEffectiveBaseUrl(), 
          apiKey: keyToUse,
          model: selectedModel 
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: t("cliTools.openclaw.messages.applySuccess") });
        checkOpenclawStatus();
      } else {
        setMessage({ type: "error", text: data.error || t("cliTools.openclaw.messages.applyFailed") });
      }
    } catch (error) {
      setMessage({ type: "error", text: error.message || t("cliTools.openclaw.messages.applyFailed") });
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
        setMessage({ type: "success", text: t("cliTools.openclaw.messages.resetSuccess") });
        setSelectedModel("");
        setSelectedApiKey("");
        checkOpenclawStatus();
      } else {
        setMessage({ type: "error", text: data.error || t("cliTools.openclaw.messages.resetFailed") });
      }
    } catch (error) {
      setMessage({ type: "error", text: error.message || t("cliTools.openclaw.messages.resetFailed") });
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
      : (!cloudEnabled ? t("cliTools.common.apiKeyDefault") : t("cliTools.openclaw.placeholders.apiKey"));

    const settingsContent = {
      agents: {
        defaults: {
          model: {
            primary: `9router/${selectedModel || t("cliTools.openclaw.placeholders.model")}`,
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
                id: selectedModel || t("cliTools.openclaw.placeholders.model"),
                name: (selectedModel || t("cliTools.openclaw.placeholders.model")).split("/").pop(),
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
    <Card padding="sm" className="overflow-hidden">
      <div className="flex items-center justify-between hover:cursor-pointer" onClick={onToggle}>
        <div className="flex items-center gap-3">
          <div className="size-8 flex items-center justify-center shrink-0">
            <Image src="/providers/openclaw.png" alt={t(tool.name)} width={32} height={32} className="size-8 object-contain rounded-lg" sizes="32px" onError={(e) => { e.target.style.display = "none"; }} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="font-medium text-sm">{t(tool.name)}</h3>
              {configStatus === "configured" && <span className="px-1.5 py-0.5 text-[10px] font-medium bg-green-500/10 text-green-600 dark:text-green-400 rounded-full">{t("cliTools.status.connected")}</span>}
              {configStatus === "not_configured" && <span className="px-1.5 py-0.5 text-[10px] font-medium bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 rounded-full">{t("cliTools.status.notConfigured")}</span>}
              {configStatus === "other" && <span className="px-1.5 py-0.5 text-[10px] font-medium bg-blue-500/10 text-blue-600 dark:text-blue-400 rounded-full">{t("cliTools.status.other")}</span>}
            </div>
            <p className="text-xs text-text-muted truncate">{t(tool.description)}</p>
          </div>
        </div>
        <span className={`material-symbols-outlined text-text-muted text-[20px] transition-transform ${isExpanded ? "rotate-180" : ""}`}>expand_more</span>
      </div>

      {isExpanded && (
        <div className="mt-4 pt-4 border-t border-border flex flex-col gap-4">
          {checkingOpenclaw && (
            <div className="flex items-center gap-2 text-text-muted">
              <span className="material-symbols-outlined animate-spin">progress_activity</span>
              <span>{t("cliTools.openclaw.status.checking")}</span>
            </div>
          )}

          {!checkingOpenclaw && openclawStatus && !openclawStatus.installed && (
            <div className="flex items-center gap-3 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
              <span className="material-symbols-outlined text-yellow-500">warning</span>
              <div className="flex-1">
                <p className="font-medium text-yellow-600 dark:text-yellow-400">{t("cliTools.openclaw.install.title")}</p>
                <p className="text-sm text-text-muted">{t("cliTools.openclaw.install.subtitle")}</p>
              </div>
            </div>
          )}

          {!checkingOpenclaw && openclawStatus?.installed && (
            <>
              <div className="flex flex-col gap-2">
                {/* Current Base URL */}
                {openclawStatus?.settings?.models?.providers?.["9router"]?.baseUrl && (
                  <div className="flex items-center gap-2">
                    <span className="w-32 shrink-0 text-sm font-semibold text-text-main text-right">{t("cliTools.fields.current")}</span>
                    <span className="material-symbols-outlined text-text-muted text-[14px]">arrow_forward</span>
                    <span className="flex-1 px-2 py-1.5 text-xs text-text-muted truncate">
                      {openclawStatus.settings.models.providers["9router"].baseUrl}
                    </span>
                  </div>
                )}

                {/* Base URL */}
                <div className="flex items-center gap-2">
                  <span className="w-32 shrink-0 text-sm font-semibold text-text-main text-right">{t("cliTools.fields.baseUrl")}</span>
                  <span className="material-symbols-outlined text-text-muted text-[14px]">arrow_forward</span>
                  <input 
                    type="text" 
                    value={getDisplayUrl()} 
                    onChange={(e) => setCustomBaseUrl(e.target.value)} 
                    placeholder={t("cliTools.fields.baseUrlPlaceholderV1")} 
                    className="flex-1 px-2 py-1.5 bg-surface rounded border border-border text-xs focus:outline-none focus:ring-1 focus:ring-primary/50" 
                  />
                  {customBaseUrl && customBaseUrl !== baseUrl && (
                    <button onClick={() => setCustomBaseUrl("")} className="p-1 text-text-muted hover:text-primary rounded transition-colors" title={t("cliTools.actions.resetToDefault")}>
                      <span className="material-symbols-outlined text-[14px]">restart_alt</span>
                    </button>
                  )}
                </div>

                {/* API Key */}
                <div className="flex items-center gap-2">
                  <span className="w-32 shrink-0 text-sm font-semibold text-text-main text-right">{t("cliTools.fields.apiKey")}</span>
                  <span className="material-symbols-outlined text-text-muted text-[14px]">arrow_forward</span>
                  {apiKeys.length > 0 ? (
                    <select value={selectedApiKey} onChange={(e) => setSelectedApiKey(e.target.value)} className="flex-1 px-2 py-1.5 bg-surface rounded text-xs border border-border focus:outline-none focus:ring-1 focus:ring-primary/50">
                      {apiKeys.map((key) => <option key={key.id} value={key.key}>{key.key}</option>)}
                    </select>
                  ) : (
                    <span className="flex-1 text-xs text-text-muted px-2 py-1.5">
                      {cloudEnabled ? t("cliTools.common.noApiKeysCloud") : t("cliTools.common.apiKeyDefaultFull")}
                    </span>
                  )}
                </div>

                {/* Model */}
                <div className="flex items-center gap-2">
                  <span className="w-32 shrink-0 text-sm font-semibold text-text-main text-right">{t("cliTools.fields.model")}</span>
                  <span className="material-symbols-outlined text-text-muted text-[14px]">arrow_forward</span>
                  <input type="text" value={selectedModel} onChange={(e) => setSelectedModel(e.target.value)} placeholder={t("cliTools.fields.modelPlaceholder")} className="flex-1 px-2 py-1.5 bg-surface rounded border border-border text-xs focus:outline-none focus:ring-1 focus:ring-primary/50" />
                  <button onClick={() => setModalOpen(true)} disabled={!hasActiveProviders} className={`px-2 py-1.5 rounded border text-xs transition-colors shrink-0 whitespace-nowrap ${hasActiveProviders ? "bg-surface border-border text-text-main hover:border-primary cursor-pointer" : "opacity-50 cursor-not-allowed border-border"}`}>{t("cliTools.actions.selectModel")}</button>
                  {selectedModel && <button onClick={() => setSelectedModel("")} className="p-1 text-text-muted hover:text-red-500 rounded transition-colors" title={t("common.clear")}><span className="material-symbols-outlined text-[14px]">close</span></button>}
                </div>
              </div>

              {message && (
                <div className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs ${message.type === "success" ? "bg-green-500/10 text-green-600" : "bg-red-500/10 text-red-600"}`}>
                  <span className="material-symbols-outlined text-[14px]">{message.type === "success" ? "check_circle" : "error"}</span>
                  <span>{message.text}</span>
                </div>
              )}

              <div className="flex items-center gap-2">
                <Button variant="primary" size="sm" onClick={handleApplySettings} disabled={!selectedModel} loading={applying}>
                  <span className="material-symbols-outlined text-[14px] mr-1">save</span>{t("cliTools.actions.apply")}
                </Button>
                <Button variant="outline" size="sm" onClick={handleResetSettings} disabled={!openclawStatus?.has9Router} loading={restoring}>
                  <span className="material-symbols-outlined text-[14px] mr-1">restore</span>{t("cliTools.actions.reset")}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setShowManualConfigModal(true)}>
                  <span className="material-symbols-outlined text-[14px] mr-1">content_copy</span>{t("cliTools.actions.manualConfig")}
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
        title={t("cliTools.openclaw.selectModelTitle")}
      />

      <ManualConfigModal
        isOpen={showManualConfigModal}
        onClose={() => setShowManualConfigModal(false)}
        title={t("cliTools.openclaw.manualConfigTitle")}
        configs={getManualConfigs()}
      />
    </Card>
  );
}
