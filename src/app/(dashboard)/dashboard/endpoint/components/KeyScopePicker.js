"use client";

import { useEffect, useMemo, useState } from "react";
import PropTypes from "prop-types";
import ProviderIcon from "@/shared/components/ProviderIcon";
import { AI_PROVIDERS, resolveProviderId } from "@/shared/constants/providers";

// Groups the /v1/models catalog by provider alias (owned_by). This reuses the
// existing, unmodified /v1/models endpoint rather than adding a new provider-
// listing API — the picker only ever shows what the key could actually reach.
function groupModelsByProvider(models) {
  const byProvider = new Map();
  for (const m of models) {
    if (!m?.id || typeof m.id !== "string" || !m.id.includes("/")) continue;
    const alias = m.owned_by || m.id.slice(0, m.id.indexOf("/"));
    const modelId = m.id.slice(m.id.indexOf("/") + 1);
    if (!byProvider.has(alias)) byProvider.set(alias, []);
    byProvider.get(alias).push(modelId);
  }
  return byProvider;
}

/**
 * Additive, self-contained scope editor for an API key. Fetches the existing
 * /v1/models catalog (unmodified) and lets an operator pick providers and,
 * per provider, narrow down to specific models. Selecting a provider defaults
 * to "all models" (an empty `models` entry for that provider) — the operator
 * then deselects individual models to narrow, matching the AND-semantics
 * scope engine in src/lib/apiKeyScope.js: providers:[] + models:[] under a
 * selected provider == that whole provider.
 *
 * value: null (unrestricted) | { providers: string[], models: string[] }
 */
export default function KeyScopePicker({ value, onChange }) {
  const [catalog, setCatalog] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(() => new Set());

  useEffect(() => {
    let cancelled = false;
    fetch("/v1/models", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : { data: [] }))
      .then((data) => {
        if (!cancelled) setCatalog(Array.isArray(data.data) ? data.data : []);
      })
      .catch(() => { if (!cancelled) setCatalog([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const byProvider = useMemo(() => groupModelsByProvider(catalog), [catalog]);
  const providerAliases = useMemo(
    () => Array.from(byProvider.keys()).sort((a, b) => a.localeCompare(b)),
    [byProvider],
  );

  const unrestricted = value == null;
  const selectedProviders = useMemo(() => new Set(value?.providers || []), [value]);
  const selectedModels = useMemo(() => new Set(value?.models || []), [value]);

  const isProviderSelected = (alias) => {
    const id = resolveProviderId(alias);
    return selectedProviders.has(alias) || selectedProviders.has(id);
  };

  const modelsSelectedForProvider = (alias) => {
    const prefix = `${alias}/`;
    const all = value?.models || [];
    return all.filter((m) => m.startsWith(prefix));
  };

  const emit = (nextProviders, nextModels) => {
    if (nextProviders.length === 0) {
      onChange(null);
      return;
    }
    onChange({ providers: nextProviders, models: nextModels });
  };

  const toggleProvider = (alias) => {
    const providers = new Set(value?.providers || []);
    let models = (value?.models || []).slice();
    if (providers.has(alias)) {
      providers.delete(alias);
      models = models.filter((m) => !m.startsWith(`${alias}/`));
    } else {
      providers.add(alias);
      // Default: all models of this provider — no narrowing entries added.
    }
    emit(Array.from(providers), models);
  };

  const toggleModel = (alias, modelId) => {
    const providers = new Set(value?.providers || []);
    providers.add(alias); // selecting a model implies the provider is selected
    const fullId = `${alias}/${modelId}`;
    const currentNarrowed = modelsSelectedForProvider(alias);
    const providerModelIds = byProvider.get(alias) || [];
    const otherProvidersModels = (value?.models || []).filter((m) => !m.startsWith(`${alias}/`));

    let nextNarrowed;
    if (currentNarrowed.length === 0) {
      // Currently "all models" — deselecting one narrows to the rest.
      nextNarrowed = providerModelIds.filter((id) => id !== modelId).map((id) => `${alias}/${id}`);
    } else if (currentNarrowed.includes(fullId)) {
      nextNarrowed = currentNarrowed.filter((m) => m !== fullId);
    } else {
      nextNarrowed = [...currentNarrowed, fullId];
      // If every model ends up selected again, collapse back to "all" (empty = all).
      if (nextNarrowed.length === providerModelIds.length) nextNarrowed = [];
    }

    emit(Array.from(providers), [...otherProvidersModels, ...nextNarrowed]);
  };

  const toggleExpanded = (alias) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(alias)) next.delete(alias);
      else next.add(alias);
      return next;
    });
  };

  if (loading) {
    return <p className="text-sm text-text-muted">Loading available providers…</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={unrestricted}
          onChange={(e) => onChange(e.target.checked ? null : { providers: [], models: [] })}
        />
        <span>Unrestricted (key can reach every provider and model)</span>
      </label>

      {!unrestricted && (
        <div className="flex flex-col gap-1 max-h-80 overflow-y-auto border border-black/[0.06] dark:border-white/[0.06] rounded-lg p-2">
          {providerAliases.length === 0 && (
            <p className="text-sm text-text-muted px-2 py-1">No providers configured yet.</p>
          )}
          {providerAliases.map((alias) => {
            const providerId = resolveProviderId(alias);
            const providerInfo = AI_PROVIDERS[providerId];
            const modelIds = byProvider.get(alias) || [];
            const checked = isProviderSelected(alias);
            const narrowed = modelsSelectedForProvider(alias);
            const isExpanded = expanded.has(alias);

            return (
              <div key={alias} className="border-b border-black/[0.03] dark:border-white/[0.03] last:border-b-0 py-1">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleProvider(alias)}
                  />
                  <ProviderIcon providerId={providerId} size={16} />
                  <button
                    type="button"
                    className="flex-1 text-left text-sm font-medium"
                    onClick={() => toggleExpanded(alias)}
                  >
                    {providerInfo?.name || alias}
                  </button>
                  <span className="text-xs text-text-muted">
                    {checked
                      ? (narrowed.length === 0 ? `all ${modelIds.length} models` : `${narrowed.length}/${modelIds.length} models`)
                      : ""}
                  </span>
                  <button
                    type="button"
                    className="material-symbols-outlined text-[16px] text-text-muted"
                    onClick={() => toggleExpanded(alias)}
                  >
                    {isExpanded ? "expand_less" : "expand_more"}
                  </button>
                </div>
                {isExpanded && (
                  <div className="pl-8 mt-1 flex flex-col gap-1">
                    {modelIds.map((modelId) => {
                      const fullId = `${alias}/${modelId}`;
                      const modelChecked = checked && (narrowed.length === 0 || narrowed.includes(fullId));
                      return (
                        <label key={fullId} className="flex items-center gap-2 text-xs">
                          <input
                            type="checkbox"
                            checked={modelChecked}
                            onChange={() => toggleModel(alias, modelId)}
                          />
                          <span className="font-mono">{modelId}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

KeyScopePicker.propTypes = {
  value: PropTypes.shape({
    providers: PropTypes.arrayOf(PropTypes.string),
    models: PropTypes.arrayOf(PropTypes.string),
  }),
  onChange: PropTypes.func.isRequired,
};
