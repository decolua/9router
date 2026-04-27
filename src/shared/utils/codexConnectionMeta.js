const FALLBACK_VALUE = "-";

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function toDisplayValue(value) {
  return normalizeText(value) || FALLBACK_VALUE;
}

export function isCodexOAuthConnection(connection) {
  return connection?.provider === "codex" && connection?.authType === "oauth";
}

export function getCodexConnectionMeta(connection) {
  const providerSpecificData = connection?.providerSpecificData || {};
  const activeWorkspaceNameRaw = normalizeText(providerSpecificData.chatgptActiveWorkspaceTitle);
  const activeWorkspaceIdRaw = normalizeText(providerSpecificData.chatgptActiveWorkspaceId);
  const tokenWorkspaceNameRaw = normalizeText(providerSpecificData.chatgptWorkspaceTitle);
  const tokenWorkspaceIdRaw = normalizeText(providerSpecificData.chatgptWorkspaceId);
  const workspaceSourceRaw = normalizeText(providerSpecificData.chatgptActiveWorkspaceSource);

  const workspaceNameRaw = activeWorkspaceNameRaw || tokenWorkspaceNameRaw;
  const workspaceIdRaw = activeWorkspaceIdRaw || tokenWorkspaceIdRaw;
  const hasWorkspaceIdMismatch = !!(
    activeWorkspaceIdRaw &&
    tokenWorkspaceIdRaw &&
    activeWorkspaceIdRaw !== tokenWorkspaceIdRaw
  );
  const hasWorkspaceNameMismatch = !!(
    !hasWorkspaceIdMismatch &&
    activeWorkspaceNameRaw &&
    tokenWorkspaceNameRaw &&
    activeWorkspaceNameRaw !== tokenWorkspaceNameRaw
  );
  const isWorkspaceMismatch = hasWorkspaceIdMismatch || hasWorkspaceNameMismatch;

  const workspaceDebugTitle = [
    `activeWorkspace: ${toDisplayValue(activeWorkspaceNameRaw)} (${toDisplayValue(activeWorkspaceIdRaw)})`,
    `tokenWorkspace: ${toDisplayValue(tokenWorkspaceNameRaw)} (${toDisplayValue(tokenWorkspaceIdRaw)})`,
    `source: ${toDisplayValue(workspaceSourceRaw)}`,
  ].join(" | ");

  return {
    email: toDisplayValue(connection?.email),
    plan: toDisplayValue(providerSpecificData.chatgptPlanType),
    workspaceName: toDisplayValue(workspaceNameRaw),
    workspaceId: toDisplayValue(workspaceIdRaw),
    activeWorkspaceName: toDisplayValue(activeWorkspaceNameRaw),
    activeWorkspaceId: toDisplayValue(activeWorkspaceIdRaw),
    tokenWorkspaceName: toDisplayValue(tokenWorkspaceNameRaw),
    tokenWorkspaceId: toDisplayValue(tokenWorkspaceIdRaw),
    workspaceSource: toDisplayValue(workspaceSourceRaw),
    workspaceDebugTitle,
    isWorkspaceMismatch,
  };
}
