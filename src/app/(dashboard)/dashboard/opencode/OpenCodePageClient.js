"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { sanitizeSensitiveConfig } from "@/lib/opencodeSync/schema";
import { Badge, Button, Card, CardSkeleton, Input, Select, Toggle, ModelSelectModal } from "@/shared/components";
import { cn } from "@/shared/utils/cn";
import AdvancedConfigEditor from "./components/AdvancedConfigEditor";
import TokenManagerCard from "./components/TokenManagerCard";

/* ── constants ─────────────────────────────────────────────────── */

const PLUGIN_SYNC = "opencode-9router-sync@latest";
const PLUGIN_OPENAGENT = "oh-my-openagent@latest";
const PLUGIN_SLIM = "oh-my-opencode-slim@latest";

const DEFAULT_PLUGINS = [PLUGIN_SYNC, PLUGIN_OPENAGENT];

/* ── helpers ───────────────────────────────────────────────────── */

function getErrorMessage(error, fallback) {
  return error?.message || fallback;
}

function prettyJson(value) {
  try {
    if (value === null || value === undefined) return "{}";
    return JSON.stringify(value, null, 2);
  } catch (err) {
    console.error("Error stringifying JSON:", err);
    return "{}";
  }
}

function downloadFile(content, filename) {
  if (typeof window === "undefined") return;
  const blob = new Blob([content], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* ── sub-components ────────────────────────────────────────────── */

function ModelSelector({ preferences, modelCatalog, saving, onSave, activeProviders, modelAliases }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const mode = preferences?.modelSelectionMode || "exclude";
  const listKey = mode === "include" ? "includedModels" : "excludedModels";
  const selectedModels = useMemo(() => preferences?.[listKey] || [], [preferences, listKey]);

  const availableOptions = useMemo(() => {
    const catalog = Array.isArray(modelCatalog) ? modelCatalog.map((m) => m.id).filter(Boolean) : [];
    return Array.from(new Set(catalog))
      .filter((id) => !selectedModels.includes(id))
      .sort((a, b) => a.localeCompare(b));
  }, [modelCatalog, selectedModels]);

  const addModels = (selections) => {
    const modelIds = Array.isArray(selections) 
      ? selections.map(s => s?.value).filter(Boolean)
      : [selections?.value].filter(Boolean);
    const newModels = modelIds.filter(id => !selectedModels.includes(id));
    if (newModels.length === 0) return;
    onSave?.({ [listKey]: [...selectedModels, ...newModels] });
  };

  const removeModel = (modelId) => {
    onSave?.({ [listKey]: selectedModels.filter((id) => id !== modelId) });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-wider text-text-muted">
          Model selection
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => onSave?.({ modelSelectionMode: "exclude" })}
            className={cn(
              "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
              mode === "exclude"
                ? "border-primary/30 bg-primary/10 text-primary"
                : "border-border bg-surface text-text-muted hover:text-text-main"
            )}
          >
            Exclude from catalog
          </button>
          <button
            type="button"
            onClick={() => onSave?.({ modelSelectionMode: "include" })}
            className={cn(
              "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
              mode === "include"
                ? "border-primary/30 bg-primary/10 text-primary"
                : "border-border bg-surface text-text-muted hover:text-text-main"
            )}
          >
            Include only
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-border bg-surface/50 p-3">
        {selectedModels.length === 0 ? (
          <p className="text-xs text-text-muted">
            {mode === "include"
              ? "No included models selected yet."
              : "No excluded models. Full catalog will be used."}
          </p>
        ) : (
          selectedModels.map((modelId) => (
            <Badge key={modelId} className="gap-1.5 pr-1 shadow-sm">
              <span className="max-w-[200px] truncate text-xs">{modelId}</span>
              <button
                type="button"
                className="rounded-full p-0.5 hover:bg-black/10 dark:hover:bg-white/10"
                onClick={() => removeModel(modelId)}
              >
                <span className="material-symbols-outlined text-[12px]">close</span>
              </button>
            </Badge>
          ))
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setPickerOpen(true)}
          loading={saving}
          disabled={availableOptions.length === 0}
        >
          {mode === "include" ? "+ Add model" : "+ Exclude model"}
        </Button>
      </div>

      <ModelSelectModal
        isOpen={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={addModels}
        activeProviders={activeProviders}
        modelAliases={modelAliases}
        title={mode === "include" ? "Add allowed models" : "Add excluded models"}
        multiSelect
      />
    </div>
  );
}

function VariantToggle({ variant, onVariantChange }) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-wider text-text-muted">
        Variant
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onVariantChange("openagent")}
          className={cn(
            "flex-1 rounded-lg border px-3 py-2 text-xs font-medium transition-colors cursor-pointer",
            variant === "openagent"
              ? "border-primary/30 bg-primary/10 text-text-main"
              : "border-border bg-surface text-text-muted hover:text-text-main hover:border-primary/20"
          )}
        >
          <div className="font-semibold">Oh My Open Agent</div>
          <div className="mt-0.5 text-[10px] opacity-70">Recommended · Full preset</div>
        </button>
        <button
          type="button"
          onClick={() => onVariantChange("slim")}
          className={cn(
            "flex-1 rounded-lg border px-3 py-2 text-xs font-medium transition-colors cursor-pointer",
            variant === "slim"
              ? "border-primary/30 bg-primary/10 text-text-main"
              : "border-border bg-surface text-text-muted hover:text-text-main hover:border-primary/20"
          )}
        >
          <div className="font-semibold">Oh My OpenCode Slim</div>
          <div className="mt-0.5 text-[10px] opacity-70">Lighter preset</div>
        </button>
        <button
          type="button"
          onClick={() => onVariantChange("custom")}
          className={cn(
            "flex-1 rounded-lg border px-3 py-2 text-xs font-medium transition-colors cursor-pointer",
            variant === "custom"
              ? "border-primary/30 bg-primary/10 text-text-main"
              : "border-border bg-surface text-text-muted hover:text-text-main hover:border-primary/20"
          )}
        >
          <div className="font-semibold">Custom / No preset</div>
          <div className="mt-0.5 text-[10px] opacity-70">Manual overrides only</div>
        </button>
      </div>
    </div>
  );
}

function PluginSection({ plugins, pluginInput, onPluginInputChange, onAddPlugin, onRemovePlugin }) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-wider text-text-muted">
        Plugins
      </p>
      <div className="flex flex-wrap gap-2">
        {plugins.map((plugin) => (
          <span
            key={plugin}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1 text-xs text-text-main"
          >
            <span className="material-symbols-outlined text-[12px] text-primary">extension</span>
            {plugin}
            <button
              type="button"
              onClick={() => onRemovePlugin(plugin)}
              className="ml-0.5 rounded-full p-0.5 text-text-muted hover:bg-black/10 hover:text-text-main dark:hover:bg-white/10"
            >
              <span className="material-symbols-outlined text-[12px]">close</span>
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={pluginInput}
          onChange={(e) => onPluginInputChange(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onAddPlugin()}
          placeholder="my-plugin@latest"
          className="flex-1 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs text-text-main placeholder:text-text-muted focus:border-primary/30 focus:outline-none focus:ring-1 focus:ring-primary/20"
        />
        <Button variant="ghost" size="sm" onClick={onAddPlugin} disabled={!pluginInput.trim()}>
          Add
        </Button>
      </div>
    </div>
  );
}

function McpSection({ mcps, onAddMcp, onRemoveMcp, onToggleMcpEnabled }) {
  const [name, setName] = useState("");
  const [type, setType] = useState("local");
  const [command, setCommand] = useState("");
  const [url, setUrl] = useState("");

  const handleAdd = () => {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    if (mcps.some((m) => m.name === trimmedName)) return;

    if (type === "remote") {
      if (!url.trim()) return;
      onAddMcp({ name: trimmedName, type: "remote", url: url.trim() });
      setUrl("");
    } else {
      if (!command.trim()) return;
      onAddMcp({ name: trimmedName, type: "local", command: command.trim() });
      setCommand("");
    }
    setName("");
  };

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-wider text-text-muted">
        MCP Servers
      </p>
      {mcps.length > 0 && (
        <div className="space-y-1.5">
          {mcps.map((mcp) => (
            <div
              key={mcp.name}
              className="flex items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 py-2"
            >
              <div className="flex items-center gap-2 text-xs">
                <span className="material-symbols-outlined text-[14px] text-primary">dns</span>
                <span className="font-medium text-text-main">{mcp.name}</span>
                <Badge size="sm">{mcp.type || "local"}</Badge>
                {mcp.enabled === false && <Badge size="sm" variant="secondary">disabled</Badge>}
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => onToggleMcpEnabled(mcp.name)}
                  className="rounded p-1 text-text-muted hover:text-text-main"
                  title={mcp.enabled === false ? "Enable" : "Disable"}
                >
                  <span className="material-symbols-outlined text-[14px]">
                    {mcp.enabled === false ? "toggle_off" : "toggle_on"}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => onRemoveMcp(mcp.name)}
                  className="rounded p-1 text-text-muted hover:text-red-500"
                >
                  <span className="material-symbols-outlined text-[14px]">close</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="grid gap-2 sm:grid-cols-[1fr_auto_1fr_auto]">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Server name"
          className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs text-text-main placeholder:text-text-muted focus:border-primary/30 focus:outline-none focus:ring-1 focus:ring-primary/20"
        />
        <select
          value={type}
          onChange={(e) => setType(e.target.value)}
          className="rounded-lg border border-border bg-surface px-2 py-1.5 text-xs text-text-main focus:border-primary/30 focus:outline-none"
        >
          <option value="local">Local</option>
          <option value="remote">Remote</option>
        </select>
        <input
          type="text"
          value={type === "remote" ? url : command}
          onChange={(e) => (type === "remote" ? setUrl(e.target.value) : setCommand(e.target.value))}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          placeholder={type === "remote" ? "https://example.com/mcp" : "npx @modelcontextprotocol/server-filesystem /workspace"}
          className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs text-text-main placeholder:text-text-muted focus:border-primary/30 focus:outline-none focus:ring-1 focus:ring-primary/20"
        />
        <Button variant="ghost" size="sm" onClick={handleAdd} disabled={!name.trim()}>
          Add
        </Button>
      </div>
    </div>
  );
}

function EnvVarsSection({ envVars, onAddEnvVar, onRemoveEnvVar }) {
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [secret, setSecret] = useState(false);

  const handleAdd = () => {
    if (!key.trim()) return;
    onAddEnvVar({ key: key.trim(), value, secret });
    setKey("");
    setValue("");
    setSecret(false);
  };

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-wider text-text-muted">
        Environment Variables
      </p>
      {envVars.length > 0 && (
        <div className="space-y-1.5">
          {envVars.map((env, idx) => (
            <div
              key={`${env.key}-${idx}`}
              className="flex items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 py-2"
            >
              <div className="flex items-center gap-2 text-xs">
                <span className="material-symbols-outlined text-[14px] text-primary">key</span>
                <span className="font-mono font-medium text-text-main">{env.key}</span>
                {env.secret && <Badge size="sm" variant="secondary">secret</Badge>}
              </div>
              <button
                type="button"
                onClick={() => onRemoveEnvVar(idx)}
                className="rounded p-1 text-text-muted hover:text-red-500"
              >
                <span className="material-symbols-outlined text-[14px]">close</span>
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto_auto]">
        <input
          type="text"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="OPENAI_API_KEY"
          className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs text-text-main placeholder:text-text-muted focus:border-primary/30 focus:outline-none focus:ring-1 focus:ring-primary/20"
        />
        <input
          type={secret ? "password" : "text"}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          placeholder="value"
          className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs text-text-main placeholder:text-text-muted focus:border-primary/30 focus:outline-none focus:ring-1 focus:ring-primary/20"
        />
        <label className="flex items-center gap-1.5 text-xs text-text-muted">
          <input
            type="checkbox"
            checked={secret}
            onChange={(e) => setSecret(e.target.checked)}
            className="rounded"
          />
          Secret
        </label>
        <Button variant="ghost" size="sm" onClick={handleAdd} disabled={!key.trim()}>
          Add
        </Button>
      </div>
    </div>
  );
}

function ConfigPreview({ preview, variant, loading, error, onRefresh, selectedApiKey, requireApiKey }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  let safePreview = null;
  let opencodeConfig = null;
  let configJson = "";
  
  try {
    safePreview = sanitizeSensitiveConfig(preview || null);
    opencodeConfig = safePreview?.opencode || null;
    
    // Replace API key in config
    if (opencodeConfig && opencodeConfig.provider?.["9router"]) {
      opencodeConfig = {
        ...opencodeConfig,
        provider: {
          ...opencodeConfig.provider,
          "9router": {
            ...opencodeConfig.provider["9router"],
            options: {
              ...opencodeConfig.provider["9router"].options,
              apiKey: requireApiKey && selectedApiKey ? selectedApiKey : "sk_9router",
            },
          },
        },
      };
    }
    
    configJson = opencodeConfig ? prettyJson(opencodeConfig) : "";
  } catch (err) {
    console.error("Error processing config preview:", err);
    opencodeConfig = null;
    configJson = "";
  }

  const variantArtifact = useMemo(() => {
    try {
      if (variant === "openagent" && safePreview?.ohMyOpencode) {
        return { filename: "oh-my-openagent.json", content: safePreview.ohMyOpencode };
      }
      if (variant === "slim" && safePreview?.ohMyOpenCodeSlim) {
        return { filename: "oh-my-opencode-slim.json", content: safePreview.ohMyOpenCodeSlim };
      }
    } catch (err) {
      console.error("Error processing variant artifact in ConfigPreview:", err);
    }
    return null;
  }, [variant, safePreview]);

  const handleCopy = async (text) => {
    if (!navigator?.clipboard) return;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-3 py-8">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-border border-t-primary" />
        <span className="text-sm text-text-muted">Generating preview…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-600 dark:text-red-400">
        {error}
        <Button variant="ghost" size="sm" onClick={onRefresh} className="ml-2">
          Retry
        </Button>
      </div>
    );
  }

  if (!opencodeConfig) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-surface/50 px-4 py-6 text-center text-sm text-text-muted">
        No config preview available yet.
        <Button variant="ghost" size="sm" onClick={onRefresh} className="ml-2">
          Refresh
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Sync info banner */}
      <div className="flex items-start gap-3 rounded-xl border border-border bg-surface p-3">
        <p className="text-sm text-text-muted">
          Auto-sync keeps this config updated via{" "}
          <code className="rounded bg-primary/10 px-1.5 py-0.5 font-mono text-xs text-primary">
            opencode-9router-sync@latest
          </code>
        </p>
      </div>

      {/* Slim first-time setup banner */}
      {variant === "slim" && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold text-red-600 shrink-0">First-time setup:</span>
            <code className="text-xs font-mono select-all truncate text-red-600">
              bunx oh-my-opencode-slim@latest install --no-tui --skills=no
            </code>
            <span className="text-[10px] text-red-600/70 shrink-0">(run once)</span>
          </div>
          <p className="text-[10px] text-red-600/50">
            Registers agents and hooks. Use <code className="text-red-600/60">--skills=yes</code> to also install community skills.
          </p>
        </div>
      )}

      {/* Main config preview */}
      <div className="rounded-xl border border-border overflow-hidden">
        <div className="flex items-center justify-between border-b border-border bg-surface px-4 py-2.5">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[16px] text-primary">data_object</span>
            <span className="text-sm font-semibold text-text-main">opencode.json</span>
            <Badge size="sm">
              {Object.keys(opencodeConfig?.provider?.["9router"]?.models || {}).length} models
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => handleCopy(configJson)}>
              {copied ? "Copied!" : "Copy"}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => downloadFile(configJson, "opencode.json")}>
              Download
            </Button>
            <Button variant="ghost" size="sm" onClick={onRefresh}>
              Refresh
            </Button>
            <button
              type="button"
              onClick={() => setIsExpanded(!isExpanded)}
              className="flex items-center gap-1 rounded px-2 py-1 text-xs text-text-muted hover:text-text-main"
            >
              <span className={cn(
                "material-symbols-outlined text-[14px] transition-transform",
                isExpanded ? "rotate-90" : ""
              )}>
                chevron_right
              </span>
              {isExpanded ? "Hide" : "Show"}
            </button>
          </div>
        </div>
        {isExpanded && (
          <pre className="max-h-[32rem] overflow-auto bg-[#0b1020] px-4 py-4 text-xs leading-6 text-slate-100">
            <code>{configJson}</code>
          </pre>
        )}
      </div>

      {/* Variant artifact preview */}
      {variantArtifact && (
        <div className="rounded-xl border border-border overflow-hidden">
          <div className="flex items-center justify-between border-b border-border bg-surface px-4 py-2.5">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[16px] text-primary">tune</span>
              <span className="text-sm font-semibold text-text-main">{variantArtifact.filename}</span>
              <Badge size="sm" variant="secondary">Preset artifact</Badge>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleCopy(prettyJson(variantArtifact.content))}
              >
                Copy
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => downloadFile(prettyJson(variantArtifact.content), variantArtifact.filename)}
              >
                Download
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Tips */}
      <div className="space-y-1.5 text-sm text-text-muted">
        <p className="flex items-start gap-2">
          <span>•</span>
          <span>
            Set default model: <code className="rounded bg-surface px-1.5 py-0.5 font-mono text-xs text-amber-700 dark:text-amber-400">9router/cx/model-name</code>
          </span>
        </p>
        <p className="flex items-start gap-2">
          <span>•</span>
          <span>
            Place at <code className="break-all rounded bg-surface px-1.5 py-0.5 font-mono text-xs text-amber-700 dark:text-amber-400">~/.config/opencode/opencode.json</code>
          </span>
        </p>
      </div>
    </div>
  );
}

/* ── main page ─────────────────────────────────────────────────── */

export default function OpenCodePageClient() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [preferences, setPreferences] = useState(null);
  const [preview, setPreview] = useState(null);
  const [tokens, setTokens] = useState([]);
  const [savingKey, setSavingKey] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [tokenError, setTokenError] = useState("");
  const [tokenCreating, setTokenCreating] = useState(false);
  const [createdToken, setCreatedToken] = useState("");
  const [pluginInput, setPluginInput] = useState("");
  const [activeProviders, setActiveProviders] = useState([]);
  const [modelAliases, setModelAliases] = useState({});
  const [requireApiKey, setRequireApiKey] = useState(false);
  const [apiKeys, setApiKeys] = useState([]);
  const [selectedApiKey, setSelectedApiKey] = useState("");

  const saveTimeoutRef = useRef(null);

  const normalizedPreferences = useMemo(() => {
    const defaults = {
      variant: "openagent",
      customTemplate: null,
      defaultModel: null,
      modelSelectionMode: "exclude",
      includedModels: [],
      excludedModels: [],
      customPlugins: [],
      mcpServers: [],
      envVars: [],
      advancedOverrides: { openagent: {}, slim: {}, custom: {} },
    };
    return preferences ? { ...defaults, ...preferences } : defaults;
  }, [preferences]);

  const modelCatalog = useMemo(() => {
    return Array.isArray(preview?.catalogModels) ? preview.catalogModels : [];
  }, [preview]);

  /* ── data loading ──────────────────────────────────────────── */

  const refreshPreview = useCallback(async () => {
    setPreviewLoading(true);
    setPreviewError("");
    try {
      const res = await fetch("/api/opencode/bundle/preview", { cache: "no-store" });
      const text = await res.text();
      let data = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch (parseErr) {
        console.error("Failed to parse preview response:", parseErr);
        throw new Error("Invalid response from server");
      }
      if (!res.ok) throw new Error(data?.error || "Failed to load preview");
      setPreview(data);
    } catch (err) {
      console.error("Error refreshing preview:", err);
      setPreviewError(getErrorMessage(err, "Failed to load preview"));
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  const loadTokens = useCallback(async () => {
    try {
      const res = await fetch("/api/opencode/sync/tokens", { cache: "no-store" });
      const text = await res.text();
      let data = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch (parseErr) {
        console.error("Failed to parse tokens response:", parseErr);
        throw new Error("Invalid response from server");
      }
      if (!res.ok) throw new Error(data?.error || "Failed to load tokens");
      setTokens(data.tokens || []);
    } catch (err) {
      console.error("Error loading tokens:", err);
    }
  }, []);

  const savePreferences = useCallback(
    async (patch, saveLabel = "saving") => {
      setSavingKey(saveLabel);
      setError("");
      setCreatedToken("");
      try {
        const res = await fetch("/api/opencode/preferences", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(patch),
        });
        const text = await res.text();
        let data = {};
        try {
          data = text ? JSON.parse(text) : {};
        } catch (parseErr) {
          console.error("Failed to parse save response:", parseErr);
          throw new Error("Invalid response from server");
        }
        if (!res.ok) throw new Error(data?.error || "Failed to save");
        setPreferences(data.preferences || null);
        await refreshPreview();
      } catch (err) {
        console.error("Error saving preferences:", err);
        setError(getErrorMessage(err, "Failed to save"));
        throw err;
      } finally {
        setSavingKey("");
      }
    },
    [refreshPreview]
  );

  const createToken = useCallback(
    async ({ name }) => {
      setTokenCreating(true);
      setTokenError("");
      setCreatedToken("");
      try {
        const res = await fetch("/api/opencode/sync/tokens", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name }),
        });
        const text = await res.text();
        let data = {};
        try {
          data = text ? JSON.parse(text) : {};
        } catch (parseErr) {
          console.error("Failed to parse token response:", parseErr);
          throw new Error("Invalid response from server");
        }
        if (!res.ok) throw new Error(data?.error || "Failed to create token");
        setCreatedToken(data.token || "");
        await loadTokens();
      } catch (err) {
        console.error("Error creating token:", err);
        setTokenError(getErrorMessage(err, "Failed to create token"));
      } finally {
        setTokenCreating(false);
      }
    },
    [loadTokens]
  );

  useEffect(() => {
    let cancelled = false;
    async function loadData() {
      setLoading(true);
      setError("");
      try {
        const [prefRes, prevRes, tokRes, provRes, aliasRes, settingsRes, keysRes] = await Promise.all([
          fetch("/api/opencode/preferences"),
          fetch("/api/opencode/bundle/preview"),
          fetch("/api/opencode/sync/tokens"),
          fetch("/api/providers"),
          fetch("/api/models/alias"),
          fetch("/api/settings"),
          fetch("/api/keys"),
        ]);
        
        // Safe JSON parsing with error handling
        const safeJsonParse = async (res, fallback = {}) => {
          try {
            const text = await res.text();
            if (!text || text.trim() === "") return fallback;
            return JSON.parse(text);
          } catch (err) {
            console.error(`JSON parse error for ${res.url}:`, err);
            return fallback;
          }
        };
        
        const [prefData, prevData, tokData, provData, aliasData, settingsData, keysData] = await Promise.all([
          safeJsonParse(prefRes, {}),
          safeJsonParse(prevRes, {}),
          safeJsonParse(tokRes, {}),
          safeJsonParse(provRes, {}),
          safeJsonParse(aliasRes, {}),
          safeJsonParse(settingsRes, {}),
          safeJsonParse(keysRes, {}),
        ]);
        
        if (!prefRes.ok) throw new Error(prefData?.error || "Failed to load preferences");
        if (!prevRes.ok) throw new Error(prevData?.error || "Failed to load preview");
        if (!tokRes.ok) throw new Error(tokData?.error || "Failed to load tokens");
        if (cancelled) return;
        setPreferences(prefData.preferences || null);
        setPreview(prevData);
        setTokens(tokData.tokens || []);
        if (provRes.ok) setActiveProviders(provData.connections || []);
        if (aliasRes.ok) setModelAliases(aliasData.aliases || {});
        if (settingsRes.ok) setRequireApiKey(settingsData.requireApiKey || false);
        if (keysRes.ok) {
          const keys = keysData.keys || [];
          setApiKeys(keys);
          // Auto-select first active key if requireApiKey is enabled
          if (settingsData.requireApiKey && keys.length > 0) {
            const firstActiveKey = keys.find(k => k.isActive !== false);
            if (firstActiveKey) setSelectedApiKey(firstActiveKey.key);
          }
        }
      } catch (err) {
        if (cancelled) return;
        console.error("Error loading OpenCode data:", err);
        setError(err?.message || "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadData();
    return () => { cancelled = true; };
  }, []);

  /* ── handlers matching cliproxyapi-dashboard patterns ──────── */

  const handleVariantChange = (variant) => {
    savePreferences({ variant, customTemplate: variant === "custom" ? (normalizedPreferences.customTemplate || "minimal") : null }, "variant");
  };

  const handleAddPlugin = () => {
    const trimmed = pluginInput.trim();
    if (!trimmed) return;
    const current = normalizedPreferences.customPlugins || [];
    if (current.includes(trimmed)) return;
    savePreferences({ customPlugins: [...current, trimmed] }, "plugins");
    setPluginInput("");
  };

  const handleRemovePlugin = (plugin) => {
    const current = normalizedPreferences.customPlugins || [];
    savePreferences({ customPlugins: current.filter((p) => p !== plugin) }, "plugins");
  };

  const handleAddMcp = (mcp) => {
    const current = normalizedPreferences.mcpServers || [];
    const stored = mcp.type === "remote"
      ? { name: mcp.name, type: "remote", url: mcp.url }
      : { name: mcp.name, type: "local", command: mcp.command.split(/\s+/) };
    savePreferences({ mcpServers: [...current, stored] }, "mcp servers");
  };

  const handleRemoveMcp = (name) => {
    const current = normalizedPreferences.mcpServers || [];
    savePreferences({ mcpServers: current.filter((m) => m.name !== name) }, "mcp servers");
  };

  const handleToggleMcpEnabled = (name) => {
    const current = normalizedPreferences.mcpServers || [];
    savePreferences({
      mcpServers: current.map((m) =>
        m.name === name ? { ...m, enabled: m.enabled === false ? true : false } : m
      ),
    }, "mcp servers");
  };

  const handleAddEnvVar = (envVar) => {
    const current = normalizedPreferences.envVars || [];
    savePreferences({ envVars: [...current, envVar] }, "env vars");
  };

  const handleRemoveEnvVar = (index) => {
    const current = normalizedPreferences.envVars || [];
    savePreferences({ envVars: current.filter((_, i) => i !== index) }, "env vars");
  };

  // Build the effective plugin list for display (matching cliproxyapi-dashboard logic)
  const effectivePlugins = useMemo(() => {
    const variant = normalizedPreferences.variant;
    const base = [PLUGIN_SYNC];
    if (variant === "openagent") base.push(PLUGIN_OPENAGENT);
    else if (variant === "slim") base.push(PLUGIN_SLIM);
    const custom = normalizedPreferences.customPlugins || [];
    const all = [...base, ...custom.filter((p) => !base.includes(p))];
    return all;
  }, [normalizedPreferences]);

  /* ── render ────────────────────────────────────────────────── */

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
        {/* Header */}
        <section className="rounded-lg border border-border bg-surface p-4">
          <h1 className="text-xl font-semibold tracking-tight text-text-main">
            OpenCode Quick Start
          </h1>
          <p className="mt-1 text-sm text-text-muted">
            Configure your OpenCode setup, generate config, and manage auto-sync from one place.
          </p>
        </section>

        {/* Global error */}
        {error && (
          <div className="rounded-lg border border-red-500/20 bg-red-500/8 px-4 py-3 text-sm text-red-600 dark:text-red-300">
            {error}
          </div>
        )}

        {savingKey && (
          <p className="text-xs text-text-muted">Saving {savingKey}…</p>
        )}

        {/* Model Selection */}
        <section id="model-selection" className="scroll-mt-24">
          <Card
            title="Model Selection"
            subtitle="Choose which models appear in your generated config."
            icon="model_training"
            className="rounded-xl"
          >
            <ModelSelector
              preferences={normalizedPreferences}
              modelCatalog={modelCatalog}
              saving={savingKey === "models"}
              onSave={(patch) => savePreferences(patch, "models")}
              activeProviders={activeProviders}
              modelAliases={modelAliases}
            />
          </Card>
        </section>

        {/* Generate Config — main Quick Start card */}
        <section id="generate-config" className="scroll-mt-24">
          <Card
            title={
              <span className="flex items-center gap-3">
                <span className="flex h-6 w-6 items-center justify-center rounded-md border border-border bg-surface text-sm text-text-muted" aria-hidden="true">
                  ▶
                </span>
                Using with OpenCode
              </span>
            }
            icon="terminal"
            className="rounded-xl"
          >
            <div className="space-y-5">
              {/* Variant toggle */}
              <VariantToggle
                variant={normalizedPreferences.variant}
                onVariantChange={handleVariantChange}
              />

              {/* Default Model Selector */}
              <div>
                <Select
                  label="Default Model"
                  value={normalizedPreferences.defaultModel || ""}
                  onChange={(e) => savePreferences({ defaultModel: e.target.value || null }, "default model")}
                  options={[
                    { value: "", label: "Auto (first model)" },
                    ...(() => {
                      const selectedModelIds = normalizedPreferences.modelSelectionMode === "include"
                        ? normalizedPreferences.includedModels || []
                        : Object.keys(preview?.opencode?.provider?.["9router"]?.models || {});
                      
                      return selectedModelIds.sort().map(id => {
                        const model = modelCatalog.find(m => m.id === id);
                        const displayName = model?.name || id;
                        return { value: id, label: `${id} (${displayName})` };
                      });
                    })()
                  ]}
                  hint="Model to use by default in generated config."
                />
              </div>

              {/* API Key Selector */}
              {requireApiKey ? (
                <div>
                  <Select
                    label="API Key"
                    value={selectedApiKey}
                    onChange={(e) => setSelectedApiKey(e.target.value)}
                    options={[
                      ...apiKeys
                        .filter(k => k.isActive !== false)
                        .map(k => ({
                          value: k.key,
                          label: k.name || k.key.slice(0, 20) + "..."
                        }))
                    ]}
                    hint="API key to use in generated config (endpoint requires API key)."
                  />
                </div>
              ) : (
                <div className="rounded-lg border border-border bg-surface/50 px-3 py-2">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="material-symbols-outlined text-[14px] text-primary">info</span>
                    <span className="text-text-muted">
                      API key will be set to <code className="text-primary font-mono">sk_9router</code> (endpoint doesn't require API key)
                    </span>
                  </div>
                </div>
              )}

              {/* Custom template selector */}
              {normalizedPreferences.variant === "custom" && (
                <div className="max-w-xs">
                  <Select
                    label="Custom template"
                    value={normalizedPreferences.customTemplate || "minimal"}
                    onChange={(e) => savePreferences({ customTemplate: e.target.value }, "template")}
                    options={[
                      { value: "minimal", label: "Minimal" },
                      { value: "opinionated", label: "Opinionated" },
                    ]}
                    hint="Minimal is lighter. Opinionated adds more defaults."
                  />
                </div>
              )}

              {/* Plugins */}
              <PluginSection
                plugins={effectivePlugins}
                pluginInput={pluginInput}
                onPluginInputChange={setPluginInput}
                onAddPlugin={handleAddPlugin}
                onRemovePlugin={(plugin) => {
                  // Don't allow removing core plugins
                  if (plugin === PLUGIN_SYNC || plugin === PLUGIN_OPENAGENT || plugin === PLUGIN_SLIM) return;
                  handleRemovePlugin(plugin);
                }}
              />

              {/* MCP Servers */}
              <McpSection
                mcps={normalizedPreferences.mcpServers || []}
                onAddMcp={handleAddMcp}
                onRemoveMcp={handleRemoveMcp}
                onToggleMcpEnabled={handleToggleMcpEnabled}
              />

              {/* Environment Variables */}
              <EnvVarsSection
                envVars={normalizedPreferences.envVars || []}
                onAddEnvVar={handleAddEnvVar}
                onRemoveEnvVar={handleRemoveEnvVar}
              />

              {/* Divider */}
              <div className="border-t border-border" />

              {/* Config Preview */}
              <ConfigPreview
                preview={preview}
                variant={normalizedPreferences.variant}
                loading={previewLoading}
                error={previewError}
                onRefresh={refreshPreview}
                selectedApiKey={selectedApiKey}
                requireApiKey={requireApiKey}
              />
            </div>
          </Card>
        </section>

        {/* Advanced overrides — collapsible */}
        {normalizedPreferences.variant !== "custom" && (
          <section id="advanced-config" className="scroll-mt-24">
            <AdvancedOverridesCollapsible
              preferences={normalizedPreferences}
              preview={preview}
              modelCatalog={modelCatalog}
              saving={savingKey === "advanced overrides"}
              error={error}
              onSave={(patch) => savePreferences(patch, "advanced overrides")}
            />
          </section>
        )}

        {/* Auto-sync tokens */}
        <section id="sync-tokens" className="scroll-mt-24">
          <TokenManagerCard
            tokens={tokens}
            creating={tokenCreating}
            createError={tokenError}
            createdToken={createdToken}
            onCreate={createToken}
          />
        </section>
    </div>
  );
}

/* ── Advanced Overrides Collapsible ────────────────────────────── */

function AdvancedOverridesCollapsible({ preferences, preview, modelCatalog, saving, error, onSave }) {
  const variant = preferences?.variant || "openagent";
  const safePreview = sanitizeSensitiveConfig(preview || null);
  const [editMode, setEditMode] = useState(false);
  const [draftJson, setDraftJson] = useState("");
  const [jsonError, setJsonError] = useState("");

  const variantArtifact = useMemo(() => {
    try {
      if (variant === "openagent" && safePreview?.ohMyOpencode) {
        return { filename: "oh-my-openagent.json", content: safePreview.ohMyOpencode };
      }
      if (variant === "slim" && safePreview?.ohMyOpenCodeSlim) {
        return { filename: "oh-my-opencode-slim.json", content: safePreview.ohMyOpenCodeSlim };
      }
    } catch (err) {
      console.error("Error processing variant artifact in AdvancedOverridesCollapsible:", err);
    }
    return null;
  }, [variant, safePreview]);

  const currentOverrides = preferences?.advancedOverrides?.[variant] || {};

  const title = variant === "slim"
    ? "Advanced config: Oh My OpenCode Slim"
    : "Advanced config: Oh My Open Agent";

  const handleEditClick = () => {
    setDraftJson(prettyJson(currentOverrides));
    setJsonError("");
    setEditMode(true);
  };

  const handleSaveOverrides = () => {
    try {
      const parsed = JSON.parse(draftJson);
      if (typeof parsed !== "object" || Array.isArray(parsed)) {
        setJsonError("Must be a valid JSON object");
        return;
      }
      onSave({ advancedOverrides: { ...preferences.advancedOverrides, [variant]: parsed } });
      setEditMode(false);
      setJsonError("");
    } catch (err) {
      setJsonError(err.message || "Invalid JSON");
    }
  };

  const handleCancelEdit = () => {
    setEditMode(false);
    setJsonError("");
  };

  return (
    <details className="group/details rounded-xl border border-border bg-surface">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
        <span className="flex items-center gap-3 text-sm font-semibold text-text-main">
          <span className="flex h-6 w-6 items-center justify-center rounded-md border border-border bg-surface text-sm text-text-muted" aria-hidden="true">
            ▶
          </span>
          {title}
        </span>
        <span className="material-symbols-outlined text-[18px] text-text-muted transition-transform duration-200 group-open/details:rotate-180">
          expand_more
        </span>
      </summary>
      <div className="border-t border-border px-4 py-4 space-y-4">
        {/* Advanced Config Editor with Agent/Category Assignments */}
        <AdvancedConfigEditor
          variant={variant}
          preferences={preferences}
          availableModels={Object.keys(preview?.opencode?.provider?.["9router"]?.models || {})}
          onSave={onSave}
          saving={saving}
        />

        {/* Generated artifact preview */}
        {variantArtifact && (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-text-main">{variantArtifact.filename}</p>
                <p className="mt-1 text-xs text-text-muted">
                  Generated advanced config for the selected variant.
                </p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => downloadFile(prettyJson(variantArtifact.content), variantArtifact.filename)}
              >
                Download
              </Button>
            </div>
            <pre className="max-h-[18rem] overflow-auto rounded-xl border border-border bg-[#0b1020] px-4 py-4 text-xs leading-6 text-slate-100">
              <code>{prettyJson(variantArtifact.content)}</code>
            </pre>
          </div>
        )}

        {/* Raw JSON Editor (Advanced) */}
        <details className="rounded-lg border border-border bg-surface/50">
          <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-text-muted hover:text-text-main transition-colors">
            Advanced: Edit Raw JSON
          </summary>
          <div className="border-t border-border px-3 py-3 space-y-3">
            {editMode ? (
              <>
                <textarea
                  value={draftJson}
                  onChange={(e) => setDraftJson(e.target.value)}
                  className="w-full h-64 px-3 py-2 font-mono text-xs rounded-lg border border-border bg-surface text-text-main focus:border-primary/30 focus:outline-none focus:ring-1 focus:ring-primary/20"
                  placeholder='{\n  "agentAssignments": {\n    "explorer": "cx/gpt-5.3-codex"\n  }\n}'
                />
                {jsonError && (
                  <p className="text-sm text-red-600 dark:text-red-400">{jsonError}</p>
                )}
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={handleCancelEdit}>
                    Cancel
                  </Button>
                  <Button size="sm" onClick={handleSaveOverrides} loading={saving}>
                    Save JSON
                  </Button>
                </div>
              </>
            ) : (
              <>
                <pre className="max-h-[18rem] overflow-auto rounded-xl border border-border bg-surface px-4 py-4 text-xs leading-6 text-text-main">
                  <code>{Object.keys(currentOverrides).length > 0 ? prettyJson(currentOverrides) : "{}"}</code>
                </pre>
                <Button variant="secondary" size="sm" onClick={handleEditClick}>
                  Edit JSON
                </Button>
              </>
            )}
          </div>
        </details>
      </div>
    </details>
  );
}
