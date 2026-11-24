"use client";

// Per-API-key access control on the Endpoint page.
// "Restrict access" toggle per key; when on, the key may call only the listed
// combos/models and use only the allowed providers and accounts.
import { useState, useEffect, useMemo } from "react";
import PropTypes from "prop-types";
import { Toggle, ModelSelectModal, SegmentedControl } from "@/shared/components";
import { PROVIDER_DISPLAY } from "@/shared/constants/providersDisplay.js";
import { cn } from "@/shared/utils/cn";

export default function KeyAccessControls({ apiKey, onChange, onRequestRestrict }) {
  const access = apiKey.access || {
    restricted: false,
    allow: [],
    allowedProviders: [],
    allowedConnections: [],
  };
  const allow = access.allow || [];
  const allowedProviders = access.allowedProviders || [];
  const allowedConnections = access.allowedConnections || [];

  const [pickerOpen, setPickerOpen] = useState(false);
  const [activeProviders, setActiveProviders] = useState([]);
  const [modelAliases, setModelAliases] = useState({});
  const [nodeNames, setNodeNames] = useState({});
  const [loadingProviders, setLoadingProviders] = useState(false);
  const [isConfigOpen, setIsConfigOpen] = useState(false);

  // Load providers, model aliases, and provider nodes when restricted mode is active
  useEffect(() => {
    if (!access.restricted) return;
    if (activeProviders.length > 0) return;
    let cancelled = false;
    setLoadingProviders(true);
    Promise.all([
      fetch("/api/providers"),
      fetch("/api/models/alias"),
      fetch("/api/provider-nodes")
    ])
      .then(async ([providersRes, aliasRes, nodesRes]) => {
        if (cancelled) return;
        if (providersRes.ok) {
          const data = await providersRes.json();
          setActiveProviders(data.connections || []);
        }
        if (aliasRes.ok) {
          const data = await aliasRes.json();
          setModelAliases(data.aliases || {});
        }
        if (nodesRes?.ok) {
          const data = await nodesRes.json();
          const mapping = {};
          for (const n of data.nodes || []) {
            if (n.id && n.name) mapping[n.id] = n.name;
          }
          setNodeNames(mapping);
        }
      })
      .catch((error) => console.log("Error loading providers/aliases/nodes:", error))
      .finally(() => {
        if (!cancelled) setLoadingProviders(false);
      });
    return () => {
      cancelled = true;
    };
  }, [access.restricted, activeProviders.length]);

  const openPicker = async () => {
    setPickerOpen(true);
    if (activeProviders.length === 0) {
      try {
        const [providersRes, aliasRes, nodesRes] = await Promise.all([
          fetch("/api/providers"),
          fetch("/api/models/alias"),
          fetch("/api/provider-nodes")
        ]);
        if (providersRes.ok) setActiveProviders((await providersRes.json()).connections || []);
        if (aliasRes.ok) setModelAliases((await aliasRes.json()).aliases || {});
        if (nodesRes?.ok) {
          const data = await nodesRes.json();
          const mapping = {};
          for (const n of data.nodes || []) {
            if (n.id && n.name) mapping[n.id] = n.name;
          }
          setNodeNames(mapping);
        }
      } catch (error) {
        console.log("Error loading picker data:", error);
      }
    }
  };

  const updateAccess = (updates) => {
    onChange({
      restricted: true,
      allow: updates.allow !== undefined ? updates.allow : allow,
      allowedProviders: updates.allowedProviders !== undefined ? updates.allowedProviders : allowedProviders,
      allowedConnections: updates.allowedConnections !== undefined ? updates.allowedConnections : allowedConnections,
    });
  };

  const addModel = (model) => {
    const value = model?.value;
    if (value && !allow.some((e) => e.toLowerCase() === value.toLowerCase())) {
      updateAccess({ allow: [...allow, value] });
    }
  };

  const removeModel = (value) => {
    updateAccess({ allow: allow.filter((e) => e !== value) });
  };

  // Group connections by provider
  const providerGroups = useMemo(() => {
    const groups = new Map();
    for (const conn of activeProviders) {
      if (!conn?.provider) continue;
      const p = conn.provider;
      if (!groups.has(p)) {
        groups.set(p, []);
      }
      groups.get(p).push(conn);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [activeProviders]);

  const toggleProvider = (providerId) => {
    const isAllowed = allowedProviders.includes(providerId);
    const conns = providerGroups.find(([p]) => p === providerId)?.[1] || [];
    const connIds = conns.map((c) => c.id);

    if (isAllowed) {
      // Remove provider and its connections from allowlists
      updateAccess({
        allowedProviders: allowedProviders.filter((p) => p !== providerId),
        allowedConnections: allowedConnections.filter((id) => !connIds.includes(id)),
      });
    } else {
      // Add provider with default All Accounts (no connection filter)
      updateAccess({
        allowedProviders: [...allowedProviders, providerId],
        allowedConnections: allowedConnections.filter((id) => !connIds.includes(id)),
      });
    }
  };

  const setProviderAccountScope = (providerId, scope) => {
    const conns = providerGroups.find(([p]) => p === providerId)?.[1] || [];
    const connIds = conns.map((c) => c.id);

    if (scope === "all") {
      // Clear specific connections for this provider -> all allowed
      updateAccess({
        allowedConnections: allowedConnections.filter((id) => !connIds.includes(id)),
      });
    } else {
      // Switch to specific: start with all connections checked
      const existing = allowedConnections.filter((id) => connIds.includes(id));
      const newAllowed = existing.length > 0 ? existing : connIds;
      const otherAllowed = allowedConnections.filter((id) => !connIds.includes(id));
      updateAccess({
        allowedConnections: [...otherAllowed, ...newAllowed],
      });
    }
  };

  const toggleConnection = (providerId, connId) => {
    const conns = providerGroups.find(([p]) => p === providerId)?.[1] || [];
    const connIds = conns.map((c) => c.id);
    const selectedThisProvider = allowedConnections.filter((id) => connIds.includes(id));

    if (allowedConnections.includes(connId)) {
      if (selectedThisProvider.length <= 1) {
        // Don't uncheck the only selected connection
        return;
      }
      updateAccess({
        allowedConnections: allowedConnections.filter((id) => id !== connId),
      });
    } else {
      updateAccess({
        allowedConnections: [...allowedConnections, connId],
      });
    }
  };

  const isBlocked = allowedProviders.length === 0 && allow.length === 0;

  const summaryBadge = useMemo(() => {
    const pCount = allowedProviders.length;
    const mCount = allow.length;
    if (pCount === 0 && mCount === 0) {
      return "0 providers, 0 models allowed";
    }
    if (pCount > 0 && mCount === 0) {
      return `${pCount} provider${pCount > 1 ? "s" : ""}, all models allowed`;
    }
    if (pCount === 0 && mCount > 0) {
      return `All providers, ${mCount} model${mCount > 1 ? "s" : ""} allowed`;
    }
    return `${pCount} provider${pCount > 1 ? "s" : ""}, ${mCount} model${mCount > 1 ? "s" : ""} allowed`;
  }, [allowedProviders.length, allow.length]);

  return (
    <div className="mt-2" data-testid="key-access">
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <Toggle
          size="sm"
          checked={access.restricted}
          label="Restrict access"
          onChange={(checked) => {
            if (checked) {
              setIsConfigOpen(true);
              onRequestRestrict();
            } else {
              setIsConfigOpen(false);
              onChange({
                restricted: false,
                allow,
                allowedProviders,
                allowedConnections,
              });
            }
          }}
        />

        {access.restricted && (
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border",
                isBlocked
                  ? "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20"
                  : "bg-primary/10 text-primary border border-primary/20"
              )}
            >
              {summaryBadge}
            </span>
            <button
              type="button"
              onClick={() => setIsConfigOpen((prev) => !prev)}
              aria-expanded={isConfigOpen}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg border border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/5 text-text-main transition-colors select-none"
            >
              <span>Configure Access</span>
              <span
                className={cn(
                  "material-symbols-outlined text-[16px] text-text-muted transition-transform duration-200",
                  isConfigOpen ? "rotate-180" : ""
                )}
              >
                expand_more
              </span>
            </button>
          </div>
        )}
      </div>

      {access.restricted && isConfigOpen && (
        <div className="mt-3 space-y-4 rounded-xl border border-black/[0.08] dark:border-white/[0.08] bg-black/[0.01] dark:bg-white/[0.01] p-3.5">
          {/* Models & Combos Section */}
          <div className="rounded-xl border border-black/[0.06] bg-black/[0.02] p-3 dark:border-white/[0.06] dark:bg-white/[0.02]">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-text-main flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[16px] text-primary">model_training</span>
                Allowed Combos & Models
              </span>
              <button
                type="button"
                onClick={openPicker}
                className="flex items-center gap-1 rounded-lg border border-dashed border-primary/40 bg-primary/5 px-2 py-0.5 text-xs font-medium text-primary hover:bg-primary/10 transition-colors"
              >
                <span className="material-symbols-outlined text-[14px]">add</span>
                Add combo or model
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {allow.length === 0 && (
                <span className="text-xs text-text-muted italic">
                  {allowedProviders.length > 0
                    ? "All models from allowed providers are permitted."
                    : "No specific models or combos selected."}
                </span>
              )}
              {allow.map((entry) => (
                <span
                  key={entry}
                  className="flex items-center gap-1 rounded-lg border border-primary/30 bg-primary/10 px-2 py-0.5 font-mono text-xs text-text-main"
                >
                  {entry}
                  <button
                    type="button"
                    onClick={() => removeModel(entry)}
                    className="rounded text-text-muted hover:text-red-500"
                    title={`Remove ${entry}`}
                    aria-label={`Remove ${entry}`}
                  >
                    <span className="material-symbols-outlined leading-none text-[12px]">close</span>
                  </button>
                </span>
              ))}
            </div>
          </div>

          {/* Providers & Accounts Section */}
          <div className="rounded-xl border border-black/[0.06] bg-black/[0.02] p-3 dark:border-white/[0.06] dark:bg-white/[0.02]">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-text-main flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[16px] text-primary">hub</span>
                Allowed Providers & Accounts
              </span>
              <span className="text-[11px] text-text-muted">
                {allowedProviders.length === 0
                  ? "All providers allowed"
                  : `${allowedProviders.length} provider${allowedProviders.length > 1 ? "s" : ""} allowed`}
              </span>
            </div>

            {loadingProviders ? (
              <p className="text-xs text-text-muted py-2">Loading providers...</p>
            ) : providerGroups.length === 0 ? (
              <p className="text-xs text-text-muted py-1 italic">No active provider connections configured.</p>
            ) : (
              <div className="space-y-2 mt-2">
                {providerGroups.map(([providerId, conns]) => {
                  const isAllowed = allowedProviders.includes(providerId);
                  const providerName =
                    nodeNames[providerId] ||
                    conns[0]?.providerSpecificData?.nodeName ||
                    PROVIDER_DISPLAY[providerId]?.name ||
                    providerId;
                  const connIds = conns.map((c) => c.id);
                  const selectedThisProvider = allowedConnections.filter((id) => connIds.includes(id));
                  const isSpecific = selectedThisProvider.length > 0;

                  return (
                    <div
                      key={providerId}
                      className={`rounded-lg border transition-all ${
                        isAllowed
                          ? "border-primary/30 bg-surface dark:bg-surface-2"
                          : "border-black/[0.04] bg-surface/50 opacity-70 dark:border-white/[0.04]"
                      } p-2.5`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <label className="flex items-center gap-2 cursor-pointer select-none min-w-0">
                          <input
                            type="checkbox"
                            checked={isAllowed}
                            onChange={() => toggleProvider(providerId)}
                            className="h-3.5 w-3.5 rounded border-black/20 text-primary focus:ring-primary dark:border-white/20"
                          />
                          <span className="text-xs font-medium text-text-main truncate" title={providerName}>
                            {providerName}
                          </span>
                          <span
                            className="rounded bg-black/[0.05] dark:bg-white/[0.05] px-1.5 py-0.5 text-[10px] text-text-muted font-mono max-w-[140px] truncate"
                            title={providerId}
                          >
                            {providerId}
                          </span>
                        </label>
                        <span className="text-[11px] text-text-muted shrink-0">
                          {conns.length} account{conns.length > 1 ? "s" : ""}
                        </span>
                      </div>

                      {isAllowed && (
                        <div className="mt-2.5 pt-2 border-t border-black/[0.04] dark:border-white/[0.04] pl-5 space-y-2">
                          <div className="flex items-center gap-2">
                            <SegmentedControl
                              size="sm"
                              options={[
                                { label: "All Accounts", value: "all" },
                                {
                                  label: `Specific Accounts (${
                                    isSpecific ? selectedThisProvider.length : conns.length
                                  })`,
                                  value: "specific",
                                },
                              ]}
                              value={isSpecific ? "specific" : "all"}
                              onChange={(val) => setProviderAccountScope(providerId, val)}
                            />
                          </div>

                          {isSpecific && (
                            <div className="mt-2 space-y-1.5 pl-1">
                              {conns.map((conn) => {
                                const isConnChecked = allowedConnections.includes(conn.id);
                                return (
                                  <label
                                    key={conn.id}
                                    className="flex items-center gap-2 text-xs cursor-pointer select-none text-text-main hover:text-primary transition-colors"
                                  >
                                    <input
                                      type="checkbox"
                                      checked={isConnChecked}
                                      onChange={() => toggleConnection(providerId, conn.id)}
                                      className="h-3.5 w-3.5 rounded border-black/20 text-primary focus:ring-primary dark:border-white/20"
                                    />
                                    <span className="font-mono text-xs">{conn.name || conn.id}</span>
                                    {conn.email && conn.email !== conn.name && (
                                      <span className="text-[11px] text-text-muted truncate">
                                        ({conn.email})
                                      </span>
                                    )}
                                  </label>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {isBlocked && (
            <p className="text-xs text-orange-500 font-medium">
              No combos, models, or providers allowed — this key can call nothing.
            </p>
          )}
        </div>
      )}
      {pickerOpen && (
        <ModelSelectModal
          isOpen={pickerOpen}
          onClose={() => setPickerOpen(false)}
          onSelect={addModel}
          onDeselect={(model) =>
            removeModel(allow.find((e) => e.toLowerCase() === String(model?.value).toLowerCase()))
          }
          activeProviders={activeProviders}
          modelAliases={modelAliases}
          title={`Allowed for "${apiKey.name}"`}
          addedModelValues={allow}
          closeOnSelect={false}
        />
      )}
    </div>
  );
}

KeyAccessControls.propTypes = {
  apiKey: PropTypes.shape({
    id: PropTypes.string.isRequired,
    name: PropTypes.string,
    access: PropTypes.shape({
      restricted: PropTypes.bool,
      allow: PropTypes.arrayOf(PropTypes.string),
      allowedProviders: PropTypes.arrayOf(PropTypes.string),
      allowedConnections: PropTypes.arrayOf(PropTypes.string),
    }),
  }).isRequired,
  onChange: PropTypes.func.isRequired,
  onRequestRestrict: PropTypes.func.isRequired,
};
