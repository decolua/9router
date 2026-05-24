export const ONE_BY_ONE_DELAY_MS = 1000;

export function parseValidExpiresAt(value) {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function sortConnectionsByExpiresAt(connections, direction) {
  if (!direction) return connections;

  return [...connections].sort((a, b) => {
    const expiresAtA = parseValidExpiresAt(a.expiresAt);
    const expiresAtB = parseValidExpiresAt(b.expiresAt);
    const hasExpiryA = expiresAtA !== null;
    const hasExpiryB = expiresAtB !== null;

    if (hasExpiryA !== hasExpiryB) return hasExpiryA ? -1 : 1;
    if (!hasExpiryA && !hasExpiryB) return 0;

    return direction === "asc"
      ? expiresAtA - expiresAtB
      : expiresAtB - expiresAtA;
  });
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function getSelectedConnections(connections, selectedConnectionIds) {
  return connections.filter((conn) => selectedConnectionIds.includes(conn.id));
}

export function getSelectionSummary(selectedConnectionIds, connections) {
  return `${selectedConnectionIds.length}/${connections.length} selected`;
}

export function getAutoRefreshSummary(connections) {
  const autoRefreshEnabledCount = connections.filter(
    (conn) => conn.providerSpecificData?.autoRefreshEnabled === true,
  ).length;

  return `${autoRefreshEnabledCount}/${connections.length} auto refresh enabled`;
}

export function getSelectedAutoRefreshSummary(selectedConnections) {
  const selectedAutoRefreshCount = selectedConnections.filter(
    (conn) => conn.providerSpecificData?.autoRefreshEnabled === true,
  ).length;

  return selectedConnections.length === 0
    ? ""
    : `${selectedAutoRefreshCount}/${selectedConnections.length} selected enabled`;
}

export function getSelectedEmailSummary(selectedConnections) {
  const selectedEmailCount = selectedConnections.filter(
    (conn) =>
      typeof (conn.email || conn.name) === "string" &&
      (conn.email || conn.name).includes("@"),
  ).length;

  return `${selectedEmailCount} email${selectedEmailCount === 1 ? "" : "s"}`;
}

export function getSelectedProxySummary(selectedConnections, proxyPools) {
  if (selectedConnections.length === 0) return "";

  const poolIds = new Set(
    selectedConnections.map(
      (conn) => conn.providerSpecificData?.proxyPoolId || "__none__",
    ),
  );

  if (poolIds.size === 1) {
    const onlyId = [...poolIds][0];
    if (onlyId === "__none__") return "All selected currently unbound";
    const pool = proxyPools.find((p) => p.id === onlyId);
    return `All selected currently bound to ${pool?.name || onlyId}`;
  }

  return "Selected connections have mixed proxy bindings";
}
