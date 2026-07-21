"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Card, Button, ModelSelectModal, ManualConfigModal } from "@/shared/components";
import { useModelCaps } from "@/shared/hooks/useModelCaps";
import Image from "next/image";
import BaseUrlSelect from "./BaseUrlSelect";
import ApiKeySelect from "./ApiKeySelect";
import { matchKnownEndpoint } from "./cliEndpointMatch";

const ENDPOINT = "/api/cli-tools/grok-build-settings";
const MODEL_SLOT = "9router";
const SUBAGENT_TYPES = [
  { id: "general-purpose", label: "General-purpose", help: "Implementation, testing, and full-capability delegated tasks" },
  { id: "explore", label: "Explore", help: "Read-only codebase research and investigation" },
  { id: "plan", label: "Plan", help: "Architecture and implementation planning" },
];

function ModelField({ label, value, placeholder, onChange, onSelect, disabled, help }) {
  return (
    <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
      <div className="sm:text-right">
        <span className="text-xs font-semibold text-text-main sm:text-sm">{label}</span>
        {help && <p className="mt-0.5 text-[10px] leading-tight text-text-muted">{help}</p>}
      </div>
      <span className="material-symbols-outlined hidden text-text-muted text-[14px] sm:inline">arrow_forward</span>
      <div className="relative w-full min-w-0">
        <input
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          className="w-full min-w-0 pl-2 pr-7 py-2 bg-surface rounded border border-border text-xs focus:outline-none focus:ring-1 focus:ring-primary/50 sm:py-1.5"
        />
        {value && (
          <button
            type="button"
            onClick={() => onChange("")}
            className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 text-text-muted hover:text-red-500 rounded transition-colors"
            title="Clear (inherit main model for subagents)"
          >
            <span className="material-symbols-outlined text-[14px]">close</span>
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={onSelect}
        disabled={disabled}
        className={`w-full sm:w-auto rounded border px-2 py-2 text-xs transition-colors sm:py-1.5 whitespace-nowrap sm:shrink-0 ${
          !disabled
            ? "bg-surface border-border text-text-main hover:border-primary cursor-pointer"
            : "opacity-50 cursor-not-allowed border-border"
        }`}
      >
        Select
      </button>
    </div>
  );
}

export default function GrokBuildToolCard({
  tool,
  isExpanded,
  onToggle,
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
  const { getCaps } = useModelCaps();
  const getContextWindow = (model) => getCaps(model)?.contextWindow || null;
  const initialModel = initialStatus?.settings?.model?.model || "";
  const initialSubagents = Object.fromEntries(
    SUBAGENT_TYPES
      .map((type) => [type.id, initialStatus?.settings?.subagentModels?.[type.id]?.model])
      .filter(([, model]) => Boolean(model)),
  );
  const [grokStatus, setGrokStatus] = useState(initialStatus || null);
  const [checking, setChecking] = useState(false);
  const [applying, setApplying] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [message, setMessage] = useState(null);
  const [selectedApiKey, setSelectedApiKey] = useState(apiKeys?.[0]?.key || "");
  const [selectedModel, setSelectedModel] = useState(initialModel);
  const [subagentModels, setSubagentModels] = useState(initialSubagents);
  const [modelTarget, setModelTarget] = useState(null); // "main" or subagent type
  const [modelAliases, setModelAliases] = useState({});
  const [showManualConfigModal, setShowManualConfigModal] = useState(false);
  const [customBaseUrl, setCustomBaseUrl] = useState("");
  const hasFetchedStatus = useRef(Boolean(initialStatus));

  const configuredModel = grokStatus?.settings?.model;
  const configStatus = !grokStatus?.installed
    ? null
    : !configuredModel?.base_url
      ? "not_configured"
      : matchKnownEndpoint(configuredModel.base_url, { tunnelPublicUrl, tailscaleUrl })
        ? "configured"
        : "other";

  const hydrateForm = useCallback((status) => {
    const mainModel = status?.settings?.model?.model || "";
    const configuredSubagents = Object.fromEntries(
      SUBAGENT_TYPES
        .map((type) => [type.id, status?.settings?.subagentModels?.[type.id]?.model])
        .filter(([, model]) => Boolean(model)),
    );
    setSelectedModel(mainModel);
    setSubagentModels(configuredSubagents);
  }, []);

  const fetchModelAliases = useCallback(async () => {
    try {
      const res = await fetch("/api/models/alias");
      const data = await res.json();
      if (res.ok) setModelAliases(data.aliases || {});
    } catch (error) {
      console.log("Error fetching model aliases:", error);
    }
  }, []);

  const checkStatus = useCallback(async ({ hydrate = false } = {}) => {
    setChecking(true);
    try {
      const res = await fetch(ENDPOINT);
      const status = await res.json();
      setGrokStatus(status);
      hasFetchedStatus.current = true;
      if (hydrate) hydrateForm(status);
    } catch (error) {
      setGrokStatus({ installed: false, error: error.message });
    } finally {
      setChecking(false);
    }
  }, [hydrateForm]);

  useEffect(() => {
    if (!isExpanded) return;
    let cancelled = false;
    const synchronize = async () => {
      if (!hasFetchedStatus.current) await checkStatus({ hydrate: true });
      if (!cancelled) await fetchModelAliases();
    };
    synchronize();
    return () => { cancelled = true; };
  }, [isExpanded, checkStatus, fetchModelAliases]);

  const getEffectiveBaseUrl = () => {
    const url = customBaseUrl || (typeof window !== "undefined"
      ? window.location.origin.replace("://localhost", "://127.0.0.1")
      : "http://127.0.0.1:20128");
    return url.endsWith("/v1") ? url : `${url}/v1`;
  };

  const handleApply = async () => {
    setApplying(true);
    setMessage(null);
    try {
      const keyToUse = selectedApiKey?.trim()
        || (apiKeys?.length > 0 ? apiKeys[0].key : null)
        || (!cloudEnabled ? "sk_9router" : null);
      const mappedSubagents = {};
      for (const type of SUBAGENT_TYPES) {
        const model = subagentModels[type.id]?.trim();
        if (model) mappedSubagents[type.id] = { model, contextWindow: getContextWindow(model) };
      }

      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: getEffectiveBaseUrl(),
          apiKey: keyToUse,
          model: selectedModel,
          contextWindow: getContextWindow(selectedModel),
          subagentModels: mappedSubagents,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: "Main and subagent models applied successfully!" });
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
      const res = await fetch(ENDPOINT, { method: "DELETE" });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: "Settings reset successfully!" });
        setSelectedModel("");
        setSubagentModels({});
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

  const handleModelSelect = (model) => {
    if (modelTarget === "main") {
      setSelectedModel(model.value);
    } else if (modelTarget) {
      setSubagentModels((current) => ({ ...current, [modelTarget]: model.value }));
    }
    setModelTarget(null);
  };

  const getManualConfigs = () => {
    const keyToUse = selectedApiKey?.trim()
      || (!cloudEnabled ? "sk_9router" : "<API_KEY_FROM_DASHBOARD>");
    const baseUrl = getEffectiveBaseUrl();
    const mainModel = selectedModel || "provider/model-id";
    const blocks = [
      `[models]\ndefault = "${MODEL_SLOT}"`,
      `[model.${MODEL_SLOT}]\nmodel = "${mainModel}"\nbase_url = "${baseUrl}"\nname = "9Router"\ndescription = "Routed via 9Router gateway"\napi_backend = "chat_completions"\napi_key = "${keyToUse}"\ncontext_window = ${getContextWindow(mainModel) || 200000}`,
    ];
    const mappings = [];
    for (const type of SUBAGENT_TYPES) {
      const model = subagentModels[type.id]?.trim();
      if (!model) continue;
      const slot = `${MODEL_SLOT}-${type.id}`;
      mappings.push(`${type.id} = "${slot}"`);
      blocks.push(`[model.${slot}]\nmodel = "${model}"\nbase_url = "${baseUrl}"\nname = "9Router ${type.id}"\ndescription = "Routed via 9Router gateway"\napi_backend = "chat_completions"\napi_key = "${keyToUse}"\ncontext_window = ${getContextWindow(model) || 200000}`);
    }
    if (mappings.length) blocks.splice(1, 0, `[subagents.models]\n${mappings.join("\n")}`);
    return [{ filename: "~/.grok/config.toml", content: `${blocks.join("\n\n")}\n` }];
  };

  return (
    <Card padding="xs" className="overflow-hidden">
      <div className="flex items-start justify-between gap-3 hover:cursor-pointer sm:items-center" onClick={onToggle}>
        <div className="flex min-w-0 items-center gap-3">
          <div className="size-8 flex items-center justify-center shrink-0">
            <Image
              src={tool.image || "/providers/grok-cli.png"}
              alt={tool.name}
              width={32}
              height={32}
              className="size-8 object-contain rounded-lg"
              sizes="32px"
              onError={(e) => { e.target.style.display = "none"; }}
              loading="lazy"
              decoding="async"
            />
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
          {checking && <div className="flex items-center gap-2 text-text-muted"><span className="material-symbols-outlined animate-spin">progress_activity</span><span>Checking Grok Build...</span></div>}

          {!checking && grokStatus && !grokStatus.installed && (
            <div className="flex flex-col gap-3 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
              <div className="flex items-start gap-3">
                <span className="material-symbols-outlined text-yellow-500">warning</span>
                <div className="flex-1">
                  <p className="font-medium text-yellow-600 dark:text-yellow-400">Grok Build not detected locally</p>
                  <code className="block mt-2 p-2 bg-black/20 rounded text-xs font-mono">curl -fsSL https://x.ai/cli/install.sh | bash</code>
                </div>
              </div>
              <Button variant="secondary" size="sm" onClick={() => setShowManualConfigModal(true)} className="w-full sm:w-auto"><span className="material-symbols-outlined text-[18px] mr-1">content_copy</span>Manual Config</Button>
            </div>
          )}

          {!checking && grokStatus?.installed && (
            <>
              <div className="flex flex-col gap-2">
                {tool.notes?.length > 0 && (
                  <div className="mb-2 flex flex-col gap-2">
                    {tool.notes.map((note, index) => (
                      <div key={index} className={`flex items-start gap-2 rounded p-2 text-xs ${note.type === "warning" ? "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400" : "bg-blue-500/10 text-blue-600 dark:text-blue-400"}`}>
                        <span className="material-symbols-outlined mt-0.5 text-[14px]">{note.type === "warning" ? "warning" : "info"}</span>
                        <span>{note.text}</span>
                      </div>
                    ))}
                  </div>
                )}
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr] sm:items-center sm:gap-2">
                  <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">Select Endpoint</span>
                  <span className="material-symbols-outlined hidden text-text-muted text-[14px] sm:inline">arrow_forward</span>
                  <BaseUrlSelect value={customBaseUrl || getEffectiveBaseUrl()} onChange={setCustomBaseUrl} requiresExternalUrl={tool.requiresExternalUrl} tunnelEnabled={tunnelEnabled} tunnelPublicUrl={tunnelPublicUrl} tailscaleEnabled={tailscaleEnabled} tailscaleUrl={tailscaleUrl} />
                </div>

                {configuredModel?.base_url && (
                  <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr] sm:items-center sm:gap-2">
                    <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">Current</span>
                    <span className="material-symbols-outlined hidden text-text-muted text-[14px] sm:inline">arrow_forward</span>
                    <span className="min-w-0 truncate rounded bg-surface/40 px-2 py-2 text-xs text-text-muted sm:py-1.5">{configuredModel.base_url} · {configuredModel.model}{configuredModel.context_window ? ` · ${(configuredModel.context_window / 1000).toLocaleString()}K ctx` : ""}</span>
                  </div>
                )}

                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr] sm:items-center sm:gap-2">
                  <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">API Key</span>
                  <span className="material-symbols-outlined hidden text-text-muted text-[14px] sm:inline">arrow_forward</span>
                  <ApiKeySelect value={selectedApiKey} onChange={setSelectedApiKey} apiKeys={apiKeys} cloudEnabled={cloudEnabled} />
                </div>

                <ModelField label="Main Model" value={selectedModel} onChange={setSelectedModel} placeholder="provider/model-id" onSelect={() => setModelTarget("main")} disabled={!hasActiveProviders} />

                <div className="my-1 border-t border-border pt-3">
                  <div className="mb-2 flex items-start gap-2">
                    <span className="material-symbols-outlined text-primary text-[16px]">account_tree</span>
                    <div>
                      <p className="text-xs font-semibold text-text-main">Subagent model overrides</p>
                      <p className="text-[10px] text-text-muted">Leave blank to inherit Main Model. Each override keeps its own context window.</p>
                    </div>
                  </div>
                </div>

                {SUBAGENT_TYPES.map((type) => (
                  <ModelField
                    key={type.id}
                    label={type.label}
                    help={type.help}
                    value={subagentModels[type.id] || ""}
                    onChange={(value) => setSubagentModels((current) => ({ ...current, [type.id]: value }))}
                    placeholder={`${selectedModel || "Main Model"} (inherit)`}
                    onSelect={() => setModelTarget(type.id)}
                    disabled={!hasActiveProviders}
                  />
                ))}
              </div>

              {message && <div className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs ${message.type === "success" ? "bg-green-500/10 text-green-600" : "bg-red-500/10 text-red-600"}`}><span className="material-symbols-outlined text-[14px]">{message.type === "success" ? "check_circle" : "error"}</span><span>{message.text}</span></div>}

              <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                <Button variant="primary" size="sm" onClick={handleApply} disabled={!selectedModel} loading={applying} className="w-full sm:w-auto"><span className="material-symbols-outlined text-[14px] mr-1">save</span>Apply</Button>
                <Button variant="outline" size="sm" onClick={handleReset} disabled={!grokStatus?.has9Router} loading={restoring} className="w-full sm:w-auto"><span className="material-symbols-outlined text-[14px] mr-1">restore</span>Reset</Button>
                <Button variant="ghost" size="sm" onClick={() => setShowManualConfigModal(true)} className="w-full sm:w-auto"><span className="material-symbols-outlined text-[14px] mr-1">content_copy</span>Manual Config</Button>
              </div>
            </>
          )}
        </div>
      )}

      {modelTarget && (
        <ModelSelectModal
          isOpen={Boolean(modelTarget)}
          onClose={() => setModelTarget(null)}
          onSelect={handleModelSelect}
          selectedModel={modelTarget === "main" ? selectedModel : subagentModels[modelTarget] || ""}
          activeProviders={activeProviders}
          modelAliases={modelAliases}
          title={modelTarget === "main" ? "Select Main Model for Grok Build" : `Select ${SUBAGENT_TYPES.find((type) => type.id === modelTarget)?.label || "Subagent"} Model`}
        />
      )}

      <ManualConfigModal isOpen={showManualConfigModal} onClose={() => setShowManualConfigModal(false)} title="Grok Build - Manual Configuration" configs={getManualConfigs()} />
    </Card>
  );
}
