import { useState, useCallback, useMemo, useRef } from "react";
import {
  ONE_BY_ONE_DELAY_MS,
  sortConnectionsByExpiresAt,
  sleep,
  getSelectedConnections,
  getSelectionSummary,
  getAutoRefreshSummary,
  getSelectedAutoRefreshSummary,
  getSelectedEmailSummary,
  getSelectedProxySummary,
} from "../utils/providerDetailHelpers";
import {
  fetchProviderDetailPageData,
  fetchProviderNodes,
  updateProviderConnection,
  deleteProviderConnection,
  testProviderConnection,
  refreshSelectedCodexConnections,
  patchProviderSettings,
  fetchProviderSettings,
  warmupProviderConnection,
  warmupSelectedConnections,
} from "../utils/providerDetailPageApi";

const ACCOUNT_STATUS_FILTER_OPTIONS = ["all", "active", "inactive"];

function filterConnectionsByAccountStatus(connections, accountStatusFilter) {
  if (accountStatusFilter === "active") {
    return connections.filter((connection) => connection.isActive !== false);
  }
  if (accountStatusFilter === "inactive") {
    return connections.filter((connection) => connection.isActive === false);
  }
  return connections;
}

function getConnectionLabel(connection) {
  return connection.email || connection.name || connection.id;
}

export function useProviderDetailConnections({
  providerId,
  isCompatible,
  onProviderNodeLoaded,
  onThinkingModeLoaded,
}) {
  const [connections, setConnections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [proxyPools, setProxyPools] = useState([]);
  const [selectedConnectionIds, setSelectedConnectionIds] = useState([]);
  const [accountStatusFilter, setAccountStatusFilter] = useState("all");
  const [showBulkProxyModal, setShowBulkProxyModal] = useState(false);
  const [bulkUpdatingProxy, setBulkUpdatingProxy] = useState(false);
  const [providerStrategy, setProviderStrategy] = useState(null);
  const [providerStickyLimit, setProviderStickyLimit] = useState("");
  const [connectionsSortDirection, setConnectionsSortDirection] =
    useState(null);
  const [oneByOneRunning, setOneByOneRunning] = useState(false);
  const [oneByOneStopping, setOneByOneStopping] = useState(false);
  const [oneByOneCurrentConnectionId, setOneByOneCurrentConnectionId] =
    useState(null);
  const [oneByOneResults, setOneByOneResults] = useState({});
  const [oneByOneSummary, setOneByOneSummary] = useState(null);
  const [manualRefreshResults, setManualRefreshResults] = useState({});
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const [manualRefreshSummary, setManualRefreshSummary] = useState(null);
  const [warmupRunning, setWarmupRunning] = useState(false);
  const [warmupResults, setWarmupResults] = useState({});
  const [warmupSummary, setWarmupSummary] = useState(null);
  const stopOneByOneRef = useRef(false);
  const lastClickedIndexRef = useRef(null);
  const connectionsRef = useRef([]);

  const applyConnections = useCallback((nextConnections) => {
    connectionsRef.current = nextConnections;
    setConnections(nextConnections);
    setSelectedConnectionIds((prev) =>
      prev.filter((id) => nextConnections.some((conn) => conn.id === id)),
    );
  }, []);

  const fetchConnections = useCallback(async () => {
    try {
      const {
        connectionsRes,
        nodesRes,
        proxyPoolsRes,
        connectionsData,
        nodesData,
        proxyPoolsData,
        settingsData,
      } = await fetchProviderDetailPageData(providerId);

      if (connectionsRes.ok) {
        const filtered = (connectionsData.connections || []).filter(
          (c) => c.provider === providerId,
        );
        applyConnections(filtered);
      }

      if (proxyPoolsRes.ok) {
        setProxyPools(proxyPoolsData.proxyPools || []);
      }

      const override =
        (settingsData.providerStrategies || {})[providerId] || {};
      setProviderStrategy(override.fallbackStrategy || null);
      setProviderStickyLimit(
        override.stickyRoundRobinLimit != null
          ? String(override.stickyRoundRobinLimit)
          : "1",
      );

      const thinkingCfg =
        (settingsData.providerThinking || {})[providerId] || {};
      onThinkingModeLoaded(thinkingCfg.mode || "auto");

      if (nodesRes.ok) {
        let node =
          (nodesData.nodes || []).find((entry) => entry.id === providerId) ||
          null;

        if (!node && isCompatible) {
          for (let attempt = 0; attempt < 3; attempt += 1) {
            await new Promise((resolve) => setTimeout(resolve, 150));
            const retry = await fetchProviderNodes();
            if (!retry.ok) continue;
            node = retry.nodes.find((entry) => entry.id === providerId) || null;
            if (node) break;
          }
        }

        onProviderNodeLoaded(node);
      }
    } catch (error) {
      console.log("Error fetching connections:", error);
    } finally {
      setLoading(false);
    }
  }, [
    applyConnections,
    providerId,
    isCompatible,
    onProviderNodeLoaded,
    onThinkingModeLoaded,
  ]);

  const filteredConnections = useMemo(
    () => filterConnectionsByAccountStatus(connections, accountStatusFilter),
    [connections, accountStatusFilter],
  );
  const displayedConnections = useMemo(
    () =>
      sortConnectionsByExpiresAt(filteredConnections, connectionsSortDirection),
    [filteredConnections, connectionsSortDirection],
  );
  const isConnectionsSortActive = connectionsSortDirection !== null;

  const handleToggleConnectionsSort = () => {
    setConnectionsSortDirection((current) => {
      if (current === null) return "asc";
      if (current === "asc") return "desc";
      return null;
    });
  };

  const saveProviderStrategy = async (strategy, stickyLimit) => {
    try {
      const settingsData = await fetchProviderSettings();
      const current = settingsData.providerStrategies || {};
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

      await patchProviderSettings({ providerStrategies: updated });
    } catch (error) {
      console.log("Error saving provider strategy:", error);
    }
  };

  const handleRoundRobinToggle = (enabled) => {
    const strategy = enabled ? "round-robin" : null;
    const sticky = enabled ? providerStickyLimit || "1" : providerStickyLimit;
    if (enabled && !providerStickyLimit) setProviderStickyLimit("1");
    setProviderStrategy(strategy);
    saveProviderStrategy(strategy, sticky);
  };

  const handleStickyLimitChange = (value) => {
    setProviderStickyLimit(value);
    saveProviderStrategy("round-robin", value);
  };

  const handleRunOneByOneTest = async () => {
    if (oneByOneRunning || connections.length === 0) return;

    const queuedState = Object.fromEntries(
      connections.map((connection) => [
        connection.id,
        { state: "queued", error: null },
      ]),
    );

    stopOneByOneRef.current = false;
    setOneByOneRunning(true);
    setOneByOneStopping(false);
    setOneByOneCurrentConnectionId(null);
    setOneByOneResults(queuedState);
    setOneByOneSummary({
      total: connections.length,
      completed: 0,
      passed: 0,
      failed: 0,
      stopped: false,
    });

    let passed = 0;
    let failed = 0;

    try {
      for (let index = 0; index < connections.length; index += 1) {
        if (stopOneByOneRef.current) {
          setOneByOneSummary({
            total: connections.length,
            completed: index,
            passed,
            failed,
            stopped: true,
          });
          break;
        }

        const connection = connections[index];
        setOneByOneCurrentConnectionId(connection.id);
        setOneByOneResults((prev) => ({
          ...prev,
          [connection.id]: { state: "testing", error: null },
        }));

        try {
          const { data } = await testProviderConnection(connection.id);
          const valid = !!data.valid;

          if (valid) passed += 1;
          else failed += 1;

          setOneByOneResults((prev) => ({
            ...prev,
            [connection.id]: {
              state: valid ? "success" : "failed",
              error: valid ? null : data.error || null,
            },
          }));
        } catch (error) {
          failed += 1;
          setOneByOneResults((prev) => ({
            ...prev,
            [connection.id]: {
              state: "failed",
              error: error.message || "Test failed",
            },
          }));
        }

        setOneByOneSummary({
          total: connections.length,
          completed: index + 1,
          passed,
          failed,
          stopped: false,
        });

        if (index < connections.length - 1) {
          await sleep(ONE_BY_ONE_DELAY_MS);
        }
      }
    } finally {
      setOneByOneCurrentConnectionId(null);
      setOneByOneRunning(false);
      setOneByOneStopping(false);
      stopOneByOneRef.current = false;
    }
  };

  const handleStopOneByOneTest = () => {
    if (!oneByOneRunning) return;
    stopOneByOneRef.current = true;
    setOneByOneStopping(true);
  };

  const handleDeleteConnection = async (connectionId) => {
    try {
      const res = await deleteProviderConnection(connectionId);
      if (res.ok) {
        applyConnections(
          connectionsRef.current.filter((c) => c.id !== connectionId),
        );
      }
    } catch (error) {
      console.log("Error deleting connection:", error);
    }
  };

  const handleUpdateConnectionStatus = async (connectionId, isActive) => {
    try {
      const res = await updateProviderConnection(connectionId, { isActive });
      if (res.ok) {
        applyConnections(
          connectionsRef.current.map((c) =>
            c.id === connectionId ? { ...c, isActive } : c,
          ),
        );
      }
    } catch (error) {
      console.log("Error updating connection status:", error);
    }
  };

  const handleSwapPriority = async (index1, index2) => {
    const newConnections = [...connections];
    [newConnections[index1], newConnections[index2]] = [
      newConnections[index2],
      newConnections[index1],
    ];
    applyConnections(newConnections);

    try {
      await Promise.all([
        updateProviderConnection(newConnections[index1].id, {
          priority: index1,
        }),
        updateProviderConnection(newConnections[index2].id, {
          priority: index2,
        }),
      ]);
    } catch (error) {
      console.log("Error swapping priority:", error);
      await fetchConnections();
    }
  };

  const selectedConnections = getSelectedConnections(
    connections,
    selectedConnectionIds,
  );
  const displayedConnectionIds = displayedConnections.map((conn) => conn.id);
  const allSelected =
    displayedConnectionIds.length > 0 &&
    displayedConnectionIds.every((id) => selectedConnectionIds.includes(id));

  const persistAutoRefreshSelection = async (connectionId, enabled) => {
    try {
      const target = connections.find((conn) => conn.id === connectionId);
      if (!target) return false;

      const providerSpecificData = {
        ...(target.providerSpecificData || {}),
        autoRefreshEnabled: enabled,
      };

      const res = await updateProviderConnection(connectionId, {
        providerSpecificData,
      });
      if (!res.ok) return false;

      applyConnections(
        connectionsRef.current.map((conn) =>
          conn.id === connectionId ? { ...conn, providerSpecificData } : conn,
        ),
      );
      return true;
    } catch (error) {
      console.log("Error updating auto refresh flag:", error);
      return false;
    }
  };

  const setSelectedConnectionsAutoRefresh = async (enabled) => {
    if (selectedConnectionIds.length === 0) return;
    let failed = 0;

    for (const connectionId of selectedConnectionIds) {
      const ok = await persistAutoRefreshSelection(connectionId, enabled);
      if (!ok) failed += 1;
    }

    if (failed > 0) {
      alert(`Updated with ${failed} failed request(s).`);
    }
  };

  const copySelectedEmails = async () => {
    const emails = selectedConnections
      .map((conn) => conn.email || conn.name)
      .filter((value) => typeof value === "string" && value.includes("@"));

    if (emails.length === 0) {
      alert("No selected emails to copy.");
      return;
    }

    try {
      await navigator.clipboard.writeText(emails.join("\n"));
    } catch (error) {
      console.log("Error copying selected emails:", error);
      alert("Failed to copy selected emails.");
    }
  };

  const toggleSelectConnection = (connectionId, isShift = false) => {
    const currentIndex = displayedConnections.findIndex(
      (conn) => conn.id === connectionId,
    );

    if (currentIndex === -1) return;

    setSelectedConnectionIds((prev) => {
      const isCurrentlySelected = prev.includes(connectionId);
      const shouldSelect = !isCurrentlySelected;

      if (isShift && lastClickedIndexRef.current !== null) {
        const start = Math.min(lastClickedIndexRef.current, currentIndex);
        const end = Math.max(lastClickedIndexRef.current, currentIndex);
        const targetIds = displayedConnections
          .slice(start, end + 1)
          .map((c) => c.id);

        let nextSelectedIds;
        if (shouldSelect) {
          const newIds = targetIds.filter((id) => !prev.includes(id));
          nextSelectedIds = [...prev, ...newIds];
        } else {
          nextSelectedIds = prev.filter((id) => !targetIds.includes(id));
        }

        lastClickedIndexRef.current = currentIndex;
        return nextSelectedIds;
      } else {
        lastClickedIndexRef.current = currentIndex;
        return shouldSelect
          ? [...prev, connectionId]
          : prev.filter((id) => id !== connectionId);
      }
    });
  };

  const selectedAutoRefreshSummary =
    getSelectedAutoRefreshSummary(selectedConnections);

  const toggleSelectAllConnections = () => {
    if (allSelected) {
      setSelectedConnectionIds((prev) =>
        prev.filter((id) => !displayedConnectionIds.includes(id)),
      );
      return;
    }
    setSelectedConnectionIds((prev) => [
      ...prev,
      ...displayedConnectionIds.filter((id) => !prev.includes(id)),
    ]);
  };

  const clearSelection = () => {
    setSelectedConnectionIds([]);
  };

  const selectionSummary = getSelectionSummary(
    selectedConnectionIds.filter((id) => displayedConnectionIds.includes(id)),
    displayedConnections,
  );
  const autoRefreshSummary = getAutoRefreshSummary(connections);
  const selectedEmailSummary = getSelectedEmailSummary(selectedConnections);

  const openBulkProxyModal = () => {
    setShowBulkProxyModal(true);
  };

  const closeBulkProxyModal = () => {
    if (bulkUpdatingProxy) return;
    setShowBulkProxyModal(false);
  };

  const applyProxyAssignments = async (assignments) => {
    setBulkUpdatingProxy(true);
    try {
      let failed = 0;
      for (const { connectionId, proxyPoolId } of assignments) {
        try {
          const res = await updateProviderConnection(connectionId, {
            proxyPoolId,
          });
          if (!res.ok) failed += 1;
        } catch (error) {
          console.log("Error applying proxy for", connectionId, error);
          failed += 1;
        }
      }
      if (failed > 0) alert(`Updated with ${failed} failed request(s).`);
      await fetchConnections();
      setShowBulkProxyModal(false);
    } finally {
      setBulkUpdatingProxy(false);
    }
  };

  const handleApplySinglePool = (proxyPoolId) => {
    const targets = connections.map((c) => ({
      connectionId: c.id,
      proxyPoolId,
    }));
    return applyProxyAssignments(targets);
  };

  const activePools = proxyPools.filter((p) => p.isActive === true);

  const handleApplyOneToOne = () => {
    if (activePools.length === 0) {
      alert("No active proxy pools available.");
      return;
    }
    const targets = connections.map((c, i) => ({
      connectionId: c.id,
      proxyPoolId: activePools[i % activePools.length].id,
    }));
    return applyProxyAssignments(targets);
  };

  const isSelected = (connectionId) =>
    selectedConnectionIds.includes(connectionId);

  const handleManualRefreshSelected = async () => {
    if (selectedConnectionIds.length === 0 || manualRefreshing) return;

    setManualRefreshing(true);
    setManualRefreshSummary(null);
    try {
      const { res, data } = await refreshSelectedCodexConnections(
        selectedConnectionIds,
      );
      if (!res.ok) {
        alert(data.error || "Failed to refresh selected Codex accounts");
        return;
      }

      const nextResults = Object.fromEntries(
        (data.results || []).map((result) => [
          result.connectionId,
          result.ok
            ? { state: "success", error: null }
            : { state: "failed", error: result.error || "failed" },
        ]),
      );
      setManualRefreshResults(nextResults);
      setManualRefreshSummary(data.summary || null);

      if (data.results && Array.isArray(data.results)) {
        setConnections((prevConnections) => {
          const next = prevConnections.map((conn) => {
            const match = data.results.find((r) => r.connectionId === conn.id && r.ok);
            if (match && match.expiresAt) {
              return {
                ...conn,
                expiresAt: match.expiresAt,
              };
            }
            return conn;
          });
          connectionsRef.current = next;
          return next;
        });
      }
    } catch (error) {
      console.log("Error refreshing selected Codex accounts:", error);
      alert("Failed to refresh selected Codex accounts");
    } finally {
      setManualRefreshing(false);
    }
  };

  const clearManualRefreshResults = () => {
    setManualRefreshResults({});
    setManualRefreshSummary(null);
  };

  const handleWarmupSelected = async () => {
    if (selectedConnectionIds.length === 0 || warmupRunning) return;

    setWarmupRunning(true);
    setWarmupSummary(null);
    try {
      const { res, data } = await warmupSelectedConnections(
        selectedConnectionIds,
      );
      if (!res.ok) {
        alert(data.error || "Failed to warmup selected accounts");
        return;
      }

      const nextResults = Object.fromEntries(
        (data.results || []).map((result) => [
          result.connectionId,
          result.valid
            ? { state: "success", error: null }
            : { state: "failed", error: result.error || "failed" },
        ]),
      );
      setWarmupResults(nextResults);
      setWarmupSummary(data.summary || null);
    } catch (error) {
      console.log("Error warming up selected accounts:", error);
      alert("Failed to warmup selected accounts");
    } finally {
      setWarmupRunning(false);
      fetchConnections().catch((err) =>
        console.log("Error fetching connections after warmup:", err),
      );
    }
  };

  const handleWarmupSingle = async (connectionId, options = {}) => {
    setWarmupResults((prev) => ({
      ...prev,
      [connectionId]: { state: "refreshing", error: null },
    }));

    try {
      const { res, data } = await warmupProviderConnection(connectionId, options);
      const valid = !!data?.valid;

      setWarmupResults((prev) => ({
        ...prev,
        [connectionId]: {
          state: valid ? "success" : "failed",
          error: valid ? null : data?.error || "failed",
        },
      }));
    } catch (error) {
      setWarmupResults((prev) => ({
        ...prev,
        [connectionId]: {
          state: "failed",
          error: error.message || "Warmup failed",
        },
      }));
    } finally {
      fetchConnections().catch((err) =>
        console.log("Error fetching connections after warmup:", err),
      );
    }
  };

  const clearWarmupResults = () => {
    setWarmupResults({});
    setWarmupSummary(null);
  };

  const handleUpdateProxy = async (connectionId, proxyPoolId) => {
    try {
      const res = await updateProviderConnection(connectionId, {
        proxyPoolId: proxyPoolId || null,
      });
      if (res.ok) {
        applyConnections(
          connectionsRef.current.map((c) =>
            c.id === connectionId
              ? {
                  ...c,
                  providerSpecificData: {
                    ...c.providerSpecificData,
                    proxyPoolId: proxyPoolId || null,
                  },
                }
              : c,
          ),
        );
      }
    } catch (error) {
      console.log("Error updating proxy:", error);
    }
  };

  const handleAccountStatusFilterChange = (nextFilter) => {
    if (!ACCOUNT_STATUS_FILTER_OPTIONS.includes(nextFilter)) return;
    setAccountStatusFilter(nextFilter);
    setSelectedConnectionIds([]);
    lastClickedIndexRef.current = null;
  };

  const handleAutoPriorityVisibleConnections = async () => {
    if (displayedConnections.length === 0) return;

    const visibleIds = displayedConnections.map((conn) => conn.id);
    const visiblePositionById = new Map(
      visibleIds.map((connectionId, index) => [connectionId, index]),
    );
    const activeVisible = displayedConnections.filter(
      (conn) => conn.isActive !== false,
    );
    const inactiveVisible = displayedConnections.filter(
      (conn) => conn.isActive === false,
    );
    const prioritizedVisible = [...activeVisible, ...inactiveVisible];
    const nextConnections = connectionsRef.current.map((connection) => {
      const visibleIndex = visiblePositionById.get(connection.id);
      return visibleIndex === undefined
        ? connection
        : prioritizedVisible[visibleIndex];
    });

    applyConnections(nextConnections);

    try {
      await Promise.all(
        visibleIds.map((connectionId) => {
          const nextIndex = nextConnections.findIndex(
            (connection) => connection.id === connectionId,
          );
          return updateProviderConnection(connectionId, {
            priority: nextIndex,
          });
        }),
      );
      await fetchConnections();
    } catch (error) {
      console.log("Error auto updating priorities:", error);
      await fetchConnections();
    }
  };

  const handleDeleteSelectedConnections = async (
    connectionIds = selectedConnectionIds,
  ) => {
    if (connectionIds.length === 0) return;

    try {
      let failed = 0;
      for (const connectionId of connectionIds) {
        try {
          const res = await deleteProviderConnection(connectionId);
          if (!res.ok) failed += 1;
        } catch (error) {
          console.log("Error deleting connection:", connectionId, error);
          failed += 1;
        }
      }

      const deletedIds = new Set(connectionIds);
      applyConnections(
        connectionsRef.current.filter((conn) => !deletedIds.has(conn.id)),
      );
      setSelectedConnectionIds([]);

      if (failed > 0) {
        alert(`Deleted with ${failed} failed request(s).`);
        await fetchConnections();
      }
    } catch (error) {
      console.log("Error deleting selected connections:", error);
      await fetchConnections();
    }
  };

  const selectedConnectionDeletePreview = selectedConnections
    .slice(0, 5)
    .map(getConnectionLabel);

  return {
    connections,
    setConnections,
    loading,
    proxyPools,
    selectedConnectionIds,
    showBulkProxyModal,
    bulkUpdatingProxy,
    providerStrategy,
    providerStickyLimit,
    connectionsSortDirection,
    oneByOneRunning,
    oneByOneStopping,
    oneByOneCurrentConnectionId,
    oneByOneResults,
    oneByOneSummary,
    manualRefreshResults,
    manualRefreshing,
    manualRefreshSummary,
    fetchConnections,
    displayedConnections,
    accountStatusFilter,
    handleAccountStatusFilterChange,
    isConnectionsSortActive,
    handleToggleConnectionsSort,
    handleRoundRobinToggle,
    handleStickyLimitChange,
    handleRunOneByOneTest,
    handleStopOneByOneTest,
    handleDeleteConnection,
    handleDeleteSelectedConnections,
    selectedConnectionDeletePreview,
    handleUpdateConnectionStatus,
    handleAutoPriorityVisibleConnections,
    handleSwapPriority,
    setSelectedConnectionsAutoRefresh,
    copySelectedEmails,
    toggleSelectConnection,
    selectedConnections,
    allSelected,
    selectedAutoRefreshSummary,
    toggleSelectAllConnections,
    clearSelection,
    selectionSummary,
    autoRefreshSummary,
    selectedEmailSummary,
    openBulkProxyModal,
    closeBulkProxyModal,
    handleApplySinglePool,
    activePools,
    handleApplyOneToOne,
    isSelected,
    handleManualRefreshSelected,
    clearManualRefreshResults,
    handleUpdateProxy,
    warmupRunning,
    warmupResults,
    warmupSummary,
    handleWarmupSelected,
    handleWarmupSingle,
    clearWarmupResults,
  };
}
