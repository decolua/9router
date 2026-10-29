"use client";

import { useMemo, useState } from "react";
import {
  AI_PROVIDERS,
  isOpenAICompatibleProvider,
  isAnthropicCompatibleProvider,
  isCustomEmbeddingProvider,
} from "@/shared/constants/providers";

function canonicalProviderId(value) {
  return typeof value === "string" ? value.trim() : "";
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isCustomNodeProvider(id) {
  return isOpenAICompatibleProvider(id) || isAnthropicCompatibleProvider(id) || isCustomEmbeddingProvider(id);
}

// Built-in providers label from the registry's own display name, never the
// connected account's name — an account label can be an OAuth email and
// would leak account identity into a filter meant to group by provider type.
// Custom endpoint nodes (openai-compatible-*, anthropic-compatible-*,
// custom-embedding-*) have no registry entry and a generated id — for those,
// the connection name IS the node name the user picked (auth is API-key
// based, never an OAuth email), so it's used instead to identify which
// endpoint is which.
function providerDisplayName(id, connectionName) {
  if (isCustomNodeProvider(id)) return connectionName || id;
  return AI_PROVIDERS[id]?.name || id;
}

function buildProviderOptions(models) {
  const providerNames = new Map();

  for (const model of models) {
    const id = canonicalProviderId(model.provider?.id);
    if (!id) continue;
    if (!providerNames.has(id)) {
      const name = typeof model.provider?.name === "string" ? model.provider.name.trim() : "";
      providerNames.set(id, name);
    }
  }

  return Array.from(providerNames, ([id, name]) => ({
    id,
    label: providerDisplayName(id, name),
  })).sort((left, right) => compareText(left.label, right.label) || compareText(left.id, right.id));
}

export default function StudioConfigPane({ config, onChange, models, loading, error }) {
  const [providerId, setProviderId] = useState("");
  const providerOptions = useMemo(() => buildProviderOptions(models), [models]);
  const filteredModels = providerId
    ? models.filter((model) => canonicalProviderId(model.provider?.id) === providerId)
    : models;
  const handleChange = (key, value) => {
    onChange({ ...config, [key]: value });
  };

  return (
    <div className="w-full lg:w-80 flex flex-col h-auto lg:h-full min-h-[300px] bg-surface/30 shrink-0 border-t lg:border-t-0">
      <div className="p-4 border-b border-border-subtle shrink-0">
        <h2 className="text-sm font-semibold tracking-tight text-text-main">Configuration</h2>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* Model Selection */}
        <div className="space-y-2">
          <label className="text-xs font-medium text-text-main">Model</label>
          {loading ? (
            <div className="h-9 w-full rounded-lg bg-surface animate-pulse" aria-label="Loading models..." role="status" />
          ) : error ? (
            <div className="text-xs text-red-500 bg-red-500/10 p-2 rounded-md border border-red-500/20" role="alert">
              {error}
            </div>
          ) : models.length === 0 ? (
            <div className="text-xs text-amber-500 bg-amber-500/10 p-2 rounded-md border border-amber-500/20" role="alert">
              No models available. Connect a provider first.
            </div>
          ) : (
            <>
              <select
                value={providerId}
                onChange={(event) => {
                  const nextProviderId = event.target.value;
                  setProviderId(nextProviderId);
                  if (!nextProviderId || !config.model) return;

                  const catalogModel = models.find((model) => model.id === config.model.id);
                  const selectedProviderId = canonicalProviderId(
                    catalogModel?.provider?.id ?? config.model.provider?.id
                  );
                  if (selectedProviderId !== nextProviderId) handleChange("model", null);
                }}
                className="w-full h-9 px-3 rounded-lg border border-border bg-surface text-sm focus:outline-none focus:border-primary/50 transition-colors text-text-main"
                aria-label="Filter models by provider"
                data-testid="chat-provider-filter"
              >
                <option value="">All providers</option>
                {providerOptions.map((provider) => (
                  <option key={provider.id} value={provider.id}>{provider.label}</option>
                ))}
              </select>
              <select
                value={config.model?.id || ""}
                onChange={(e) => {
                  const selected = models.find(m => m.id === e.target.value);
                  handleChange("model", selected || null);
                }}
                className="w-full h-9 px-3 rounded-lg border border-border bg-surface text-sm focus:outline-none focus:border-primary/50 transition-colors text-text-main"
                aria-label="Select Model"
              >
                <option value="">Select a model...</option>
                {filteredModels.map(m => (
                  <option key={m.id} value={m.id}>
                    {m.label || m.id} ({m.provider?.name || m.provider?.id || "Unknown"})
                  </option>
                ))}
              </select>
            </>
          )}
        </div>

        {/* System Prompt */}
        <div className="space-y-2">
          <label className="text-xs font-medium text-text-main">System Prompt</label>
          <textarea
            value={config.systemPrompt}
            onChange={(e) => handleChange("systemPrompt", e.target.value)}
            className="w-full h-32 p-3 rounded-lg border border-border bg-surface text-sm focus:outline-none focus:border-primary/50 transition-colors custom-scrollbar resize-none text-text-main"
            placeholder="You are a helpful assistant..."
            aria-label="System Prompt"
          />
        </div>
      </div>
    </div>
  );
}