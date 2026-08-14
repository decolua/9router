"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import PropTypes from "prop-types";
import { Card, Button, CardSkeleton, ConfirmModal, CapacityBadges, SegmentedControl } from "@/shared/components";
import ProviderIcon from "@/shared/components/ProviderIcon";
import { PROVIDER_MODELS, getModelKind } from "@/shared/constants/models";
import { getProviderAlias, getProviderByAlias } from "@/shared/constants/providers";
import { getCapabilitiesForModel } from "open-sse/providers/capabilities.js";
import { useModelCaps, invalidateModelCapsCache } from "@/shared/hooks/useModelCaps";
import { invalidatePricingCache } from "@/shared/hooks/usePricing";
import { resolveModelsDevProviderId } from "@/lib/modelsDev/providerMap.js";
import { formatModelMeta } from "@/shared/utils/modelMeta";
import EditModelModal from "./EditModelModal";

const inputClass =
  "w-full px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary";

export default function ModelsPage() {
  const [loading, setLoading] = useState(true);
  const [connections, setConnections] = useState([]);
  const [providerNodes, setProviderNodes] = useState([]);
  const [customModels, setCustomModels] = useState([]);
  const [disabledMap, setDisabledMap] = useState({});
  const [aliasByModel, setAliasByModel] = useState({});
  const [pricing, setPricing] = useState({});
  const [capsOverrides, setCapsOverrides] = useState({});
  const [modelsDev, setModelsDev] = useState(null);
  const [search, setSearch] = useState("");
  const [providerFilter, setProviderFilter] = useState("");
  const [scopeFilter, setScopeFilter] = useState("all"); // "all" | "active"
  const [collapsedGroups, setCollapsedGroups] = useState(() => new Set());
  const [editing, setEditing] = useState(null);
  const [confirmState, setConfirmState] = useState(null);
  const [mdAction, setMdAction] = useState({});
  const [refreshing, setRefreshing] = useState(false);
  const { getCaps } = useModelCaps();

  const fetchData = useCallback(async () => {
    try {
      const [customRes, disabledRes, aliasRes, pricingRes, capsRes, mdRes, provRes, nodesRes] = await Promise.all([
        fetch("/api/models/custom"),
        fetch("/api/models/disabled"),
        fetch("/api/models/alias"),
        fetch("/api/pricing"),
        fetch("/api/models/caps"),
        fetch("/api/models-dev"),
        fetch("/api/providers"),
        fetch("/api/provider-nodes"),
      ]);
      if (customRes.ok) {
        const data = await customRes.json();
        setCustomModels(data.models || []);
      }
      if (disabledRes.ok) {
        const data = await disabledRes.json();
        setDisabledMap(data.disabled || {});
      }
      if (aliasRes.ok) {
        const data = await aliasRes.json();
        const reversed = {};
        for (const [alias, model] of Object.entries(data.aliases || {})) reversed[model] = alias;
        setAliasByModel(reversed);
      }
      if (pricingRes.ok) setPricing(await pricingRes.json());
      if (capsRes.ok) {
        const data = await capsRes.json();
        setCapsOverrides(data.overrides || {});
      }
      if (mdRes.ok) setModelsDev(await mdRes.json());
      if (provRes.ok) {
        const data = await provRes.json();
        setConnections(data.connections || data.providers || (Array.isArray(data) ? data : []));
      }
      if (nodesRes.ok) {
        const data = await nodesRes.json();
        setProviderNodes(Array.isArray(data) ? data : data.nodes || []);
      }
    } catch (error) {
      console.log("Error fetching models data:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const getProviderInfo = useCallback((alias) => {
    // 1. Check providerNodes by id or prefix
    const node = providerNodes.find(
      (n) => n.id === alias || n.prefix === alias || n.data?.prefix === alias
    );
    if (node?.name) {
      return {
        providerId: node.id,
        name: node.name,
        iconId: node.id?.startsWith("anthropic") ? "anthropic" : "openai",
      };
    }

    // 2. Check connections by provider, id or prefix
    const conn = connections.find(
      (c) => c.provider === alias || c.id === alias || c.providerSpecificData?.prefix === alias
    );
    if (conn?.providerSpecificData?.nodeName) {
      return {
        providerId: conn.provider || alias,
        name: conn.providerSpecificData.nodeName,
        iconId: (conn.provider || "").startsWith("anthropic") ? "anthropic" : "openai",
      };
    }
    if (conn?.name && (alias.startsWith("openai-compatible") || alias.startsWith("anthropic-compatible") || alias.startsWith("custom-embedding"))) {
      return {
        providerId: conn.provider || alias,
        name: conn.name,
        iconId: (conn.provider || "").startsWith("anthropic") ? "anthropic" : "openai",
      };
    }

    // 3. Static registry
    const provider = getProviderByAlias(alias);
    if (provider) {
      return {
        providerId: provider.id || alias,
        name: provider.name || alias,
        iconId: provider.id || alias,
      };
    }

    // 4. Clean fallback for raw compatible IDs if no connection/node exists
    if (alias.startsWith("openai-compatible")) {
      return {
        providerId: alias,
        name: "OpenAI Compatible",
        iconId: "openai",
      };
    }
    if (alias.startsWith("anthropic-compatible")) {
      return {
        providerId: alias,
        name: "Anthropic Compatible",
        iconId: "anthropic",
      };
    }

    return {
      providerId: alias,
      name: alias,
      iconId: alias,
    };
  }, [providerNodes, connections]);

  // All LLM models grouped by provider alias (built-in + custom)
  const groups = useMemo(() => {
    const map = new Map();
    const ensure = (alias) => {
      if (!map.has(alias)) {
        const info = getProviderInfo(alias);
        map.set(alias, {
          key: alias,
          providerId: info.providerId,
          name: info.name,
          iconId: info.iconId,
          models: [],
        });
      }
      return map.get(alias);
    };

    for (const [providerId, models] of Object.entries(PROVIDER_MODELS)) {
      const alias = getProviderAlias(providerId);
      const group = ensure(alias);
      for (const m of models) {
        if (getModelKind(m, "llm") !== "llm") continue;
        group.models.push({
          key: `${alias}|${m.id}`,
          providerId,
          providerAlias: alias,
          id: m.id,
          name: m.name || m.id,
          isCustom: false,
        });
      }
    }

    for (const c of customModels) {
      if (c.type && c.type !== "llm") continue;
      const group = ensure(c.providerAlias);
      group.models.push({
        key: `${c.providerAlias}|${c.id}|custom`,
        providerId: group.providerId,
        providerAlias: c.providerAlias,
        id: c.id,
        name: c.name || c.id,
        isCustom: true,
      });
    }

    for (const group of map.values()) group.models.sort((a, b) => a.id.localeCompare(b.id));
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [customModels, getProviderInfo]);

  const catalogIds = useMemo(
    () => new Set((modelsDev?.providers || []).map((p) => p.id)),
    [modelsDev]
  );

  const getAliasFor = useCallback(
    (row) => aliasByModel[`${row.providerId}/${row.id}`] || aliasByModel[`${row.providerAlias}/${row.id}`] || "",
    [aliasByModel]
  );

  const isDisabled = useCallback(
    (row) =>
      (disabledMap[row.providerAlias] || []).includes(row.id) ||
      (row.providerId && (disabledMap[row.providerId] || []).includes(row.id)),
    [disabledMap]
  );

  const getPricingFor = useCallback(
    (row) =>
      pricing[row.providerAlias]?.[row.id] ||
      (row.providerId ? pricing[row.providerId]?.[row.id] : null) ||
      null,
    [pricing]
  );

  const activeProviderAliases = useMemo(() => {
    const set = new Set();
    for (const c of connections) {
      if (c.isActive !== false) {
        const alias = getProviderAlias(c.provider) || c.provider;
        if (alias) set.add(alias);
        if (c.provider) set.add(c.provider);
      }
    }
    return set;
  }, [connections]);

  const visibleGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    return groups
      .map((group) => {
        if (providerFilter && group.key !== providerFilter) return null;
        if (
          scopeFilter === "active" &&
          !activeProviderAliases.has(group.key) &&
          !activeProviderAliases.has(group.providerId)
        ) {
          return null;
        }
        const models = q
          ? group.models.filter(
              (m) =>
                m.id.toLowerCase().includes(q) ||
                m.name.toLowerCase().includes(q) ||
                getAliasFor(m).toLowerCase().includes(q)
            )
          : group.models;
        return models.length > 0 ? { ...group, models } : null;
      })
      .filter(Boolean);
  }, [groups, search, providerFilter, scopeFilter, activeProviderAliases, getAliasFor]);

  const toggleGroupCollapse = (key) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const allCollapsed = useMemo(() => {
    return visibleGroups.length > 0 && visibleGroups.every((g) => collapsedGroups.has(g.key));
  }, [visibleGroups, collapsedGroups]);

  const toggleAllCollapse = () => {
    if (allCollapsed) {
      setCollapsedGroups(new Set());
    } else {
      setCollapsedGroups(new Set(groups.map((g) => g.key)));
    }
  };

  const collapseAll = () => {
    setCollapsedGroups(new Set(groups.map((g) => g.key)));
  };

  const expandAll = () => {
    setCollapsedGroups(new Set());
  };

  const openEdit = (row) => {
    const staticCaps = getCapabilitiesForModel(row.isCustom ? row.providerAlias : row.providerId, row.id) || {};
    const effectiveCaps = getCaps(`${row.providerAlias}/${row.id}`) || {};
    const aliasKey = row.isCustom ? `${row.providerAlias}/${row.id}` : `${row.providerId}/${row.id}`;
    const override =
      capsOverrides[`${row.providerAlias}|${row.id}`] ||
      (row.providerId ? capsOverrides[`${row.providerId}|${row.id}`] : null) ||
      null;
    setEditing({
      ...row,
      aliasKey,
      alias: getAliasFor(row),
      staticCaps,
      caps: { ...staticCaps, ...effectiveCaps },
      override,
      pricing: getPricingFor(row),
    });
  };

  const handleToggleDisabled = async (row, disabled) => {
    try {
      if (disabled) {
        await fetch(
          `/api/models/disabled?providerAlias=${encodeURIComponent(row.providerAlias)}&id=${encodeURIComponent(row.id)}`,
          { method: "DELETE" }
        );
      } else {
        await fetch("/api/models/disabled", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ providerAlias: row.providerAlias, ids: [row.id] }),
        });
      }
      await fetchData();
    } catch (error) {
      console.log("Error toggling model:", error);
    }
  };

  const handleDeleteCustom = (row) => {
    setConfirmState({
      title: "Delete Custom Model",
      message: `Delete ${row.providerAlias}/${row.id}?`,
      onConfirm: async () => {
        setConfirmState(null);
        try {
          await fetch(
            `/api/models/custom?providerAlias=${encodeURIComponent(row.providerAlias)}&id=${encodeURIComponent(row.id)}&type=llm`,
            { method: "DELETE" }
          );
          globalThis.dispatchEvent(new Event("customModelChanged"));
          await fetchData();
        } catch (error) {
          console.log("Error deleting model:", error);
        }
      },
    });
  };

  const handleModelsDevImport = async (group) => {
    setMdAction((prev) => ({ ...prev, [group.key]: { loading: true } }));
    try {
      const res = await fetch("/api/models-dev/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: group.providerId || group.key }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMdAction((prev) => ({ ...prev, [group.key]: { error: data.error || "Import failed" } }));
      } else {
        setMdAction((prev) => ({
          ...prev,
          [group.key]: {
            message: `Imported ${data.pricing?.imported ?? 0} prices, ${data.caps?.imported ?? 0} capability sets`,
          },
        }));
        invalidateModelCapsCache();
        invalidatePricingCache();
        await fetchData();
      }
    } catch {
      setMdAction((prev) => ({ ...prev, [group.key]: { error: "Import failed" } }));
    }
  };

  const handleRefreshModelsDev = async () => {
    setRefreshing(true);
    try {
      await fetch("/api/models-dev/refresh", { method: "POST" });
      await fetchData();
    } catch (error) {
      console.log("Error refreshing models.dev:", error);
    } finally {
      setRefreshing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-6 px-1 sm:px-0">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-text-muted">
          All built-in and custom models across providers.
          {modelsDev ? (
            <>
              {" "}models.dev catalog: {modelsDev.providers.length} providers
              {modelsDev.fetchedAt ? `, updated ${new Date(modelsDev.fetchedAt).toLocaleString()}` : ""}
              {modelsDev.stale ? " (stale)" : ""}.
            </>
          ) : (
            " models.dev catalog is unavailable."
          )}
        </p>
        <Button
          variant="secondary"
          icon="refresh"
          onClick={handleRefreshModelsDev}
          disabled={refreshing}
          className="w-full sm:w-auto whitespace-nowrap"
        >
          {refreshing ? "Refreshing..." : "Refresh models.dev"}
        </Button>
      </div>

      {/* Search + scope filter + collapse toggle + provider filter */}
      <div className="flex flex-col gap-2.5">
        <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by model id, name or alias..."
            className={`${inputClass} flex-1`}
          />
          <div className="flex items-center gap-1.5 shrink-0">
            <SegmentedControl
              options={[
                { value: "all", label: "All" },
                { value: "active", label: "Active" },
              ]}
              value={scopeFilter}
              onChange={setScopeFilter}
              size="sm"
            />
            <button
              type="button"
              onClick={toggleAllCollapse}
              title={allCollapsed ? "Expand all" : "Collapse all"}
              aria-label={allCollapsed ? "Expand all" : "Collapse all"}
              className="inline-flex items-center justify-center h-8 w-8 rounded-[8px] bg-surface-2 hover:bg-surface text-text-muted hover:text-text-main transition-all border border-transparent hover:border-border cursor-pointer shadow-none hover:shadow-sm"
            >
              <span className="material-symbols-outlined text-[18px]">
                {allCollapsed ? "unfold_more" : "unfold_less"}
              </span>
            </button>
          </div>
          <select
            value={providerFilter}
            onChange={(e) => setProviderFilter(e.target.value)}
            className={`${inputClass} sm:w-56`}
          >
            <option value="">All providers</option>
            {groups.map((g) => (
              <option key={g.key} value={g.key}>
                {g.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center justify-between text-xs text-text-muted px-0.5">
          <span>
            {visibleGroups.reduce((acc, g) => acc + g.models.length, 0)} models · {visibleGroups.length} providers
          </span>
        </div>
      </div>

      {/* Groups */}
      {visibleGroups.length === 0 ? (
        <Card>
          <p className="text-center py-8 text-sm text-text-muted">No models found.</p>
        </Card>
      ) : (
        visibleGroups.map((group) => {
          const mdTarget = modelsDev
            ? resolveModelsDevProviderId(group.providerId, catalogIds) ||
              resolveModelsDevProviderId(group.key, catalogIds)
            : null;
          const action = mdAction[group.key];
          const isCollapsed = collapsedGroups.has(group.key);
          return (
            <Card key={group.key}>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <button
                  onClick={() => toggleGroupCollapse(group.key)}
                  className="flex items-center gap-2 min-w-0 text-left hover:opacity-80 transition-opacity flex-1 py-1 cursor-pointer"
                >
                  <span className="material-symbols-outlined text-lg text-text-muted">
                    {isCollapsed ? "chevron_right" : "expand_more"}
                  </span>
                  <ProviderIcon providerId={group.iconId || group.providerId} size={20} fallbackText={group.name.charAt(0)} />
                  <h3 className="font-semibold text-text-main truncate">{group.name}</h3>
                  <span className="text-xs text-text-muted px-1.5 py-0.5 rounded bg-surface-2">{group.models.length}</span>
                </button>
                {mdTarget && (
                  <Button
                    size="sm"
                    variant="secondary"
                    icon="download"
                    onClick={() => handleModelsDevImport(group)}
                    disabled={action?.loading}
                  >
                    {action?.loading ? "Importing..." : "Import from models.dev"}
                  </Button>
                )}
              </div>
              {action?.message && <p className="text-xs text-green-600 my-2">{action.message}</p>}
              {action?.error && <p className="text-xs text-red-500 my-2">{action.error}</p>}
              {!isCollapsed && (
                <div className="flex flex-col gap-1.5 mt-3">
                  {group.models.map((row) => (
                    <ModelRow
                      key={row.key}
                      row={row}
                      caps={getCaps(`${row.providerAlias}/${row.id}`)}
                      alias={getAliasFor(row)}
                      disabled={isDisabled(row)}
                      price={getPricingFor(row)}
                      onEdit={() => openEdit(row)}
                      onToggleDisabled={() => handleToggleDisabled(row, isDisabled(row))}
                      onDelete={row.isCustom ? () => handleDeleteCustom(row) : null}
                    />
                  ))}
                </div>
              )}
            </Card>
          );
        })
      )}

      {editing && (
        <EditModelModal
          isOpen={!!editing}
          onClose={() => setEditing(null)}
          model={editing}
          onSaved={fetchData}
        />
      )}

      <ConfirmModal
        isOpen={!!confirmState}
        onClose={() => setConfirmState(null)}
        onConfirm={confirmState?.onConfirm}
        title={confirmState?.title || ""}
        message={confirmState?.message || ""}
        confirmText="Delete"
      />
    </div>
  );
}

function ModelRow({ row, caps, alias, disabled, price, onEdit, onToggleDisabled, onDelete }) {
  const meta = formatModelMeta(caps, price);
  return (
    <div
      className={`flex items-center gap-3 px-3 py-2 rounded-lg border border-border-subtle hover:bg-sidebar/50 ${
        disabled ? "opacity-60" : ""
      }`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-text-main truncate">{alias || row.name}</span>
          {row.isCustom && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-semibold uppercase">
              Custom
            </span>
          )}
          {disabled && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-500/10 text-gray-500 font-semibold uppercase">
              Disabled
            </span>
          )}
          <CapacityBadges caps={caps} size={14} />
        </div>
        <p className="text-xs text-text-muted font-mono truncate">{row.id}</p>
        {meta && <p className="text-xs text-text-muted mt-0.5">{meta}</p>}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={onEdit}
          title="Edit model"
          className="p-1.5 hover:bg-sidebar rounded text-text-muted hover:text-primary"
        >
          <span className="material-symbols-outlined text-base">edit</span>
        </button>
        <button
          onClick={onToggleDisabled}
          title={disabled ? "Enable model" : "Disable model"}
          className="p-1.5 hover:bg-sidebar rounded text-text-muted hover:text-primary"
        >
          <span className="material-symbols-outlined text-base">
            {disabled ? "visibility" : "visibility_off"}
          </span>
        </button>
        {onDelete && (
          <button
            onClick={onDelete}
            title="Delete custom model"
            className="p-1.5 hover:bg-red-50 rounded text-red-500"
          >
            <span className="material-symbols-outlined text-base">delete</span>
          </button>
        )}
      </div>
    </div>
  );
}

ModelRow.propTypes = {
  row: PropTypes.shape({
    key: PropTypes.string,
    providerId: PropTypes.string,
    providerAlias: PropTypes.string,
    id: PropTypes.string,
    name: PropTypes.string,
    isCustom: PropTypes.bool,
  }).isRequired,
  caps: PropTypes.object,
  alias: PropTypes.string,
  disabled: PropTypes.bool,
  price: PropTypes.object,
  onEdit: PropTypes.func.isRequired,
  onToggleDisabled: PropTypes.func.isRequired,
  onDelete: PropTypes.func,
};
