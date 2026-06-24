"use client";

import { useState, useEffect, useRef } from "react";
import type { ComponentType, ReactNode } from "react";
import React from "react";
import {
  Card as _Card,
  Button as _Button,
  ModelSelectModal as _ModelSelectModal,
  ManualConfigModal as _ManualConfigModal,
} from "@/shared/components";
import Image from "next/image";
import BaseUrlSelect from "./BaseUrlSelect";
import _ApiKeySelect from "./ApiKeySelect";
import { matchKnownEndpoint } from "./cliEndpointMatch";
import type { JsonValue } from "open-sse/types/executor.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const recOf = (v: JsonValue | undefined) =>
  (v !== null && v !== undefined && typeof v === "object" && !Array.isArray(v))
    ? (v as Record<string, JsonValue>)
    : ({} as Record<string, JsonValue>);
const arrOf = (v: JsonValue | undefined) =>
  Array.isArray(v) ? (v as JsonValue[]) : ([] as JsonValue[]);
const strOf = (v: JsonValue | undefined) =>
  typeof v === "string" ? v : "";
const boolOf = (v: JsonValue | undefined) => v === true;

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------
interface CustomModel {
  id?: string;
  model?: string;
  index?: number;
  baseUrl?: string;
  apiKey?: string;
  displayName?: string;
  maxOutputTokens?: number;
  noImageSupport?: boolean;
  provider?: string;
}

interface DroidSettings {
  customModels?: CustomModel[];
}

interface DroidStatus {
  installed: boolean;
  error?: string;
  has9Router?: boolean;
  settings?: DroidSettings;
}

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------
const parseCustomModel = (v: JsonValue): CustomModel => {
  const r = recOf(v);
  return {
    ...(strOf(r["id"]) ? { id: strOf(r["id"]) } : {}),
    ...(strOf(r["model"]) ? { model: strOf(r["model"]) } : {}),
    ...(typeof r["index"] === "number" ? { index: r["index"] as number } : {}),
    ...(strOf(r["baseUrl"]) ? { baseUrl: strOf(r["baseUrl"]) } : {}),
    ...(strOf(r["apiKey"]) ? { apiKey: strOf(r["apiKey"]) } : {}),
    ...(strOf(r["displayName"]) ? { displayName: strOf(r["displayName"]) } : {}),
    ...(typeof r["maxOutputTokens"] === "number" ? { maxOutputTokens: r["maxOutputTokens"] as number } : {}),
    ...(typeof r["noImageSupport"] === "boolean" ? { noImageSupport: r["noImageSupport"] as boolean } : {}),
    ...(strOf(r["provider"]) ? { provider: strOf(r["provider"]) } : {}),
  };
};

const parseDroidStatus = (v: JsonValue): DroidStatus => {
  const r = recOf(v);
  const settingsR = recOf(r["settings"]);
  const customModels = arrOf(settingsR["customModels"]).map(parseCustomModel);
  return {
    installed: boolOf(r["installed"]),
    ...(strOf(r["error"]) ? { error: strOf(r["error"]) } : {}),
    ...(boolOf(r["has9Router"]) ? { has9Router: true } : {}),
    settings: { customModels },
  };
};

// ---------------------------------------------------------------------------
// Typed shims for JS shared components
// ---------------------------------------------------------------------------
interface CardProps { children?: ReactNode; title?: string; subtitle?: string; icon?: string; action?: ReactNode; padding?: string; hover?: boolean; elev?: boolean; className?: string; }
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> { variant?: string; size?: string; loading?: boolean; children?: ReactNode; }
interface ManualConfigEntry { filename: string; content: string; }
interface ManualConfigModalProps { isOpen?: boolean; onClose?: () => void; title?: string; configs?: ManualConfigEntry[]; }
interface ModelSelectModalProps { isOpen?: boolean; onClose?: () => void; onSelect?: (model: { value?: string; name?: string }) => void; selectedModel?: null; activeProviders?: JsonValue[] | undefined; modelAliases?: Record<string, string> | undefined; title?: string; }
interface ApiKeyEntry { key: string; name?: string; }
interface ApiKeySelectProps { value?: string | undefined; onChange?: (v: string) => void; apiKeys?: ApiKeyEntry[] | undefined; cloudEnabled?: boolean | undefined; }
interface BaseUrlSelectProps { value?: string | undefined; onChange?: (v: string) => void; requiresExternalUrl?: boolean | undefined; tunnelEnabled?: boolean | undefined; tunnelPublicUrl?: string | undefined; tailscaleEnabled?: boolean | undefined; tailscaleUrl?: string | undefined; }
interface MatchKnownEndpointOpts { tunnelPublicUrl?: string | null; tailscaleUrl?: string | null; cloudUrl?: string | null; }

const Card = _Card as ComponentType<CardProps>;
const Button = _Button as ComponentType<ButtonProps>;
const ModelSelectModal = _ModelSelectModal as ComponentType<ModelSelectModalProps>;
const ManualConfigModal = _ManualConfigModal as ComponentType<ManualConfigModalProps>;
const ApiKeySelect = _ApiKeySelect as ComponentType<ApiKeySelectProps>;
const BaseUrlSelectTyped = BaseUrlSelect as ComponentType<BaseUrlSelectProps>;
const matchKnownEndpointTyped = matchKnownEndpoint as (url: string, opts: MatchKnownEndpointOpts) => boolean;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
interface ToolInfo { name: string; description?: string; requiresExternalUrl?: boolean; }

interface DroidToolCardProps {
  tool: ToolInfo;
  isExpanded?: boolean;
  onToggle?: () => void;
  baseUrl?: string;
  hasActiveProviders?: boolean;
  apiKeys?: ApiKeyEntry[];
  activeProviders?: JsonValue[];
  cloudEnabled?: boolean;
  initialStatus?: JsonValue;
  tunnelEnabled?: boolean;
  tunnelPublicUrl?: string;
  tailscaleEnabled?: boolean;
  tailscaleUrl?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const CLOUD_URL = process.env.NEXT_PUBLIC_CLOUD_URL;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
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
}: DroidToolCardProps) {
  const [fetchedDroidStatus, setFetchedDroidStatus] = useState<DroidStatus | null>(null);
  const [applying, setApplying] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [userSelectedApiKey, setUserSelectedApiKey] = useState("");
  const [modelList, setModelList] = useState<string[]>([]);
  const [modelListResetByUser, setModelListResetByUser] = useState(false);
  const [modelInput, setModelInput] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [modelAliases, setModelAliases] = useState<Record<string, string>>({});
  const [showManualConfigModal, setShowManualConfigModal] = useState(false);
  const [showInstallGuide, setShowInstallGuide] = useState(false);
  const [customBaseUrl, setCustomBaseUrl] = useState("");
  const hasInitializedModel = useRef(false);

  const parsedInitialStatus: DroidStatus | null =
    initialStatus != null ? parseDroidStatus(initialStatus) : null;

  // Derived: local fetch/mutation result takes precedence over parent prop.
  const droidStatus: DroidStatus | null = fetchedDroidStatus ?? parsedInitialStatus ?? null;

  // Derived API key: explicit user selection > first available key > empty.
  const selectedApiKey = (userSelectedApiKey || apiKeys?.[0]?.key) ?? "";

  // Derived model list: explicit user edits > initialStatus config value (unless reset) > [].
  const initialFileModels =
    !modelListResetByUser && modelList.length === 0 && droidStatus?.installed
      ? (() => {
          const models = (droidStatus.settings?.customModels ?? [])
            .filter((m) => m.id?.startsWith("custom:9Router"))
            .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
            .map((m) => m.model)
            .filter((m): m is string => Boolean(m));
          if (models.length > 0) return models;
          const legacy = droidStatus.settings?.customModels?.find(
            (m) => m.id === "custom:9Router-0"
          );
          return legacy?.model ? [legacy.model] : [];
        })()
      : null;

  const effectiveModelList =
    modelList.length > 0 || modelListResetByUser ? modelList : (initialFileModels ?? []);

  const getConfigStatus = () => {
    if (!droidStatus?.installed) return null;
    const currentConfig = droidStatus.settings?.customModels?.find((m) =>
      m.id?.startsWith("custom:9Router")
    );
    if (!currentConfig) return "not_configured";
    return matchKnownEndpointTyped(currentConfig.baseUrl ?? "", {
      tunnelPublicUrl: tunnelPublicUrl ?? null,
      tailscaleUrl: tailscaleUrl ?? null,
      cloudUrl: cloudEnabled ? (CLOUD_URL ?? null) : null,
    })
      ? "configured"
      : "other";
  };

  const configStatus = getConfigStatus();

  const getEffectiveBaseUrl = () => {
    const url = customBaseUrl || (baseUrl ?? "");
    return url.endsWith("/v1") ? url : `${url}/v1`;
  };

  const getDisplayUrl = () => {
    const url = customBaseUrl || (baseUrl ?? "");
    return url.endsWith("/v1") ? url : `${url}/v1`;
  };

  const checkingDroid = isExpanded && !droidStatus;

  // Auto-check on expand
  useEffect(() => {
    if (isExpanded && !droidStatus) {
      fetch("/api/cli-tools/droid-settings")
        .then((r) => r.json() as Promise<JsonValue>)
        .then((data) => {
          const parsed = parseDroidStatus(data);
          setFetchedDroidStatus(parsed);
          if (!hasInitializedModel.current && parsed.installed) {
            hasInitializedModel.current = true;
            const models = (parsed.settings?.customModels ?? [])
              .filter((m) => m.id?.startsWith("custom:9Router"))
              .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
              .map((m) => m.model)
              .filter((m): m is string => Boolean(m));
            if (models.length > 0) {
              setModelList(models);
            } else {
              const legacy = parsed.settings?.customModels?.find(
                (m) => m.id === "custom:9Router-0"
              );
              if (legacy?.model) setModelList([legacy.model]);
            }
          }
        })
        .catch((err) => {
          const msg = err instanceof Error ? err.message : String(err);
          setFetchedDroidStatus({ installed: false, error: msg });
        });
    }
  }, [isExpanded, droidStatus]);

  // Alias fetch
  useEffect(() => {
    if (isExpanded) {
      fetch("/api/models/alias")
        .then((r) => r.json() as Promise<JsonValue>)
        .then((data) => {
          const raw = recOf(recOf(data)["aliases"]);
          const out: Record<string, string> = {};
          for (const k of Object.keys(raw)) {
            const s = strOf(raw[k]);
            if (s) out[k] = s;
          }
          setModelAliases(out);
        })
        .catch(() => {});
    }
  }, [isExpanded]);

  const refetchStatus = () => {
    fetch("/api/cli-tools/droid-settings")
      .then((r) => r.json() as Promise<JsonValue>)
      .then((data) => setFetchedDroidStatus(parseDroidStatus(data)))
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        setFetchedDroidStatus({ installed: false, error: msg });
      });
  };

  const addModel = () => {
    const val = modelInput.trim();
    if (!val || effectiveModelList.includes(val)) return;
    setModelListResetByUser(true);
    setModelList([...effectiveModelList, val]);
    setModelInput("");
  };

  const removeModel = (id: string) => {
    setModelListResetByUser(true);
    setModelList(effectiveModelList.filter((m) => m !== id));
  };

  const handleModelSelect = (model: { value?: string; name?: string }) => {
    if (!model.value || effectiveModelList.includes(model.value)) return;
    setModelListResetByUser(true);
    setModelList([...effectiveModelList, model.value]);
    setModalOpen(false);
  };

  const handleApplySettings = async () => {
    setApplying(true);
    setMessage(null);
    try {
      const keyToUse =
        selectedApiKey?.trim() ||
        (apiKeys && apiKeys.length > 0 ? (apiKeys[0]?.key ?? null) : null) ||
        (!cloudEnabled ? "sk_9router" : null);

      const res = await fetch("/api/cli-tools/droid-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: getEffectiveBaseUrl(),
          apiKey: keyToUse,
          models: effectiveModelList,
          activeModel: effectiveModelList[0] ?? "",
        }),
      });
      const data = (await res.json()) as JsonValue;
      if (res.ok) {
        setMessage({ type: "success", text: "Settings applied successfully!" });
        refetchStatus();
      } else {
        setMessage({
          type: "error",
          text: strOf(recOf(data)["error"]) || "Failed to apply settings",
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setMessage({ type: "error", text: msg });
    } finally {
      setApplying(false);
    }
  };

  const handleResetSettings = async () => {
    setRestoring(true);
    setMessage(null);
    try {
      const res = await fetch("/api/cli-tools/droid-settings", { method: "DELETE" });
      const data = (await res.json()) as JsonValue;
      if (res.ok) {
        setMessage({ type: "success", text: "Settings reset successfully!" });
        setModelListResetByUser(true);
        setModelList([]);
        refetchStatus();
      } else {
        setMessage({
          type: "error",
          text: strOf(recOf(data)["error"]) || "Failed to reset settings",
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setMessage({ type: "error", text: msg });
    } finally {
      setRestoring(false);
    }
  };

  const getManualConfigs = (): ManualConfigEntry[] => {
    const keyToUse =
      selectedApiKey && selectedApiKey.trim()
        ? selectedApiKey
        : !cloudEnabled
        ? "sk_9router"
        : "<API_KEY_FROM_DASHBOARD>";

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

    const platform = typeof navigator !== "undefined" ? navigator.platform : "";
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
      <div
        className="flex items-start justify-between gap-3 hover:cursor-pointer sm:items-center"
        onClick={onToggle}
      >
        <div className="flex min-w-0 items-center gap-3">
          <div className="size-8 flex items-center justify-center shrink-0">
            <Image
              src="/providers/droid.png"
              alt={tool.name}
              width={32}
              height={32}
              className="size-8 object-contain rounded-lg"
              sizes="32px"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
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
        <span
          className={`material-symbols-outlined text-text-muted text-[20px] transition-transform ${
            isExpanded ? "rotate-180" : ""
          }`}
        >
          expand_more
        </span>
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
                    <p className="font-medium text-yellow-600 dark:text-yellow-400">
                      Factory Droid CLI not detected locally
                    </p>
                    <p className="text-sm text-text-muted">
                      Manual configuration is still available if DurinDoor is deployed on a remote
                      server.
                    </p>
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
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowInstallGuide(!showInstallGuide)}
                  >
                    <span className="material-symbols-outlined text-[18px] mr-1">
                      {showInstallGuide ? "expand_less" : "help"}
                    </span>
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
                      <code className="block px-3 py-2 bg-black/5 dark:bg-white/5 rounded font-mono text-xs">
                        curl -fsSL https://app.factory.ai/cli | sh
                      </code>
                    </div>
                    <p className="text-text-muted">
                      After installation, run{" "}
                      <code className="px-1 bg-black/5 dark:bg-white/5 rounded">droid</code> to
                      verify.
                    </p>
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
                  <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">
                    Select Endpoint
                  </span>
                  <span className="material-symbols-outlined hidden text-text-muted text-[14px] sm:inline">
                    arrow_forward
                  </span>
                  <BaseUrlSelectTyped
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
                {droidStatus.settings?.customModels?.find((m) =>
                  m.id?.startsWith("custom:9Router")
                )?.baseUrl && (
                  <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
                    <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">
                      Current
                    </span>
                    <span className="material-symbols-outlined hidden text-text-muted text-[14px] sm:inline">
                      arrow_forward
                    </span>
                    <span className="min-w-0 truncate rounded bg-surface/40 px-2 py-2 text-xs text-text-muted sm:py-1.5">
                      {
                        droidStatus.settings.customModels!.find((m) =>
                          m.id?.startsWith("custom:9Router")
                        )!.baseUrl
                      }
                    </span>
                  </div>
                )}

                {/* API Key */}
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
                  <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">
                    API Key
                  </span>
                  <span className="material-symbols-outlined hidden text-text-muted text-[14px] sm:inline">
                    arrow_forward
                  </span>
                  <ApiKeySelect
                    value={selectedApiKey}
                    onChange={setUserSelectedApiKey}
                    apiKeys={apiKeys}
                    cloudEnabled={cloudEnabled}
                  />
                </div>

                {/* Models */}
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
                  <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">
                    Models{" "}
                    {effectiveModelList.length > 0 && (
                      <span className="text-primary">({effectiveModelList.length})</span>
                    )}
                  </span>
                  <span className="material-symbols-outlined hidden text-text-muted text-[14px] sm:inline">
                    arrow_forward
                  </span>
                  <div className="flex-1 flex flex-col gap-1">
                    {effectiveModelList.length > 0 && (
                      <div className="flex flex-col gap-0.5 mb-1">
                        {effectiveModelList.map((id) => (
                          <div
                            key={id}
                            className="flex items-center gap-1.5 px-2 py-1 bg-bg-secondary rounded border border-border"
                          >
                            <span className="flex-1 text-xs font-mono truncate">{id}</span>
                            <button
                              onClick={() => removeModel(id)}
                              className="text-text-muted hover:text-red-500 transition-colors shrink-0"
                              title="Remove"
                            >
                              <span className="material-symbols-outlined text-[12px]">close</span>
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="flex items-center gap-1.5">
                      <input
                        type="text"
                        value={modelInput}
                        onChange={(e) => setModelInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            addModel();
                          }
                        }}
                        placeholder="provider/model-id"
                        className="w-full min-w-0 px-2 py-2 bg-surface rounded border border-border text-xs focus:outline-none focus:ring-1 focus:ring-primary/50 sm:py-1.5"
                      />
                      <button
                        onClick={() => setModalOpen(true)}
                        disabled={!hasActiveProviders}
                        className={`px-2 py-1.5 rounded border text-xs shrink-0 ${
                          hasActiveProviders
                            ? "bg-surface border-border hover:border-primary cursor-pointer"
                            : "opacity-50 cursor-not-allowed border-border"
                        }`}
                      >
                        Select
                      </button>
                      <button
                        onClick={addModel}
                        disabled={!modelInput.trim()}
                        className="px-2 py-1.5 rounded border bg-surface border-border hover:border-primary text-xs shrink-0 disabled:opacity-50"
                        title="Add model"
                      >
                        <span className="material-symbols-outlined text-[14px]">add</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {message && (
                <div
                  className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs ${
                    message.type === "success"
                      ? "bg-green-500/10 text-green-600"
                      : "bg-red-500/10 text-red-600"
                  }`}
                >
                  <span className="material-symbols-outlined text-[14px]">
                    {message.type === "success" ? "check_circle" : "error"}
                  </span>
                  <span>{message.text}</span>
                </div>
              )}

              <div className="grid grid-cols-1 gap-2 sm:flex sm:items-center">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleApplySettings}
                  disabled={effectiveModelList.length === 0}
                  loading={applying}
                >
                  <span className="material-symbols-outlined text-[14px] mr-1">save</span>Apply
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleResetSettings}
                  disabled={!droidStatus.has9Router}
                  loading={restoring}
                >
                  <span className="material-symbols-outlined text-[14px] mr-1">restore</span>Reset
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowManualConfigModal(true)}
                >
                  <span className="material-symbols-outlined text-[14px] mr-1">content_copy</span>
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
