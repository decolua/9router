"use client";

import { useState, useEffect, useRef } from "react";
import { Card, Button, ModelSelectModal } from "@/shared/components";
import Image from "next/image";
import BaseUrlSelect from "./BaseUrlSelect";
import ApiKeySelect from "./ApiKeySelect";
import { matchKnownEndpoint } from "./cliEndpointMatch";

const ENDPOINT = "/api/cli-tools/deepseek-tui-settings";

export default function DeepSeekTuiToolCard({
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
    const [deepseekStatus, setDeepseekStatus] = useState(initialStatus || null);
    const [checking, setChecking] = useState(false);
    const [applying, setApplying] = useState(false);
    const [restoring, setRestoring] = useState(false);
    const [message, setMessage] = useState(null);
    const [selectedApiKey, setSelectedApiKey] = useState("");
    const [selectedModel, setSelectedModel] = useState("");
    const [modalOpen, setModalOpen] = useState(false);
    const [modelAliases, setModelAliases] = useState({});
    const [customBaseUrl, setCustomBaseUrl] = useState("");
    const hasInitializedModel = useRef(false);

    const getConfigStatus = () => {
        if (!deepseekStatus?.installed) return null;
        const cfg = deepseekStatus.settings;
        if (!cfg) return "not_configured";
        const openaiSection = cfg["providers.openai"];
        if (!openaiSection?.base_url) return "not_configured";
        if (matchKnownEndpoint(openaiSection.base_url, { tunnelPublicUrl, tailscaleUrl })) return "configured";
        return "other";
    };

    const configStatus = getConfigStatus();

    useEffect(() => {
        if (apiKeys?.length > 0 && !selectedApiKey) {
            setSelectedApiKey(apiKeys[0].key);
        }
    }, [apiKeys, selectedApiKey]);

    useEffect(() => {
        if (initialStatus) setDeepseekStatus(initialStatus);
    }, [initialStatus]);

    useEffect(() => {
        if (isExpanded && !deepseekStatus) {
            checkStatus();
            fetchModelAliases();
        }
        if (isExpanded) fetchModelAliases();
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

    useEffect(() => {
        if (deepseekStatus?.installed && !hasInitializedModel.current) {
            hasInitializedModel.current = true;
            const cfg = deepseekStatus.settings;
            const openaiSection = cfg?.["providers.openai"];
            if (openaiSection?.model) setSelectedModel(openaiSection.model);
        }
    }, [deepseekStatus]);

    const checkStatus = async () => {
        setChecking(true);
        try {
            const res = await fetch(ENDPOINT);
            const data = await res.json();
            setDeepseekStatus(data);
        } catch (error) {
            setDeepseekStatus({ installed: false, error: error.message });
        } finally {
            setChecking(false);
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

    const handleApply = async () => {
        setApplying(true);
        setMessage(null);
        try {
            const keyToUse = selectedApiKey?.trim()
                || (apiKeys?.length > 0 ? apiKeys[0].key : null)
                || (!cloudEnabled ? "sk_9router" : null);

            const res = await fetch(ENDPOINT, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    baseUrl: getEffectiveBaseUrl(),
                    apiKey: keyToUse,
                    model: selectedModel,
                }),
            });
            const data = await res.json();
            if (res.ok) {
                setMessage({ type: "success", text: "Settings applied successfully!" });
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
                setMessage({ type: "success", text: "Settings reset to defaults!" });
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

    const handleSelectModel = (model) => {
        setSelectedModel(model.value);
        setModalOpen(false);
    };

    const renderIcon = () => {
        if (tool.image) {
            return (
                <Image
                    src={tool.image}
                    alt={tool.name}
                    width={32}
                    height={32}
                    className="size-8 object-contain rounded-lg"
                    sizes="32px"
                    onError={(e) => { e.target.style.display = "none"; }}
                />
            );
        }
        if (tool.icon) {
            return <span className="material-symbols-outlined text-xl" style={{ color: tool.color }}>{tool.icon}</span>;
        }
        return (
            <Image
                src={`/providers/${tool.id}.png`}
                alt={tool.name}
                width={32}
                height={32}
                className="size-8 object-contain rounded-lg"
                sizes="32px"
                onError={(e) => { e.target.style.display = "none"; }}
            />
        );
    };

    const renderStatusBadge = () => {
        if (!deepseekStatus?.installed) {
            return (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20">
                    <span className="material-symbols-outlined text-sm">close</span>
                    Not Installed
                </span>
            );
        }
        if (configStatus === "configured") {
            return (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-green-500/10 text-green-600 dark:text-green-400 border border-green-500/20">
                    <span className="material-symbols-outlined text-sm">check_circle</span>
                    Configured
                </span>
            );
        }
        if (configStatus === "other") {
            return (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border border-yellow-500/20">
                    <span className="material-symbols-outlined text-sm">settings</span>
                    Other Config
                </span>
            );
        }
        return (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
                <span className="material-symbols-outlined text-sm">info</span>
                Not Configured
            </span>
        );
    };

    return (
        <Card padding="xs" className="overflow-hidden overflow-x-hidden">
            <div className="flex items-center justify-between hover:cursor-pointer" onClick={onToggle}>
                <div className="flex items-center gap-3">
                    <div className="size-8 rounded-lg flex items-center justify-center shrink-0">
                        {renderIcon()}
                    </div>
                    <div className="min-w-0">
                        <div className="flex items-center gap-2">
                            <h3 className="font-medium text-sm">{tool.name}</h3>
                            {renderStatusBadge()}
                        </div>
                        <p className="text-xs text-text-muted truncate">{tool.description}</p>
                    </div>
                </div>
                <span className={`material-symbols-outlined text-text-muted text-[20px] transition-transform ${isExpanded ? "rotate-180" : ""}`}>expand_more</span>
            </div>

            {isExpanded && (
                <div className="mt-6 pt-6 border-t border-border">
                    {/* Notes */}
                    {tool.notes && tool.notes.length > 0 && (
                        <div className="flex flex-col gap-2 mb-4">
                            {tool.notes.map((note, index) => {
                                const isWarning = note.type === "warning";
                                const isError = note.type === "error";
                                let bgClass = "bg-blue-500/10 border-blue-500/30";
                                let textClass = "text-blue-600 dark:text-blue-400";
                                let iconClass = "text-blue-500";
                                let icon = "info";

                                if (isWarning) {
                                    bgClass = "bg-yellow-500/10 border-yellow-500/30";
                                    textClass = "text-yellow-600 dark:text-yellow-400";
                                    iconClass = "text-yellow-500";
                                    icon = "warning";
                                } else if (isError) {
                                    bgClass = "bg-red-500/10 border-red-500/30";
                                    textClass = "text-red-600 dark:text-red-400";
                                    iconClass = "text-red-500";
                                    icon = "error";
                                }

                                return (
                                    <div key={index} className={`flex items-start gap-3 p-3 rounded-lg border ${bgClass}`}>
                                        <span className={`material-symbols-outlined text-lg ${iconClass}`}>{icon}</span>
                                        <p className={`text-sm ${textClass}`}>{note.text}</p>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {/* Install check */}
                    {!deepseekStatus?.installed && (
                        <div className="flex flex-col gap-3">
                            <p className="text-sm text-text-muted">DeepSeek TUI is not detected on your system.</p>
                            <div className="p-3 bg-bg-secondary rounded-lg border border-border">
                                <p className="text-xs text-text-muted mb-2">Install via npm:</p>
                                <code className="text-sm font-mono">npm install -g deepseek-tui</code>
                            </div>
                            <Button onClick={checkStatus} disabled={checking} variant="secondary" size="sm">
                                {checking ? "Checking..." : "Check Again"}
                            </Button>
                        </div>
                    )}

                    {/* Config section */}
                    {deepseekStatus?.installed && (
                        <div className="flex flex-col gap-4">
                            {/* Config path */}
                            <div className="flex items-center gap-2 text-xs text-text-muted">
                                <span className="material-symbols-outlined text-sm">folder</span>
                                <code className="px-2 py-0.5 bg-bg-secondary rounded text-xs font-mono">{deepseekStatus.configPath}</code>
                            </div>

                            {/* Base URL */}
                            <div>
                                <label className="text-xs font-medium text-text-muted mb-1 block">Base URL</label>
                                <BaseUrlSelect
                                    value={customBaseUrl}
                                    onChange={setCustomBaseUrl}
                                    baseUrl={baseUrl}
                                    tunnelEnabled={tunnelEnabled}
                                    tunnelPublicUrl={tunnelPublicUrl}
                                    tailscaleEnabled={tailscaleEnabled}
                                    tailscaleUrl={tailscaleUrl}
                                />
                            </div>

                            {/* API Key */}
                            <div>
                                <label className="text-xs font-medium text-text-muted mb-1 block">API Key</label>
                                <ApiKeySelect value={selectedApiKey} onChange={setSelectedApiKey} apiKeys={apiKeys} cloudEnabled={cloudEnabled} className="w-full" />
                            </div>

                            {/* Model */}
                            <div>
                                <label className="text-xs font-medium text-text-muted mb-1 block">Model</label>
                                <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                                    <input
                                        type="text"
                                        value={selectedModel}
                                        onChange={(e) => setSelectedModel(e.target.value)}
                                        placeholder="ollama/gpt-oss:120b"
                                        className="w-full sm:w-auto flex-1 px-3 py-2 bg-bg-secondary rounded-lg text-sm border border-border focus:outline-none focus:ring-1 focus:ring-primary/50"
                                    />
                                    <button
                                        onClick={() => setModalOpen(true)}
                                        disabled={!hasActiveProviders}
                                        className={`shrink-0 px-3 py-2 rounded-lg border text-sm transition-colors ${hasActiveProviders
                                                ? "bg-bg-secondary border-border text-text-main hover:border-primary cursor-pointer"
                                                : "opacity-50 cursor-not-allowed border-border"
                                            }`}
                                    >
                                        Select Model
                                    </button>
                                </div>
                            </div>

                            {/* Message */}
                            {message && (
                                <div className={`p-3 rounded-lg border text-sm ${message.type === "success"
                                        ? "bg-green-500/10 border-green-500/30 text-green-600 dark:text-green-400"
                                        : "bg-red-500/10 border-red-500/30 text-red-600 dark:text-red-400"
                                    }`}>
                                    {message.text}
                                </div>
                            )}

                            {/* Actions */}
                            <div className="flex items-center gap-2">
                                <Button onClick={handleApply} disabled={applying || !selectedModel} variant="primary" size="sm">
                                    {applying ? "Applying..." : "Apply 9Router Config"}
                                </Button>
                                <Button onClick={handleReset} disabled={restoring} variant="secondary" size="sm">
                                    {restoring ? "Resetting..." : "Reset to Defaults"}
                                </Button>
                            </div>
                        </div>
                    )}
                </div>
            )}

            <ModelSelectModal
                isOpen={modalOpen}
                onClose={() => setModalOpen(false)}
                onSelect={handleSelectModel}
                selectedModel={selectedModel}
                activeProviders={activeProviders}
                title="Select Model"
            />
        </Card>
    );
}