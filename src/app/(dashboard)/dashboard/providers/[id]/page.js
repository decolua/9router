"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { Card, Button, Badge, Input, Modal, CardSkeleton, OAuthModal, KiroOAuthWrapper, CursorAuthModal, IFlowCookieModal, GitLabAuthModal, Toggle, Select, EditConnectionModal } from "@/shared/components";
import Pagination from "@/shared/components/Pagination";
import { OAUTH_PROVIDERS, APIKEY_PROVIDERS, FREE_PROVIDERS, FREE_TIER_PROVIDERS, WEB_COOKIE_PROVIDERS, getProviderAlias, isOpenAICompatibleProvider, isAnthropicCompatibleProvider, AI_PROVIDERS, THINKING_CONFIG } from "@/shared/constants/providers";
import { getModelsByProviderId } from "@/shared/constants/models";
import { getConnectionFilterStatus, normalizeConnectionFilterStatus, getConnectionCentralizedStatus, getConnectionProviderCooldownUntil } from "@/lib/connectionStatus";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { fetchSuggestedModels } from "@/shared/utils/providerModelsFetcher";
import ModelRow from "./ModelRow";
import PassthroughModelsSection from "./PassthroughModelsSection";
import CompatibleModelsSection from "./CompatibleModelsSection";
import ConnectionRow from "./ConnectionRow";
import AddApiKeyModal from "./AddApiKeyModal";
import EditCompatibleNodeModal from "./EditCompatibleNodeModal";
import AddCustomModelModal from "./AddCustomModelModal";

export default function ProviderDetailPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const providerId = params.id;
  const [connections, setConnections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [providerNode, setProviderNode] = useState(null);
  const [proxyPools, setProxyPools] = useState([]);
  const [showOAuthModal, setShowOAuthModal] = useState(false);
  const [showIFlowCookieModal, setShowIFlowCookieModal] = useState(false);
  const [showAddApiKeyModal, setShowAddApiKeyModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showEditNodeModal, setShowEditNodeModal] = useState(false);
  const [showBulkProxyModal, setShowBulkProxyModal] = useState(false);
  const [selectedConnection, setSelectedConnection] = useState(null);
  const [modelAliases, setModelAliases] = useState({});
  const [headerImgError, setHeaderImgError] = useState(false);
  const [modelTestResults, setModelTestResults] = useState({});
  const [modelsTestError, setModelsTestError] = useState("");
  const [testingModelId, setTestingModelId] = useState(null);
  const [showAddCustomModel, setShowAddCustomModel] = useState(false);
  const [selectedConnectionIds, setSelectedConnectionIds] = useState([]);
  const [bulkProxyPoolId, setBulkProxyPoolId] = useState("__none__");
  const [bulkUpdatingProxy, setBulkUpdatingProxy] = useState(false);
  const [providerStrategy, setProviderStrategy] = useState(null); // null = use global, "round-robin" = override
  const [providerStickyLimit, setProviderStickyLimit] = useState("");
  const [thinkingMode, setThinkingMode] = useState("auto");
  const [suggestedModels, setSuggestedModels] = useState([]);
  const [kiloFreeModels, setKiloFreeModels] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const { copied, copy } = useCopyToClipboard();
  const searchQuery = searchParams.get("searchQuery") || "";
  const rawStatusFilter = searchParams.get("statusFilter");
  const statusFilter = normalizeConnectionFilterStatus(rawStatusFilter || "all");

  const providerInfo = providerNode
    ? {
        id: providerNode.id,
        name: providerNode.name || (providerNode.type === "anthropic-compatible" ? "Anthropic Compatible" : "OpenAI Compatible"),
        color: providerNode.type === "anthropic-compatible" ? "#D97757" : "#10A37F",
        textIcon: providerNode.type === "anthropic-compatible" ? "AC" : "OC",
        apiType: providerNode.apiType,
        baseUrl: providerNode.baseUrl,
        type: providerNode.type,
      }
    : (OAUTH_PROVIDERS[providerId] || APIKEY_PROVIDERS[providerId] || FREE_PROVIDERS[providerId] || FREE_TIER_PROVIDERS[providerId] || WEB_COOKIE_PROVIDERS[providerId]);
  const isOAuth = !!OAUTH_PROVIDERS[providerId] || !!FREE_PROVIDERS[providerId];
  const isFreeNoAuth = !!FREE_PROVIDERS[providerId]?.noAuth;
  const models = getModelsByProviderId(providerId);
  const providerAlias = getProviderAlias(providerId);
  
  const isOpenAICompatible = isOpenAICompatibleProvider(providerId);
  const isAnthropicCompatible = isAnthropicCompatibleProvider(providerId);
  const isCompatible = isOpenAICompatible || isAnthropicCompatible;
  const thinkingConfig = AI_PROVIDERS[providerId]?.thinkingConfig || THINKING_CONFIG.extended;
  
  const providerStorageAlias = isCompatible ? providerId : providerAlias;
  const providerDisplayAlias = isCompatible
    ? (providerNode?.prefix || providerId)
    : providerAlias;

  const updateQueryParams = useCallback((updates) => {
    const params = new URLSearchParams(searchParams.toString());

    Object.entries(updates).forEach(([key, value]) => {
      if (value === undefined || value === null || value === "") {
        params.delete(key);
      } else {
        params.set(key, value);
      }
    });

    const query = params.toString();
    router.replace(
      query ? `/dashboard/providers/${providerId}?${query}` : `/dashboard/providers/${providerId}`,
      { scroll: false },
    );
  }, [providerId, router, searchParams]);

  useEffect(() => {
    if (!rawStatusFilter) return;

    const normalizedStatusFilter = normalizeConnectionFilterStatus(rawStatusFilter);
    if (normalizedStatusFilter === rawStatusFilter) return;

    updateQueryParams({
      statusFilter: normalizedStatusFilter === "all" ? null : normalizedStatusFilter,
    });
  }, [rawStatusFilter, updateQueryParams]);

  const filteredConnections = useMemo(() => {
    let result = connections;

    if (statusFilter !== "all") {
      result = result.filter(connection => {
        const filterStatus = getConnectionFilterStatus(connection);
        return filterStatus === statusFilter;
      });
    }

    const query = searchQuery.trim().toLowerCase();
    if (!query) return result;

    return result.filter((connection) => {
      const searchableValues = [
        connection.provider,
        connection.name,
        connection.displayName,
        connection.email,
        connection.connectionName,
        connection.id,
      ]
        .filter(Boolean)
        .map((value) => String(value).toLowerCase());

      return searchableValues.some((value) => value.includes(query));
    });
  }, [connections, searchQuery, statusFilter]);

  const quotaSummary = useMemo(() => {
    if (connections.length === 0) {
      return {
        eligible: 0,
        exhausted: 0,
        blocked: 0,
        disabled: 0,
        unknown: 0,
        nextResetAt: null,
      };
    }

    const summary = {
      eligible: 0,
      exhausted: 0,
      blocked: 0,
      disabled: 0,
      unknown: 0,
      nextResetAt: null,
    };

    for (const connection of connections) {
      const status = getConnectionCentralizedStatus(connection);
      const cooldownUntil = getConnectionProviderCooldownUntil(connection);

      switch (status) {
        case "eligible":
        case "exhausted":
        case "blocked":
        case "disabled":
        case "unknown":
          summary[status] += 1;
          break;
        default:
          summary.unknown += 1;
          break;
      }

      if (
        status === "exhausted"
        && cooldownUntil
        && (!summary.nextResetAt || cooldownUntil < summary.nextResetAt)
      ) {
        summary.nextResetAt = cooldownUntil;
      }
    }

    return summary;
  }, [connections]);

  const quotaSummaryItems = useMemo(() => ([
    {
      key: "eligible",
      label: "Eligible",
      value: quotaSummary.eligible,
      tone: "text-emerald-600 dark:text-emerald-400",
    },
    {
      key: "exhausted",
      label: "Exhausted",
      value: quotaSummary.exhausted,
      tone: "text-amber-600 dark:text-amber-400",
    },
    {
      key: "blocked",
      label: "Blocked",
      value: quotaSummary.blocked,
      tone: "text-rose-600 dark:text-rose-400",
    },
    {
      key: "disabled",
      label: "Disabled",
      value: quotaSummary.disabled,
      tone: "text-text-muted",
    },
    {
      key: "unknown",
      label: "Unknown",
      value: quotaSummary.unknown,
      tone: "text-text-muted",
    },
  ]), [quotaSummary]);

  const totalConnections = filteredConnections.length;
  const totalPages = Math.max(1, Math.ceil(totalConnections / pageSize));

  const visibleCurrentPage = Math.min(currentPage, totalPages);

  const paginatedConnections = useMemo(() => {
    const start = (visibleCurrentPage - 1) * pageSize;
    return filteredConnections.slice(start, start + pageSize);
  }, [filteredConnections, pageSize, visibleCurrentPage]);

  const connectionIndexMap = useMemo(
    () => new Map(connections.map((connection, index) => [connection.id, index])),
    [connections]
  );

  const filteredConnectionIndexMap = useMemo(
    () => new Map(filteredConnections.map((connection, index) => [connection.id, index])),
    [filteredConnections]
  );

  const normalizedSelectedConnectionIds = useMemo(
    () => selectedConnectionIds.filter((id) => connections.some((conn) => conn.id === id)),
    [connections, selectedConnectionIds]
  );

  // Define callbacks BEFORE the useEffect that uses them
  const fetchAliases = useCallback(async () => {
    try {
      const res = await fetch("/api/models/alias");
      const data = await res.json();
      if (res.ok) {
        setModelAliases(data.aliases || {});
      }
    } catch (error) {
      console.log("Error fetching aliases:", error);
    }
  }, []);

  // Fetch free models from Kilo API for kilocode provider
  useEffect(() => {
    if (providerId !== "kilocode") return;
    fetch("/api/providers/kilo/free-models")
      .then((res) => res.json())
      .then((data) => { if (data.models?.length) setKiloFreeModels(data.models); })
      .catch(() => {});
  }, [providerId]);

  const fetchConnections = useCallback(async () => {
    try {
      const [connectionsRes, nodesRes, proxyPoolsRes, settingsRes] = await Promise.all([
        fetch("/api/providers", { cache: "no-store" }),
        fetch("/api/provider-nodes", { cache: "no-store" }),
        fetch("/api/proxy-pools?isActive=true", { cache: "no-store" }),
        fetch("/api/settings", { cache: "no-store" }),
      ]);
      const connectionsData = await connectionsRes.json();
      const nodesData = await nodesRes.json();
      const proxyPoolsData = await proxyPoolsRes.json();
      const settingsData = settingsRes.ok ? await settingsRes.json() : {};
      if (connectionsRes.ok) {
        const filtered = (connectionsData.connections || []).filter(c => c.provider === providerId);
        setConnections(filtered);
      }
      if (proxyPoolsRes.ok) {
        setProxyPools(proxyPoolsData.proxyPools || []);
      }
      // Load per-provider strategy override
      const override = (settingsData.providerStrategies || {})[providerId] || {};
      setProviderStrategy(override.fallbackStrategy || null);
      setProviderStickyLimit(override.stickyRoundRobinLimit != null ? String(override.stickyRoundRobinLimit) : "1");
      // Load per-provider thinking config
      const thinkingCfg = (settingsData.providerThinking || {})[providerId] || {};
      setThinkingMode(thinkingCfg.mode || "auto");
      if (nodesRes.ok) {
        let node = (nodesData.nodes || []).find((entry) => entry.id === providerId) || null;

        // Newly created compatible nodes can be briefly unavailable on one worker.
        // Retry a few times before showing "Provider not found".
        if (!node && isCompatible) {
          for (let attempt = 0; attempt < 3; attempt += 1) {
            await new Promise((resolve) => setTimeout(resolve, 150));
            const retryRes = await fetch("/api/provider-nodes", { cache: "no-store" });
            if (!retryRes.ok) continue;
            const retryData = await retryRes.json();
            node = (retryData.nodes || []).find((entry) => entry.id === providerId) || null;
            if (node) break;
          }
        }

        setProviderNode(node);
      }
    } catch (error) {
      console.log("Error fetching connections:", error);
    } finally {
      setLoading(false);
    }
  }, [providerId, isCompatible]);

  const handleUpdateNode = async (formData) => {
    try {
      const res = await fetch(`/api/provider-nodes/${providerId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      const data = await res.json();
      if (res.ok) {
        setProviderNode(data.node);
        await fetchConnections();
        setShowEditNodeModal(false);
      }
    } catch (error) {
      console.log("Error updating provider node:", error);
    }
  };

  const saveProviderStrategy = async (strategy, stickyLimit) => {
    try {
      const settingsRes = await fetch("/api/settings", { cache: "no-store" });
      const settingsData = settingsRes.ok ? await settingsRes.json() : {};
      const current = settingsData.providerStrategies || {};

      // Build override: null strategy means remove override, use global
      const override = {};
      if (strategy) override.fallbackStrategy = strategy;
      if (strategy === "round-robin" && stickyLimit !== "") {
        override.stickyRoundRobinLimit = Number(stickyLimit) || 3;
      }

      const updated = { ...current };
      if (Object.keys(override).length === 0) {
        delete updated[providerId];
      } else {
        updated[providerId] = override;
      }

      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerStrategies: updated }),
      });
    } catch (error) {
      console.log("Error saving provider strategy:", error);
    }
  };

  const handleRoundRobinToggle = (enabled) => {
    const strategy = enabled ? "round-robin" : null;
    const sticky = enabled ? (providerStickyLimit || "1") : providerStickyLimit;
    if (enabled && !providerStickyLimit) setProviderStickyLimit("1");
    setProviderStrategy(strategy);
    saveProviderStrategy(strategy, sticky);
  };

  const handleStickyLimitChange = (value) => {
    setProviderStickyLimit(value);
    saveProviderStrategy("round-robin", value);
  };

  const saveThinkingConfig = async (mode) => {
    try {
      const settingsRes = await fetch("/api/settings", { cache: "no-store" });
      const settingsData = settingsRes.ok ? await settingsRes.json() : {};
      const current = settingsData.providerThinking || {};
      const updated = { ...current };
      if (!mode || mode === "auto") {
        delete updated[providerId];
      } else {
        updated[providerId] = { mode };
      }
      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerThinking: updated }),
      });
    } catch (error) {
      console.log("Error saving thinking config:", error);
    }
  };

  const handleThinkingModeChange = (mode) => {
    setThinkingMode(mode);
    saveThinkingConfig(mode);
  };

  useEffect(() => {
    void Promise.resolve().then(() => {
      fetchConnections();
      fetchAliases();
    });
  }, [fetchConnections, fetchAliases]);

  // Fetch suggested models from provider's public API (if configured)
  useEffect(() => {
    const fetcher = (OAUTH_PROVIDERS[providerId] || APIKEY_PROVIDERS[providerId] || FREE_PROVIDERS[providerId] || FREE_TIER_PROVIDERS[providerId])?.modelsFetcher;
    if (!fetcher) return;
    fetchSuggestedModels(fetcher).then(setSuggestedModels);
  }, [providerId]);

  const handleSetAlias = async (modelId, alias, providerAliasOverride = providerAlias) => {
    const fullModel = `${providerAliasOverride}/${modelId}`;
    try {
      const res = await fetch("/api/models/alias", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: fullModel, alias }),
      });
      if (res.ok) {
        await fetchAliases();
      } else {
        const data = await res.json();
        alert(data.error || "Failed to set alias");
      }
    } catch (error) {
      console.log("Error setting alias:", error);
    }
  };

  const handleDeleteAlias = async (alias) => {
    try {
      const res = await fetch(`/api/models/alias?alias=${encodeURIComponent(alias)}`, {
        method: "DELETE",
      });
      if (res.ok) {
        await fetchAliases();
      }
    } catch (error) {
      console.log("Error deleting alias:", error);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm("Delete this connection?")) return;
    try {
      const res = await fetch(`/api/providers/${id}`, { method: "DELETE" });
      if (res.ok) {
        setConnections(connections.filter(c => c.id !== id));
      }
    } catch (error) {
      console.log("Error deleting connection:", error);
    }
  };

  const handleOAuthSuccess = () => {
    fetchConnections();
    setShowOAuthModal(false);
  };

  const handleIFlowCookieSuccess = () => {
    fetchConnections();
    setShowIFlowCookieModal(false);
  };

  const handleSaveApiKey = async (formData) => {
    try {
      const res = await fetch("/api/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: providerId, ...formData }),
      });
      if (res.ok) {
        await fetchConnections();
        setShowAddApiKeyModal(false);
      }
    } catch (error) {
      console.log("Error saving connection:", error);
    }
  };

  const handleUpdateConnection = async (formData) => {
    try {
      const res = await fetch(`/api/providers/${selectedConnection.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      if (res.ok) {
        await fetchConnections();
        setShowEditModal(false);
      }
    } catch (error) {
      console.log("Error updating connection:", error);
    }
  };

  const handleUpdateConnectionStatus = async (id, isActive) => {
    try {
      const res = await fetch(`/api/providers/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive }),
      });
      if (res.ok) {
        setConnections(prev => prev.map(c => c.id === id ? { ...c, isActive } : c));
      }
    } catch (error) {
      console.log("Error updating connection status:", error);
    }
  };

  const handleSwapPriority = async (connectionId1, connectionId2) => {
    if (!connectionId1 || !connectionId2) return;

    const index1 = connectionIndexMap.get(connectionId1);
    const index2 = connectionIndexMap.get(connectionId2);
    if (index1 == null || index2 == null || index1 === index2) return;

    // Optimistic update state
    const newConnections = [...connections];
    [newConnections[index1], newConnections[index2]] = [newConnections[index2], newConnections[index1]];
    setConnections(newConnections);

    try {
      await Promise.all([
        fetch(`/api/providers/${newConnections[index1].id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ priority: index1 }),
        }),
        fetch(`/api/providers/${newConnections[index2].id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ priority: index2 }),
        }),
      ]);
    } catch (error) {
      console.log("Error swapping priority:", error);
      await fetchConnections();
    }
  };

  const selectedConnections = connections.filter((conn) => normalizedSelectedConnectionIds.includes(conn.id));
  const allSelected = connections.length > 0 && normalizedSelectedConnectionIds.length === connections.length;

  const toggleSelectConnection = (connectionId) => {
    setSelectedConnectionIds((prev) => (
      prev.includes(connectionId)
        ? prev.filter((id) => id !== connectionId)
        : [...prev, connectionId]
    ));
  };

  const toggleSelectAllConnections = () => {
    if (allSelected) {
      setSelectedConnectionIds([]);
      return;
    }
    setSelectedConnectionIds(connections.map((conn) => conn.id));
  };

  const clearSelection = () => {
    setSelectedConnectionIds([]);
    setBulkProxyPoolId("__none__");
  };

  const selectedProxySummary = (() => {
    if (selectedConnections.length === 0) return "";
    const poolIds = new Set(selectedConnections.map((conn) => conn.providerSpecificData?.proxyPoolId || "__none__"));
    if (poolIds.size === 1) {
      const onlyId = [...poolIds][0];
      if (onlyId === "__none__") return "All selected currently unbound";
      const pool = proxyPools.find((p) => p.id === onlyId);
      return `All selected currently bound to ${pool?.name || onlyId}`;
    }
    return "Selected connections have mixed proxy bindings";
  })();

  const openBulkProxyModal = () => {
    if (selectedConnections.length === 0) return;
    const uniquePoolIds = [...new Set(selectedConnections.map((conn) => conn.providerSpecificData?.proxyPoolId || "__none__"))];
    setBulkProxyPoolId(uniquePoolIds.length === 1 ? uniquePoolIds[0] : "__none__");
    setShowBulkProxyModal(true);
  };

  const closeBulkProxyModal = () => {
    if (bulkUpdatingProxy) return;
    setShowBulkProxyModal(false);
  };

  const handleBulkApplyProxyPool = async () => {
    if (selectedConnectionIds.length === 0) return;

    const proxyPoolId = bulkProxyPoolId === "__none__" ? null : bulkProxyPoolId;
    setBulkUpdatingProxy(true);
    try {
      const results = [];
      for (const connectionId of selectedConnectionIds) {
        try {
          const res = await fetch(`/api/providers/${connectionId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ proxyPoolId }),
          });
          results.push(res.ok);
        } catch (e) {
          console.log("Error applying bulk proxy pool for", connectionId, e);
          results.push(false);
        }
      }

      const failedCount = results.filter((ok) => !ok).length;
      if (failedCount > 0) {
        alert(`Updated with ${failedCount} failed request(s).`);
      }

      await fetchConnections();
      clearSelection();
      setShowBulkProxyModal(false);
    } catch (error) {
      console.log("Error applying bulk proxy pool:", error);
    } finally {
      setBulkUpdatingProxy(false);
    }
  };


  const isSelected = (connectionId) => selectedConnectionIds.includes(connectionId);
  const handleSearchChange = (value) => {
    setCurrentPage(1);
    updateQueryParams({ searchQuery: value.trim() ? value : null });
  };

  const handleStatusFilterChange = (e) => {
    const nextValue = normalizeConnectionFilterStatus(e.target.value);
    setCurrentPage(1);
    updateQueryParams({ statusFilter: nextValue === "all" ? null : nextValue });
  };

  const connectionsList = (
    <div className="flex flex-col gap-4">
      <div className="rounded-2xl border border-black/5 dark:border-white/10 bg-white/70 dark:bg-white/5 backdrop-blur-sm shadow-sm px-4 py-4 space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="text-base font-semibold text-text-primary">Connections</h3>
            <p className="mt-1 text-sm text-text-muted">
              Search, reorder, and manage saved accounts for this provider.
            </p>
          </div>
          <div className="text-sm text-text-muted">
            {totalConnections === 0
              ? "No matching connections"
              : `${totalConnections} matching connection${totalConnections === 1 ? "" : "s"}`}
          </div>
        </div>

        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto_auto] lg:items-end">
          <Input
            label="Search connections"
            icon="search"
            value={searchQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="Search by name, email, provider, or id"
            className="min-w-0"
          />

          <Select
            label="Status filter"
            value={statusFilter}
            onChange={handleStatusFilterChange}
            options={[
              { value: "all", label: "All statuses" },
              { value: "eligible", label: "Eligible" },
              { value: "exhausted", label: "Exhausted" },
              { value: "blocked", label: "Blocked" },
              { value: "disabled", label: "Disabled" },
              { value: "unknown", label: "Unknown" },
            ]}
          />

          <div className="flex items-center gap-2 rounded-2xl border border-dashed border-black/10 dark:border-white/10 bg-surface px-3 py-2.5 text-xs text-text-muted h-[40px]">
            <span className="material-symbols-outlined text-[16px] text-primary">info</span>
            <span>Use the arrows in each row to reorder visible results.</span>
          </div>
        </div>
      </div>

      <div className="flex flex-col divide-y divide-black/[0.03] dark:divide-white/[0.03] rounded-xl border border-black/5 dark:border-white/5 overflow-hidden bg-surface">
        {paginatedConnections.map((conn) => {
          const filteredIndex = filteredConnectionIndexMap.get(conn.id) ?? 0;
          const previousConnection = filteredConnections[filteredIndex - 1] || null;
          const nextConnection = filteredConnections[filteredIndex + 1] || null;

          return (
            <div key={conn.id} className="flex items-stretch bg-surface">
              <div className="flex-1 min-w-0">
                <ConnectionRow
                  connection={conn}
                  proxyPools={proxyPools}
                  isOAuth={isOAuth}
                  isFirst={filteredIndex === 0}
                  isLast={filteredIndex === filteredConnections.length - 1}
                  onMoveUp={() => handleSwapPriority(conn.id, previousConnection?.id)}
                  onMoveDown={() => handleSwapPriority(conn.id, nextConnection?.id)}
                  onToggleActive={(isActive) => handleUpdateConnectionStatus(conn.id, isActive)}
                  onUpdateProxy={async (proxyPoolId) => {
                    try {
                      const res = await fetch(`/api/providers/${conn.id}`, {
                        method: "PUT",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ proxyPoolId: proxyPoolId || null }),
                      });
                      if (res.ok) {
                        setConnections(prev => prev.map(c =>
                          c.id === conn.id
                            ? { ...c, providerSpecificData: { ...c.providerSpecificData, proxyPoolId: proxyPoolId || null } }
                            : c
                        ));
                      }
                    } catch (error) {
                      console.log("Error updating proxy:", error);
                    }
                  }}
                  onEdit={() => {
                    setSelectedConnection(conn);
                    setShowEditModal(true);
                  }}
                  onDelete={() => handleDelete(conn.id)}
                />
              </div>
            </div>
          );
        })}
      </div>

      {totalConnections > 0 && (
        <Pagination
          currentPage={visibleCurrentPage}
          pageSize={pageSize}
          totalItems={totalConnections}
          onPageChange={(page) => setCurrentPage(Math.max(1, Math.min(page, totalPages)))}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setCurrentPage(1);
          }}
        />
      )}
    </div>
  );

  const bulkProxyOptions = [
    { value: "__none__", label: "None" },
    ...proxyPools.map((pool) => ({ value: pool.id, label: pool.name })),
  ];

  const bulkHint = selectedConnectionIds.length === 0
    ? "Select one or more connections, then click Proxy Action."
    : selectedProxySummary;

  const canApplyBulkProxy = selectedConnectionIds.length > 0 && !bulkUpdatingProxy;

  const bulkActionModal = (
    <Modal
      isOpen={showBulkProxyModal}
      onClose={closeBulkProxyModal}
      title={`Proxy Action (${selectedConnectionIds.length} selected)`}
    >
      <div className="flex flex-col gap-4">
        <Select
          label="Proxy Pool"
          value={bulkProxyPoolId}
          onChange={(e) => setBulkProxyPoolId(e.target.value)}
          options={bulkProxyOptions}
          placeholder="None"
        />

        <p className="text-xs text-text-muted">{bulkHint}</p>
        <p className="text-xs text-text-muted">Selecting None will unbind selected connections from proxy pool.</p>

        <div className="flex gap-2">
          <Button onClick={handleBulkApplyProxyPool} fullWidth disabled={!canApplyBulkProxy}>
            {bulkUpdatingProxy ? "Applying..." : "Apply"}
          </Button>
          <Button onClick={closeBulkProxyModal} variant="ghost" fullWidth disabled={bulkUpdatingProxy}>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );

  const handleTestModel = async (modelId) => {
    if (testingModelId) return;
    setTestingModelId(modelId);
    try {
      const res = await fetch("/api/models/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: `${providerStorageAlias}/${modelId}` }),
      });
      const data = await res.json();
      setModelTestResults((prev) => ({ ...prev, [modelId]: data.ok ? "ok" : "error" }));
      setModelsTestError(data.ok ? "" : (data.error || "Model not reachable"));
    } catch {
      setModelTestResults((prev) => ({ ...prev, [modelId]: "error" }));
      setModelsTestError("Network error");
    } finally {
      setTestingModelId(null);
    }
  };

  const renderModelsSection = () => {
    if (isCompatible) {
      return (
        <CompatibleModelsSection
          providerStorageAlias={providerStorageAlias}
          providerDisplayAlias={providerDisplayAlias}
          modelAliases={modelAliases}
          copied={copied}
          onCopy={copy}
          onSetAlias={handleSetAlias}
          onDeleteAlias={handleDeleteAlias}
          connections={connections}
          isAnthropic={isAnthropicCompatible}
        />
      );
    }
    // Combine hardcoded models with Kilo free models (deduplicated)
    // Exclude non-llm models (embedding, tts, etc.) — they have dedicated pages under media-providers
    const displayModels = [
      ...models,
      ...kiloFreeModels.filter((fm) => !models.some((m) => m.id === fm.id)),
    ].filter((m) => !m.type || m.type === "llm");
    // Custom models added by user (stored as aliases: modelId → providerAlias/modelId)
    const customModels = Object.entries(modelAliases)
      .filter(([alias, fullModel]) => {
        const prefix = `${providerStorageAlias}/`;
        if (!fullModel.startsWith(prefix)) return false;
        const modelId = fullModel.slice(prefix.length);
        // Only show if not already in hardcoded list
        // For passthroughModels, include all aliases (model IDs may contain slashes like "anthropic/claude-3")
        if (providerInfo.passthroughModels) return !models.some((m) => m.id === modelId);
        return !models.some((m) => m.id === modelId) && alias === modelId;
      })
      .map(([alias, fullModel]) => ({
        id: fullModel.slice(`${providerStorageAlias}/`.length),
        alias,
        fullModel,
      }));

    return (
      <div className="flex flex-wrap gap-3">
        {displayModels.map((model) => {
          const fullModel = `${providerStorageAlias}/${model.id}`;
          const oldFormatModel = `${providerId}/${model.id}`;
          const existingAlias = Object.entries(modelAliases).find(
            ([, m]) => m === fullModel || m === oldFormatModel
          )?.[0];
          return (
            <ModelRow
              key={model.id}
              model={model}
              fullModel={`${providerDisplayAlias}/${model.id}`}
              alias={existingAlias}
              copied={copied}
              onCopy={copy}
              onSetAlias={(alias) => handleSetAlias(model.id, alias, providerStorageAlias)}
              onDeleteAlias={() => handleDeleteAlias(existingAlias)}
              testStatus={modelTestResults[model.id]}
              onTest={connections.length > 0 || isFreeNoAuth ? () => handleTestModel(model.id) : undefined}
              isTesting={testingModelId === model.id}
              isFree={model.isFree}
            />
          );
        })}

        {/* Custom models inline */}
        {customModels.map((model) => (
          <ModelRow
            key={model.id}
            model={{ id: model.id }}
            fullModel={`${providerDisplayAlias}/${model.id}`}
            alias={model.alias}
            copied={copied}
            onCopy={copy}
            onSetAlias={() => {}}
            onDeleteAlias={() => handleDeleteAlias(model.alias)}
            testStatus={modelTestResults[model.id]}
            onTest={connections.length > 0 || isFreeNoAuth ? () => handleTestModel(model.id) : undefined}
            isTesting={testingModelId === model.id}
            isCustom
            isFree={false}
          />
        ))}

        {/* Add model button — inline, same style as model chips */}
        <button
          onClick={() => setShowAddCustomModel(true)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-dashed border-black/15 dark:border-white/15 text-xs text-text-muted hover:text-primary hover:border-primary/40 transition-colors"
        >
          <span className="material-symbols-outlined text-sm">add</span>
          Add Model
        </button>

        {/* Suggested models from provider API — show only models not yet added */}
        {suggestedModels.length > 0 && (() => {
          const addedFullModels = new Set(Object.values(modelAliases));
          const hardcodedIds = new Set(models.map((m) => m.id));
          const notAdded = suggestedModels.filter(
            (m) => !addedFullModels.has(`${providerStorageAlias}/${m.id}`) && !hardcodedIds.has(m.id)
          );
          if (notAdded.length === 0) return null;
          return (
            <div className="w-full mt-2">
              <p className="text-xs text-text-muted mb-2">Suggested free models (≥200k context):</p>
              <div className="flex flex-wrap gap-2">
                {notAdded.map((m) => (
                  <button
                    key={m.id}
                    onClick={async () => {
                      const alias = m.id.split("/").pop();
                      await handleSetAlias(m.id, alias, providerStorageAlias);
                    }}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-black/10 dark:border-white/10 text-xs text-text-muted hover:text-primary hover:border-primary/40 hover:bg-primary/5 transition-colors"
                    title={`${m.name} · ${(m.contextLength / 1000).toFixed(0)}k ctx`}
                  >
                    <span className="material-symbols-outlined text-[13px]">add</span>
                    {m.id.split("/").pop()}
                  </button>
                ))}
              </div>
            </div>
          );
        })()}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex flex-col gap-8">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
}

  if (!providerInfo) {
    return (
      <div className="text-center py-20">
        <p className="text-text-muted">Provider not found</p>
        <Link href="/dashboard/providers" className="text-primary mt-4 inline-block">
          Back to Providers
        </Link>
      </div>
    );
  }

  // Determine icon path: OpenAI Compatible providers use specialized icons
  const getHeaderIconPath = () => {
    if (isOpenAICompatible && providerInfo.apiType) {
      return providerInfo.apiType === "responses" ? "/providers/oai-r.png" : "/providers/oai-cc.png";
    }
    if (isAnthropicCompatible) {
      return "/providers/anthropic-m.png";
    }
    return `/providers/${providerInfo.id}.png`;
  };

  const nextQuotaResetLabel = quotaSummary.nextResetAt
    ? new Date(quotaSummary.nextResetAt).toLocaleString()
    : null;

  return (
    <div className="flex flex-col gap-8">
      {/* Header */}
      <div>
        <Link
          href="/dashboard/providers"
          className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-primary transition-colors mb-4"
        >
          <span className="material-symbols-outlined text-lg">arrow_back</span>
          Back to Providers
        </Link>
        <div className="flex items-center gap-4">
          <div
            className="rounded-lg flex items-center justify-center"
            style={{ backgroundColor: `${providerInfo.color}15` }}
          >
            {headerImgError ? (
              <span className="text-sm font-bold" style={{ color: providerInfo.color }}>
                {providerInfo.textIcon || providerInfo.id.slice(0, 2).toUpperCase()}
              </span>
            ) : (
              <Image
                src={getHeaderIconPath()}
                alt={providerInfo.name}
                width={48}
                height={48}
                className="object-contain rounded-lg max-w-[48px] max-h-[48px]"
                sizes="48px"
                onError={() => setHeaderImgError(true)}
              />
            )}
          </div>
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">{providerInfo.name}</h1>
            <p className="text-text-muted">
              {connections.length} connection{connections.length === 1 ? "" : "s"}
            </p>
          </div>
        </div>
      </div>

      {providerInfo.deprecated && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-yellow-500/10 border border-yellow-500/30">
          <span className="material-symbols-outlined text-[16px] text-yellow-500 mt-0.5 shrink-0">warning</span>
          <p className="text-xs text-red-600 dark:text-yellow-400 leading-relaxed">{providerInfo.deprecationNotice}</p>
        </div>
      )}

      {providerInfo.notice && !providerInfo.deprecated && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-500/10 border border-blue-500/30">
          <span className="material-symbols-outlined text-[16px] text-blue-500 shrink-0">info</span>
          <p className="text-xs text-blue-600 dark:text-blue-400 leading-relaxed">{providerInfo.notice.text}</p>
          {providerInfo.notice.apiKeyUrl && (
            <a
              href={providerInfo.notice.apiKeyUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-medium text-white bg-blue-500 hover:bg-blue-600 px-2 py-0.5 rounded shrink-0 transition-colors"
            >
              Get API Key →
            </a>
          )}
        </div>
      )}

      {connections.length > 0 && (
        <Card className="overflow-hidden">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-2xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-primary/15 bg-primary/5 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
                <span className="material-symbols-outlined text-[14px]">donut_large</span>
                Routing availability
              </div>
              <h2 className="mt-3 text-lg font-semibold text-text-primary">Connection routing summary</h2>
              <p className="mt-1 text-sm text-text-muted">
                This rolls up each connection&apos;s current routing status for this provider. Quota and cooldown signals are only shown when the connection is explicitly reporting them.
              </p>
            </div>

            <div className="rounded-2xl border border-black/5 dark:border-white/10 bg-surface px-4 py-3 text-sm text-text-muted min-w-[240px]">
              <div className="flex items-center gap-2 text-text-primary font-medium">
                <span className="material-symbols-outlined text-[16px] text-primary">schedule</span>
                Next quota retry/reset
              </div>
              <p className="mt-1 text-sm">
                {nextQuotaResetLabel || "No quota retry/reset scheduled"}
              </p>
            </div>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {quotaSummaryItems.map((item) => (
              <div
                key={item.key}
                className="rounded-2xl border border-black/5 dark:border-white/10 bg-white/70 dark:bg-white/[0.03] px-4 py-3"
              >
                <p className="text-xs uppercase tracking-[0.14em] text-text-muted">{item.label}</p>
                <p className={`mt-2 text-2xl font-semibold ${item.tone}`}>{item.value}</p>
              </div>
            ))}
          </div>

          {quotaSummary.unknown > 0 && (
            <p className="mt-4 text-xs text-text-muted">
              {quotaSummary.unknown} connection{quotaSummary.unknown === 1 ? " is" : "s are"} still reporting unknown availability.
            </p>
          )}
        </Card>
      )}

      {isCompatible && providerNode && (
        <Card>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold">{isAnthropicCompatible ? "Anthropic Compatible Details" : "OpenAI Compatible Details"}</h2>
              <p className="text-sm text-text-muted">
                {isAnthropicCompatible ? "Messages API" : (providerNode.apiType === "responses" ? "Responses API" : "Chat Completions")} · {(providerNode.baseUrl || "").replace(/\/$/, "")}/
                {isAnthropicCompatible ? "messages" : (providerNode.apiType === "responses" ? "responses" : "chat/completions")}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                icon="add"
                onClick={() => setShowAddApiKeyModal(true)}
                disabled={connections.length > 0}
              >
                Add
              </Button>
              <Button
                size="sm"
                variant="secondary"
                icon="edit"
                onClick={() => setShowEditNodeModal(true)}
              >
                Edit
              </Button>
              <Button
                size="sm"
                variant="secondary"
                icon="delete"
                onClick={async () => {
                  if (!confirm(`Delete this ${isAnthropicCompatible ? "Anthropic" : "OpenAI"} Compatible node?`)) return;
                  try {
                    const res = await fetch(`/api/provider-nodes/${providerId}`, { method: "DELETE" });
                    if (res.ok) {
                      router.push("/dashboard/providers");
                    }
                  } catch (error) {
                    console.log("Error deleting provider node:", error);
                  }
                }}
              >
                Delete
              </Button>
            </div>
          </div>
          {connections.length > 0 && (
            <p className="text-sm text-text-muted">
              Only one connection is allowed per compatible node. Add another node if you need more connections.
            </p>
          )}
        </Card>
      )}

      {/* Connections */}
      {isFreeNoAuth ? (
        <Card>
          <div className="flex items-center gap-3">
            <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-green-500/10 text-green-500">
              <span className="material-symbols-outlined text-[20px]">lock_open</span>
            </div>
            <div>
              <p className="text-sm font-medium">No authentication required</p>
              <p className="text-xs text-text-muted">This provider is ready to use.</p>
            </div>
          </div>
        </Card>
      ) : (
        <Card>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Connections</h2>
            <div className="flex items-center gap-4">
              {/* Thinking config */}
              {/* {thinkingConfig && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-text-muted font-medium">Thinking</span>
                  <select
                    value={thinkingMode}
                    onChange={(e) => handleThinkingModeChange(e.target.value)}
                    className="text-xs px-2 py-1 border border-border rounded-md bg-background focus:outline-none focus:border-primary"
                  >
                    {thinkingConfig.options.map((opt) => (
                      <option key={opt} value={opt}>{opt.charAt(0).toUpperCase() + opt.slice(1)}</option>
                    ))}
                  </select>
                </div>
              )} */}
              {/* Round Robin toggle */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-text-muted font-medium">Round Robin</span>
                <Toggle
                  checked={providerStrategy === "round-robin"}
                  onChange={handleRoundRobinToggle}
                />
                {providerStrategy === "round-robin" && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-text-muted">Sticky:</span>
                    <input
                      type="number"
                      min={1}
                      value={providerStickyLimit}
                      onChange={(e) => handleStickyLimitChange(e.target.value)}
                      placeholder="1"
                      className="w-14 px-2 py-1 text-xs border border-border rounded-md bg-background focus:outline-none focus:border-primary"
                    />
                  </div>
                )}
              </div>
            </div>
          </div>

          {connections.length === 0 ? (
            <div className="text-center py-12">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 text-primary mb-4">
                <span className="material-symbols-outlined text-[32px]">{isOAuth ? "lock" : "key"}</span>
              </div>
              <p className="text-text-main font-medium mb-1">No connections yet</p>
              <p className="text-sm text-text-muted mb-4">Add your first connection to get started</p>
              {!isCompatible && (
                <div className="flex gap-2 justify-center">
                  {providerId === "iflow" && (
                    <Button icon="cookie" variant="secondary" onClick={() => setShowIFlowCookieModal(true)}>
                      Cookie Auth
                    </Button>
                  )}
                  <Button icon="add" onClick={() => isOAuth ? setShowOAuthModal(true) : setShowAddApiKeyModal(true)}>
                    {providerId === "iflow" ? "OAuth" : "Add Connection"}
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <>
              {connectionsList}
              {!isCompatible && (
                <div className="flex gap-2 mt-4">
                  {providerId === "iflow" && (
                    <Button
                      size="sm"
                      icon="cookie"
                      variant="secondary"
                      onClick={() => setShowIFlowCookieModal(true)}
                      title="Add connection using browser cookie"
                    >
                      Cookie
                    </Button>
                  )}
                  <Button
                    size="sm"
                    icon="add"
                    onClick={() => isOAuth ? setShowOAuthModal(true) : setShowAddApiKeyModal(true)}
                  >
                    Add
                  </Button>
                </div>
              )}
            </>
          )}
        </Card>
      )}

      {/* Models */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">
            {"Available Models"}
          </h2>
        </div>
        {!!modelsTestError && (
          <p className="text-xs text-red-500 mb-3 break-words">{modelsTestError}</p>
        )}
        {renderModelsSection()}
      </Card>

      {bulkActionModal}

      {/* Modals */}
      {providerId === "kiro" ? (
        <KiroOAuthWrapper
          isOpen={showOAuthModal}
          providerInfo={providerInfo}
          onSuccess={handleOAuthSuccess}
          onClose={() => setShowOAuthModal(false)}
        />
      ) : providerId === "cursor" ? (
        <CursorAuthModal
          isOpen={showOAuthModal}
          onSuccess={handleOAuthSuccess}
          onClose={() => setShowOAuthModal(false)}
        />
      ) : providerId === "gitlab" ? (
        <GitLabAuthModal
          isOpen={showOAuthModal}
          providerInfo={providerInfo}
          onSuccess={handleOAuthSuccess}
          onClose={() => setShowOAuthModal(false)}
        />
      ) : (
        <OAuthModal
          isOpen={showOAuthModal}
          provider={providerId}
          providerInfo={providerInfo}
          onSuccess={handleOAuthSuccess}
          onClose={() => setShowOAuthModal(false)}
        />
      )}
      {providerId === "iflow" && (
        <IFlowCookieModal
          isOpen={showIFlowCookieModal}
          onSuccess={handleIFlowCookieSuccess}
          onClose={() => setShowIFlowCookieModal(false)}
        />
      )}
      <AddApiKeyModal
        isOpen={showAddApiKeyModal}
        provider={providerId}
        providerName={providerInfo.name}
        isCompatible={isCompatible}
        isAnthropic={isAnthropicCompatible}
        authType={providerInfo?.authType}
        authHint={providerInfo?.authHint}
        website={providerInfo?.website}
        proxyPools={proxyPools}
        onSave={handleSaveApiKey}
        onClose={() => setShowAddApiKeyModal(false)}
      />
      <EditConnectionModal
        isOpen={showEditModal}
        connection={selectedConnection}
        proxyPools={proxyPools}
        onSave={handleUpdateConnection}
        onClose={() => setShowEditModal(false)}
      />
      {isCompatible && (
        <EditCompatibleNodeModal
          isOpen={showEditNodeModal}
          node={providerNode}
          onSave={handleUpdateNode}
          onClose={() => setShowEditNodeModal(false)}
          isAnthropic={isAnthropicCompatible}
        />
      )}
      {!isCompatible && (
        <AddCustomModelModal
          isOpen={showAddCustomModel}
          providerAlias={providerStorageAlias}
          providerDisplayAlias={providerDisplayAlias}
          onSave={async (modelId) => {
            // For passthrough providers (OpenRouter), use last segment as alias to avoid slash conflicts
            const alias = providerInfo?.passthroughModels
              ? modelId.split("/").pop()
              : modelId;
            await handleSetAlias(modelId, alias, providerStorageAlias);
            setShowAddCustomModel(false);
          }}
          onClose={() => setShowAddCustomModel(false)}
        />
      )}
    </div>
  );
}
