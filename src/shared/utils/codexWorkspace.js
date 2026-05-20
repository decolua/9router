export function getCodexWorkspaceId(connection = {}) {
  const data = connection.providerSpecificData || connection || {};
  return data.chatgptAccountId || data.chatgptWorkspaceId || data.accountId || null;
}

export function getCodexWorkspaceIdSuffix(workspaceId) {
  if (!workspaceId) return "";
  return workspaceId.length > 12 ? workspaceId.slice(-8) : workspaceId;
}

export function formatCodexWorkspaceLabel(connection = {}, { includePlan = true, includeId = true } = {}) {
  const data = connection.providerSpecificData || connection || {};
  const workspaceId = getCodexWorkspaceId(data);
  const plan = data.chatgptPlanType;

  const parts = [
    includePlan && plan ? plan : null,
    includeId && workspaceId ? getCodexWorkspaceIdSuffix(workspaceId) : null,
  ].filter(Boolean);

  return parts.join(" / ");
}

export function formatCodexConnectionName(connection = {}, fallback = "OAuth Account") {
  const base = connection.name || connection.email || connection.displayName || fallback;
  if (connection.provider !== "codex") return base;

  const workspaceLabel = formatCodexWorkspaceLabel(connection);
  return workspaceLabel ? `${base} / ${workspaceLabel}` : base;
}
