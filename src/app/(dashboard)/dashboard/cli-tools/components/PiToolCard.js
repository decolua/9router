"use client";

import { useState, useEffect } from "react";
import { Card, Button, ModelSelectModal } from "@/shared/components";
import Image from "next/image";

export default function PiToolCard({ tool, isExpanded, onToggle, baseUrl, apiKeys, activeProviders, initialStatus }) {
  const [status, setStatus] = useState(initialStatus || null);
  const [checking, setChecking] = useState(false);
  const [applying, setApplying] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [message, setMessage] = useState(null);
  const [showInstallGuide, setShowInstallGuide] = useState(false);
  const [selectedApiKey, setSelectedApiKey] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [modelAliases, setModelAliases] = useState({});
  const [customBaseUrl, setCustomBaseUrl] = useState("");

  useEffect(() => {
    if (apiKeys?.length > 0 && !selectedApiKey) {
      setSelectedApiKey(apiKeys[0].key);
    }
  }, [apiKeys, selectedApiKey]);

  useEffect(() => {
    if (initialStatus) setStatus(initialStatus);
  }, [initialStatus]);

  useEffect(() => {
    if (isExpanded && !status) {
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

  const getConfigStatus = () => {
    if (!status?.installed) return null;
    if (!status.authJson) return "not_configured";
    const url = status.authJson?.["9router"]?.baseURL || "";
    const isLocal = url.includes("localhost") || url.includes("127.0.0.1");
    return status.has9Router && (isLocal || url.includes(baseUrl)) ? "configured" : status.has9Router ? "other" : "not_configured";
  };

  const configStatus = getConfigStatus();

  const getEffectiveBaseUrl = () => {
    const url = customBaseUrl || baseUrl;
    return url.endsWith("/v1") ? url : `${url}/v1`;
  };

  const getDisplayUrl = () => customBaseUrl || `${baseUrl}/v1`;

  const checkStatus = async () => {
    setChecking(true);
    try {
      const res = await fetch("/api/cli-tools/pi-settings");
      const data = await res.json();
      setStatus(data);
    } catch (error) {
      setStatus({ installed: false, error: error.message });
    } finally {
      setChecking(false);
    }
  };

  const handleApply = async () => {
    setApplying(true);
    setMessage(null);
    try {
      const res = await fetch("/api/cli-tools/pi-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseURL: getEffectiveBaseUrl(),
          apiKey: selectedApiKey,
          model: selectedModel,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: "Configuration applied successfully" });
        await checkStatus();
      } else {
        setMessage({ type: "error", text: data.error || "Failed to apply configuration" });
      }
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    } finally {
      setApplying(false);
    }
  };

  const handleRestore = async () => {
    if (!confirm("Restore default Pi configuration?")) return;
    setRestoring(true);
    setMessage(null);
    try {
      const res = await fetch("/api/cli-tools/pi-settings", {
        method: "DELETE",
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: "Configuration restored successfully" });
        await checkStatus();
      } else {
        setMessage({ type: "error", text: data.error || "Failed to restore configuration" });
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

  if (!isExpanded) {
    return (
      <Card
        padding="sm"
        className="cursor-pointer hover:border-primary/30 transition-colors"
        onClick={onToggle}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-lg bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center shrink-0">
              <span className="text-white font-bold text-lg">π</span>
            </div>
            <div>
              <h3 className="font-semibold text-text-main">{tool.name}</h3>
              <p className="text-xs text-text-muted">{tool.description}</p>
            </div>
          </div>
          <span className="material-symbols-outlined text-text-muted">expand_more</span>
        </div>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <div className="space-y-4">
          {/* Header */}
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="size-12 rounded-lg bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center shrink-0">
                <span className="text-white font-bold text-xl">π</span>
              </div>
              <div>
                <h3 className="text-lg font-semibold text-text-main">{tool.name}</h3>
                <p className="text-sm text-text-muted">{tool.description}</p>
              </div>
            </div>
            <button
              onClick={onToggle}
              className="text-text-muted hover:text-text-main transition-colors"
            >
              <span className="material-symbols-outlined">expand_less</span>
            </button>
          </div>

          {/* Status */}
          {checking ? (
            <div className="flex items-center gap-2 text-sm text-text-muted">
              <div className="size-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              Checking installation...
            </div>
          ) : status?.installed === false ? (
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3">
              <div className="flex items-start gap-2">
                <span className="material-symbols-outlined text-amber-600 text-xl">warning</span>
                <div className="flex-1">
                  <p className="text-sm font-medium text-amber-900 dark:text-amber-100">
                    Pi is not installed
                  </p>
                  <p className="text-xs text-amber-700 dark:text-amber-200 mt-1">
                    Install Pi to use this configuration
                  </p>
                  <button
                    onClick={() => setShowInstallGuide(!showInstallGuide)}
                    className="text-xs text-amber-600 dark:text-amber-400 underline mt-2"
                  >
                    {showInstallGuide ? "Hide" : "Show"} installation guide
                  </button>
                </div>
              </div>
              {showInstallGuide && (
                <div className="mt-3 pt-3 border-t border-amber-500/20">
                  <p className="text-xs font-medium text-amber-900 dark:text-amber-100 mb-2">
                    Install Pi:
                  </p>
                  <code className="block text-xs bg-black/10 dark:bg-white/10 rounded px-2 py-1 font-mono">
                    npm install -g @mariozechner/pi-coding-agent
                  </code>
                  <p className="text-xs text-amber-700 dark:text-amber-200 mt-2">
                    Or visit:{" "}
                    <a
                      href="https://github.com/badlogic/pi-mono"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline"
                    >
                      github.com/badlogic/pi-mono
                    </a>
                  </p>
                </div>
              )}
            </div>
          ) : configStatus === "configured" ? (
            <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-emerald-600">check_circle</span>
                <span className="text-sm font-medium text-emerald-900 dark:text-emerald-100">
                  Configured with 9Router
                </span>
              </div>
            </div>
          ) : configStatus === "other" ? (
            <div className="rounded-lg border border-blue-500/20 bg-blue-500/10 p-3">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-blue-600">info</span>
                <span className="text-sm font-medium text-blue-900 dark:text-blue-100">
                  Configured with another provider
                </span>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-border bg-surface p-3">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-text-muted">info</span>
                <span className="text-sm text-text-muted">Not configured yet</span>
              </div>
            </div>
          )}

          {/* Message */}
          {message && (
            <div
              className={`rounded-lg border p-3 ${
                message.type === "success"
                  ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-900 dark:text-emerald-100"
                  : "border-red-500/20 bg-red-500/10 text-red-900 dark:text-red-100"
              }`}
            >
              <p className="text-sm">{message.text}</p>
            </div>
          )}

          {/* Configuration Form */}
          {status?.installed && (
            <div className="space-y-4 pt-4 border-t border-border">
              <div>
                <label className="block text-sm font-medium text-text-main mb-2">
                  Base URL
                </label>
                <input
                  type="text"
                  value={customBaseUrl}
                  onChange={(e) => setCustomBaseUrl(e.target.value)}
                  placeholder={`${baseUrl}/v1`}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-text-main text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
                <p className="text-xs text-text-muted mt-1">
                  Leave empty to use: {baseUrl}/v1
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-text-main mb-2">
                  API Key
                </label>
                <select
                  value={selectedApiKey}
                  onChange={(e) => setSelectedApiKey(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-surface text-text-main text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                >
                  {apiKeys?.length > 0 ? (
                    apiKeys.map((key) => (
                      <option key={key.key} value={key.key}>
                        {key.name || key.key}
                      </option>
                    ))
                  ) : (
                    <option value="">No API keys available</option>
                  )}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-text-main mb-2">
                  Default Model (Optional)
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value)}
                    placeholder="e.g., anthropic/claude-sonnet-4"
                    className="flex-1 px-3 py-2 rounded-lg border border-border bg-surface text-text-main text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setModalOpen(true)}
                  >
                    Browse
                  </Button>
                </div>
                <p className="text-xs text-text-muted mt-1">
                  Leave empty to use Pi's default model selection
                </p>
              </div>

              {/* Actions */}
              <div className="flex gap-2 pt-2">
                <Button
                  onClick={handleApply}
                  loading={applying}
                  disabled={!selectedApiKey || applying}
                  fullWidth
                >
                  Apply Configuration
                </Button>
                {configStatus === "configured" && (
                  <Button
                    variant="ghost"
                    onClick={handleRestore}
                    loading={restoring}
                    disabled={restoring}
                  >
                    Restore
                  </Button>
                )}
              </div>

              {/* Info */}
              <div className="rounded-lg border border-border bg-surface/50 p-3 text-xs text-text-muted space-y-2">
                <p className="font-medium text-text-main">Configuration Location:</p>
                <code className="block bg-black/5 dark:bg-white/5 rounded px-2 py-1">
                  ~/.pi/agent/auth.json
                </code>
                <p className="mt-2">
                  Pi will use 9Router as a custom provider. The configuration adds a "9router" entry
                  to your auth.json file with the base URL and API key.
                </p>
                <p className="mt-2">
                  Learn more:{" "}
                  <a
                    href="https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/providers.md"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary underline"
                  >
                    Pi Providers Documentation
                  </a>
                </p>
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* Model Select Modal */}
      <ModelSelectModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onSelect={handleModelSelect}
        activeProviders={activeProviders}
        modelAliases={modelAliases}
        title="Select Default Model for Pi"
      />
    </>
  );
}
