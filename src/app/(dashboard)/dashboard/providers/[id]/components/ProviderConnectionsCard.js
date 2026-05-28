import { Button, Card, NoAuthProxyCard } from "@/shared/components";
import ProviderConnectionsToolbar from "./ProviderConnectionsToolbar";
import ProviderConnectionsSummary from "./ProviderConnectionsSummary";
import ProviderConnectionsList from "./ProviderConnectionsList";

export default function ProviderConnectionsCard({
  providerId,
  isFreeNoAuth,
  isOAuth,
  isCompatible,
  hasDualAuthModes,
  oauthConnectionLabel,
  apiKeyConnectionLabel,
  connections,
  displayedConnections,
  accountStatusFilter,
  onAccountStatusFilterChange,
  proxyPools,
  selectedConnectionIds,
  allSelected,
  selectionSummary,
  autoRefreshSummary,
  selectedAutoRefreshSummary,
  selectedEmailSummary,
  selectedConnections,
  manualRefreshing,
  manualRefreshResults,
  manualRefreshSummary,
  isConnectionsSortActive,
  connectionsSortDirection,
  oneByOneRunning,
  oneByOneStopping,
  oneByOneCurrentConnectionId,
  oneByOneResults,
  oneByOneSummary,
  providerStrategy,
  providerStickyLimit,
  isSelected,
  toggleSelectConnection,
  toggleSelectAllConnections,
  setSelectedConnectionsAutoRefresh,
  handleManualRefreshSelected,
  copySelectedEmails,
  clearSelection,
  clearManualRefreshResults,
  handleToggleConnectionsSort,
  handleAutoPriorityVisibleConnections,
  onConfirmDeleteSelectedConnections,
  handleRunOneByOneTest,
  handleStopOneByOneTest,
  openBulkProxyModal,
  handleRoundRobinToggle,
  handleStickyLimitChange,
  handleSwapPriority,
  handleUpdateConnectionStatus,
  handleUpdateProxy,
  handleDeleteConnection,
  onOpenEditConnection,
  onTriggerOAuthConnection,
  onTriggerApiKeyConnection,
  onTriggerAddConnection,
  onOpenIFlowCookieModal,
}) {
  if (isFreeNoAuth) {
    return <NoAuthProxyCard providerId={providerId} />;
  }

  return (
    <Card>
      <ProviderConnectionsToolbar
        connectionsCount={connections.length}
        providerId={providerId}
        allSelected={allSelected}
        selectionSummary={selectionSummary}
        selectedConnectionIds={selectedConnectionIds}
        accountStatusFilter={accountStatusFilter}
        onAccountStatusFilterChange={onAccountStatusFilterChange}
        manualRefreshing={manualRefreshing}
        selectedEmailSummary={selectedEmailSummary}
        toggleSelectAllConnections={toggleSelectAllConnections}
        setSelectedConnectionsAutoRefresh={setSelectedConnectionsAutoRefresh}
        handleManualRefreshSelected={handleManualRefreshSelected}
        copySelectedEmails={copySelectedEmails}
        clearSelection={clearSelection}
        clearManualRefreshResults={clearManualRefreshResults}
        manualRefreshSummary={manualRefreshSummary}
        isConnectionsSortActive={isConnectionsSortActive}
        connectionsSortDirection={connectionsSortDirection}
        handleToggleConnectionsSort={handleToggleConnectionsSort}
        handleAutoPriorityVisibleConnections={handleAutoPriorityVisibleConnections}
        onConfirmDeleteSelectedConnections={onConfirmDeleteSelectedConnections}
        oneByOneRunning={oneByOneRunning}
        oneByOneStopping={oneByOneStopping}
        handleRunOneByOneTest={handleRunOneByOneTest}
        handleStopOneByOneTest={handleStopOneByOneTest}
        proxyPoolsLength={proxyPools.length}
        openBulkProxyModal={openBulkProxyModal}
        providerStrategy={providerStrategy}
        handleRoundRobinToggle={handleRoundRobinToggle}
        providerStickyLimit={providerStickyLimit}
        handleStickyLimitChange={handleStickyLimitChange}
      />

      <ProviderConnectionsSummary
        providerId={providerId}
        autoRefreshSummary={autoRefreshSummary}
        selectedConnectionsCount={selectedConnections.length}
        selectedAutoRefreshSummary={selectedAutoRefreshSummary}
        manualRefreshSummary={manualRefreshSummary}
      />

      {connections.length === 0 ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <span className="material-symbols-outlined text-[18px]">
                {isOAuth ? "lock" : "key"}
              </span>
            </div>
            <div className="min-w-0">
              <p className="text-sm text-text-muted">No connections yet</p>
              {hasDualAuthModes && (
                <p className="text-xs text-text-muted">
                  Choose {oauthConnectionLabel} or {apiKeyConnectionLabel}.
                </p>
              )}
            </div>
          </div>
          <div className="flex gap-2">
            {hasDualAuthModes ? (
              <>
                <Button
                  size="sm"
                  icon="lock"
                  variant="secondary"
                  onClick={onTriggerOAuthConnection}
                >
                  {oauthConnectionLabel}
                </Button>
                <Button
                  size="sm"
                  icon="key"
                  onClick={onTriggerApiKeyConnection}
                >
                  {apiKeyConnectionLabel}
                </Button>
              </>
            ) : (
              <>
                {!isCompatible && providerId === "iflow" && (
                  <Button
                    size="sm"
                    icon="cookie"
                    variant="secondary"
                    onClick={onOpenIFlowCookieModal}
                  >
                    Cookie
                  </Button>
                )}
                <Button size="sm" icon="add" onClick={onTriggerAddConnection}>
                  {isCompatible
                    ? "Add API Key"
                    : providerId === "iflow"
                      ? "OAuth"
                      : "Add Connection"}
                </Button>
              </>
            )}
          </div>
        </div>
      ) : (
        <>
          {oneByOneSummary && (
            <div className="mb-4 rounded-lg border border-black/10 bg-black/[0.02] px-3 py-2 text-xs text-text-muted dark:border-white/10 dark:bg-white/[0.03]">
              <div className="flex flex-wrap items-center gap-3">
                <span>Total: {oneByOneSummary.total}</span>
                <span>Completed: {oneByOneSummary.completed}</span>
                <span>Passed: {oneByOneSummary.passed}</span>
                <span>Failed: {oneByOneSummary.failed}</span>
                {oneByOneSummary.stopped && (
                  <span className="text-amber-600 dark:text-amber-400">
                    Stopped
                  </span>
                )}
                {oneByOneRunning && oneByOneCurrentConnectionId && (
                  <span>
                    Running:{" "}
                    {connections.find(
                      (conn) => conn.id === oneByOneCurrentConnectionId,
                    )?.name || oneByOneCurrentConnectionId}
                  </span>
                )}
              </div>
            </div>
          )}

          {displayedConnections.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-surface-2/40 px-4 py-8 text-center">
              <span className="material-symbols-outlined text-[32px] text-text-muted">
                filter_alt_off
              </span>
              <p className="mt-2 text-sm font-medium text-text-main">
                No accounts match this filter
              </p>
              <p className="mt-1 text-xs text-text-muted">
                Switch back to All accounts to see every connection.
              </p>
            </div>
          ) : (
            <ProviderConnectionsList
              displayedConnections={displayedConnections}
              connections={connections}
              proxyPools={proxyPools}
              isOAuth={isOAuth}
              isSelected={isSelected}
              toggleSelectConnection={toggleSelectConnection}
              handleSwapPriority={handleSwapPriority}
              handleUpdateConnectionStatus={handleUpdateConnectionStatus}
              handleUpdateProxy={handleUpdateProxy}
              openEditConnection={onOpenEditConnection}
              handleDelete={handleDeleteConnection}
              oneByOneResults={oneByOneResults}
              manualRefreshResults={manualRefreshResults}
              manualRefreshing={manualRefreshing}
              isConnectionsSortActive={isConnectionsSortActive}
            />
          )}

          {!isCompatible && (
            <div className="mt-4 grid grid-cols-1 gap-2 sm:flex">
              {providerId === "iflow" && (
                <Button
                  size="sm"
                  icon="cookie"
                  variant="secondary"
                  onClick={onOpenIFlowCookieModal}
                  title="Add connection using browser cookie"
                  className="w-full sm:w-auto"
                >
                  Cookie
                </Button>
              )}
              {hasDualAuthModes ? (
                <>
                  <Button
                    size="sm"
                    icon="lock"
                    variant="secondary"
                    onClick={onTriggerOAuthConnection}
                    className="w-full sm:w-auto"
                  >
                    {oauthConnectionLabel}
                  </Button>
                  <Button
                    size="sm"
                    icon="key"
                    onClick={onTriggerApiKeyConnection}
                    className="w-full sm:w-auto"
                  >
                    {apiKeyConnectionLabel}
                  </Button>
                </>
              ) : (
                <Button
                  size="sm"
                  icon="add"
                  onClick={onTriggerAddConnection}
                  className="w-full sm:w-auto"
                >
                  Add
                </Button>
              )}
            </div>
          )}
        </>
      )}
    </Card>
  );
}
