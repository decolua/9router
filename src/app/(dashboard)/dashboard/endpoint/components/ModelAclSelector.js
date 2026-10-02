"use client";

import { useState, useMemo } from "react";
import PropTypes from "prop-types";
import { Button, Input } from "@/shared/components";
import { AI_PROVIDERS, getProviderAlias } from "@/shared/constants/providers";
import { getModelsByProviderId } from "@/shared/constants/models";

/**
 * Parses comma-separated or JSON string of rules into a normalized array of trimmed strings.
 */
function parseRules(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((s) => String(s).trim()).filter(Boolean);
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map((s) => String(s).trim()).filter(Boolean);
    } catch {}
    return value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

export default function ModelAclSelector({
  value = "*",
  onChange,
  activeProviders = [],
  combos = [],
  onOpenModelPicker,
}) {
  const [expandedProvider, setExpandedProvider] = useState(null);

  const currentRules = useMemo(() => parseRules(value), [value]);
  const isWildcard = currentRules.includes("*") || currentRules.length === 0;

  // Deduplicate and enrich active providers
  const providerGroups = useMemo(() => {
    const map = new Map();

    for (const conn of activeProviders) {
      if (conn?.isActive === false) continue;
      const providerId = conn.provider || conn.id;
      const alias = (
        conn.providerSpecificData?.prefix ||
        getProviderAlias(providerId) ||
        providerId
      ).trim();
      const displayName =
        conn.name ||
        AI_PROVIDERS[providerId]?.name ||
        conn.providerSpecificData?.nodeName ||
        providerId;

      if (!map.has(alias)) {
        // Resolve available models for this provider
        const staticModels = getModelsByProviderId(providerId) || [];
        const explicitModels = Array.isArray(conn.providerSpecificData?.enabledModels)
          ? conn.providerSpecificData.enabledModels
          : [];

        const availableModels = explicitModels.length > 0
          ? explicitModels.map((m) => (typeof m === "string" ? { id: m, name: m } : m))
          : staticModels;

        map.set(alias, {
          providerId,
          alias,
          displayName,
          color: AI_PROVIDERS[providerId]?.color,
          connections: [conn],
          models: availableModels,
        });
      } else {
        map.get(alias).connections.push(conn);
      }
    }

    return Array.from(map.values()).sort((a, b) =>
      a.displayName.localeCompare(b.displayName)
    );
  }, [activeProviders]);

  const handleToggleRule = (rule) => {
    if (!onChange) return;
    const r = rule.trim();
    if (!r) return;

    if (r === "*") {
      onChange("*");
      return;
    }

    // If currently wildcard '*', replace with the specific rule
    if (isWildcard) {
      onChange(r);
      return;
    }

    const exists = currentRules.some((item) => item.toLowerCase() === r.toLowerCase());
    let next;
    if (exists) {
      next = currentRules.filter((item) => item.toLowerCase() !== r.toLowerCase());
      if (next.length === 0) {
        onChange("*");
        return;
      }
    } else {
      next = [...currentRules.filter((item) => item !== "*"), r];
    }

    onChange(next.join(", "));
  };

  const handleRemoveRule = (rule) => {
    if (!onChange) return;
    const r = rule.trim().toLowerCase();
    const next = currentRules.filter((item) => item.toLowerCase() !== r);
    if (next.length === 0) {
      onChange("*");
    } else {
      onChange(next.join(", "));
    }
  };

  const isRuleActive = (rule) => {
    if (isWildcard && rule === "*") return true;
    if (isWildcard) return false;
    return currentRules.some((item) => item.toLowerCase() === rule.toLowerCase());
  };

  return (
    <div className="flex flex-col gap-3">
      {/* 1. Selected Access Tags Summary */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="block text-xs font-semibold text-text-main">
            Selected Model Permissions
          </label>
          <div className="flex items-center gap-1.5">
            {!isWildcard && (
              <button
                type="button"
                onClick={() => onChange("*")}
                className="text-[11px] text-primary hover:underline font-medium"
              >
                Reset to All Models (*)
              </button>
            )}
            {onOpenModelPicker && (
              <button
                type="button"
                onClick={onOpenModelPicker}
                className="text-[11px] text-primary hover:underline font-medium flex items-center gap-0.5 ml-2"
              >
                <span className="material-symbols-outlined text-[13px]">search</span>
                Search Catalog
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 p-2 rounded-lg border border-border bg-surface-2/60 min-h-[42px]">
          {isWildcard ? (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20">
              <span className="material-symbols-outlined text-[14px]">public</span>
              All Models Allowed (*)
            </span>
          ) : (
            currentRules.map((rule) => {
              const matchingProv = providerGroups.find(
                (p) => p.alias.toLowerCase() === rule.toLowerCase()
              );
              const matchingCombo = combos.find(
                (c) => c.name.toLowerCase() === rule.toLowerCase()
              );

              let badgeType = "Model";
              let icon = "token";
              let label = rule;

              if (matchingProv) {
                badgeType = "Provider";
                icon = "smart_toy";
                label = `${matchingProv.displayName} (${matchingProv.alias})`;
              } else if (matchingCombo) {
                badgeType = "Combo";
                icon = "layers";
                label = `Combo: ${matchingCombo.name}`;
              }

              return (
                <span
                  key={rule}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-primary/10 text-primary border border-primary/25"
                  title={`${badgeType}: ${rule}`}
                >
                  <span className="material-symbols-outlined text-[13px]">{icon}</span>
                  <span className="font-mono text-[11px]">{label}</span>
                  <button
                    type="button"
                    onClick={() => handleRemoveRule(rule)}
                    className="hover:text-red-500 rounded p-0.5 transition-colors"
                    title={`Remove ${rule}`}
                  >
                    <span className="material-symbols-outlined text-[12px] leading-none">
                      close
                    </span>
                  </button>
                </span>
              );
            })
          )}
        </div>
      </div>

      {/* 2. Connected Providers */}
      <div className="rounded-lg border border-border/70 bg-surface/50 p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5">
            <span className="material-symbols-outlined text-primary text-[16px]">
              smart_toy
            </span>
            <span className="text-xs font-semibold text-text-main">
              Connected Providers
            </span>
            <span className="text-[11px] px-1.5 py-0.2 rounded-full bg-surface-2 text-text-muted">
              {providerGroups.length}
            </span>
          </div>
          <span className="text-[10px] text-text-muted">
            Click to toggle whole provider access
          </span>
        </div>

        {providerGroups.length === 0 ? (
          <div className="p-3 text-center text-xs text-text-muted border border-dashed border-border rounded-md">
            No active providers connected yet.{" "}
            <a
              href="/dashboard/providers"
              className="text-primary hover:underline font-medium"
            >
              Add a provider
            </a>
          </div>
        ) : (
          <div className="flex flex-col gap-2 max-h-[180px] overflow-y-auto pr-1">
            {providerGroups.map((group) => {
              const isSelected = isRuleActive(group.alias);
              const isExpanded = expandedProvider === group.alias;
              const hasModels = group.models && group.models.length > 0;

              return (
                <div
                  key={group.alias}
                  className={`rounded-lg border transition-all ${
                    isSelected
                      ? "border-primary/50 bg-primary/[0.04]"
                      : "border-border bg-surface hover:border-border-hover"
                  }`}
                >
                  <div className="flex items-center justify-between p-2">
                    <button
                      type="button"
                      onClick={() => handleToggleRule(group.alias)}
                      className="flex items-center gap-2 text-left flex-1 min-w-0 mr-2"
                    >
                      <div
                        className={`size-2 rounded-full shrink-0 ${
                          isSelected ? "bg-primary" : "bg-emerald-500"
                        }`}
                      />
                      <div className="min-w-0">
                        <span className="text-xs font-medium text-text-main block truncate">
                          {group.displayName}
                        </span>
                        <span className="text-[10px] font-mono text-text-muted">
                          {group.alias}
                        </span>
                      </div>
                    </button>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleToggleRule(group.alias)}
                        className={`px-2 py-0.5 text-[11px] rounded font-medium transition-colors ${
                          isSelected
                            ? "bg-primary text-white"
                            : "bg-surface-2 text-text-muted hover:text-text-main hover:bg-surface-3"
                        }`}
                      >
                        {isSelected ? "Allowed (All)" : "Allow All"}
                      </button>

                      {hasModels && (
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedProvider(isExpanded ? null : group.alias)
                          }
                          className="p-1 rounded text-text-muted hover:text-text-main hover:bg-surface-2 transition-colors"
                          title={isExpanded ? "Collapse models" : "Select specific models"}
                        >
                          <span className="material-symbols-outlined text-[14px]">
                            {isExpanded ? "expand_less" : "expand_more"}
                          </span>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Sub-models dropdown */}
                  {isExpanded && hasModels && (
                    <div className="border-t border-border/50 bg-surface-2/30 p-2.5">
                      <div className="text-[10px] text-text-muted mb-1.5 font-medium">
                        Specific models for {group.displayName}:
                      </div>
                      <div className="flex flex-wrap gap-1.5 max-h-[120px] overflow-y-auto">
                        {group.models.map((m) => {
                          const modelId = m.id || m;
                          const modelName = m.name || modelId;
                          const isModelActive =
                            isRuleActive(modelId) || isRuleActive(`${group.alias}/${modelId}`);

                          return (
                            <button
                              key={modelId}
                              type="button"
                              onClick={() => handleToggleRule(modelId)}
                              className={`px-2 py-0.5 rounded text-[11px] font-mono border transition-all ${
                                isModelActive
                                  ? "bg-primary text-white border-primary"
                                  : "bg-surface border-border text-text-muted hover:text-text-main hover:border-primary/30"
                              }`}
                            >
                              {modelName}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 3. Connected Combos */}
      <div className="rounded-lg border border-border/70 bg-surface/50 p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5">
            <span className="material-symbols-outlined text-primary text-[16px]">
              layers
            </span>
            <span className="text-xs font-semibold text-text-main">
              Available Combos
            </span>
            <span className="text-[11px] px-1.5 py-0.2 rounded-full bg-surface-2 text-text-muted">
              {combos.length}
            </span>
          </div>
          <span className="text-[10px] text-text-muted">
            Click to toggle combo permission
          </span>
        </div>

        {combos.length === 0 ? (
          <div className="p-2.5 text-center text-xs text-text-muted border border-dashed border-border rounded-md">
            No combos created yet.{" "}
            <a
              href="/dashboard/combos"
              className="text-primary hover:underline font-medium"
            >
              Create a combo
            </a>
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5 max-h-[120px] overflow-y-auto pr-1">
            {combos.map((combo) => {
              const isSelected = isRuleActive(combo.name);
              const modelCount = Array.isArray(combo.models) ? combo.models.length : 0;

              return (
                <button
                  key={combo.id || combo.name}
                  type="button"
                  onClick={() => handleToggleRule(combo.name)}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-all flex items-center gap-1.5 ${
                    isSelected
                      ? "bg-primary text-white border-primary shadow-xs"
                      : "bg-surface border-border text-text-main hover:border-primary/40 hover:bg-primary/5"
                  }`}
                >
                  <span className="material-symbols-outlined text-[14px]">layers</span>
                  <span className="font-mono">{combo.name}</span>
                  <span
                    className={`text-[10px] px-1 rounded-full ${
                      isSelected ? "bg-white/20 text-white" : "bg-surface-2 text-text-muted"
                    }`}
                  >
                    {modelCount}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* 4. Manual Pattern Input & Helper */}
      <div className="pt-1">
        <label className="block text-[11px] font-medium text-text-muted mb-1">
          Custom Model Pattern (Comma-separated or Wildcard)
        </label>
        <Input
          value={value}
          onChange={(e) => onChange && onChange(e.target.value)}
          placeholder="*, deepseek, qwen, gpt-4*"
          className="font-mono text-xs"
        />
        <p className="text-[10px] text-text-muted mt-1">
          Use <code className="font-mono bg-surface-2 px-1 rounded">*</code> for all models, or patterns like <code className="font-mono bg-surface-2 px-1 rounded">gpt-4*</code>, <code className="font-mono bg-surface-2 px-1 rounded">deepseek</code>.
        </p>
      </div>
    </div>
  );
}

ModelAclSelector.propTypes = {
  value: PropTypes.oneOfType([PropTypes.string, PropTypes.array]),
  onChange: PropTypes.func.isRequired,
  activeProviders: PropTypes.array,
  combos: PropTypes.array,
  onOpenModelPicker: PropTypes.func,
};
