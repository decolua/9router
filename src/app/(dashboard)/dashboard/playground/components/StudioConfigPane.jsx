"use client";

import { useState, useEffect } from "react";
import { fetchModelCatalog } from "@/app/(dashboard)/dashboard/playground/lib/modelCatalog";

export default function StudioConfigPane({ config, onChange }) {
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const catalog = await fetchModelCatalog();
        setModels(catalog.models || []);
      } catch (err) {
        setError(err.message || "Failed to load models");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const handleChange = (key, value) => {
    onChange({ ...config, [key]: value });
  };

  return (
    <div className="w-80 flex flex-col h-full bg-surface/30 shrink-0">
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
              {models.map(m => (
                <option key={m.id} value={m.id}>
                  {m.name || m.id} ({m.provider})
                </option>
              ))}
            </select>
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

        {/* Temperature */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-text-main">Temperature</label>
            <span className="text-xs text-text-muted font-mono">{config.temperature.toFixed(2)}</span>
          </div>
          <input
            type="range"
            min="0"
            max="2"
            step="0.01"
            value={config.temperature}
            onChange={(e) => handleChange("temperature", parseFloat(e.target.value))}
            className="w-full accent-primary"
            aria-label="Temperature"
          />
        </div>

        {/* Max Tokens */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-text-main">Max Tokens</label>
            <span className="text-xs text-text-muted font-mono">{config.maxTokens}</span>
          </div>
          <input
            type="range"
            min="100"
            max="8000"
            step="100"
            value={config.maxTokens}
            onChange={(e) => handleChange("maxTokens", parseInt(e.target.value, 10))}
            className="w-full accent-primary"
            aria-label="Max Tokens"
          />
        </div>
      </div>
    </div>
  );
}