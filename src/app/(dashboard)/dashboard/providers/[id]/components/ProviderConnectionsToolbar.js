import { Button, Toggle } from "@/shared/components";

export default function ProviderConnectionsToolbar({
  connectionsCount,
  providerId,
  allSelected,
  selectionSummary,
  selectedConnectionIds,
  manualRefreshing,
  selectedEmailSummary,
  toggleSelectAllConnections,
  setSelectedConnectionsAutoRefresh,
  handleManualRefreshSelected,
  copySelectedEmails,
  clearSelection,
  clearManualRefreshResults,
  manualRefreshSummary,
  isConnectionsSortActive,
  connectionsSortDirection,
  handleToggleConnectionsSort,
  oneByOneRunning,
  oneByOneStopping,
  handleRunOneByOneTest,
  handleStopOneByOneTest,
  proxyPoolsLength,
  openBulkProxyModal,
  providerStrategy,
  handleRoundRobinToggle,
  providerStickyLimit,
  handleStickyLimitChange,
}) {
  return (
    <div className="mb-4 flex flex-col gap-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <h2 className="text-lg font-semibold">Connections</h2>
        <div className="flex min-w-0 flex-1 flex-col gap-3 lg:items-end">
          {connectionsCount > 0 && providerId === "codex" && (
            <div className="flex w-full flex-wrap items-center gap-2 lg:justify-end">
              <label className="flex items-center gap-2 text-xs text-text-muted">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleSelectAllConnections}
                  className="rounded border-border"
                />
                Select all ({selectionSummary})
              </label>
              <Button
                size="sm"
                variant="secondary"
                icon="toggle_on"
                onClick={() => setSelectedConnectionsAutoRefresh(true)}
                disabled={selectedConnectionIds.length === 0}
              >
                Bật auto refresh
              </Button>
              <Button
                size="sm"
                variant="ghost"
                icon="toggle_off"
                onClick={() => setSelectedConnectionsAutoRefresh(false)}
                disabled={selectedConnectionIds.length === 0}
              >
                Tắt auto refresh
              </Button>
              <Button
                size="sm"
                variant={manualRefreshing ? "secondary" : "ghost"}
                icon="refresh"
                onClick={handleManualRefreshSelected}
                disabled={
                  manualRefreshing || selectedConnectionIds.length === 0
                }
              >
                {manualRefreshing
                  ? "Refreshing selected..."
                  : `Refresh selected now (${selectedConnectionIds.length})`}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                icon="content_copy"
                onClick={copySelectedEmails}
                disabled={selectedConnectionIds.length === 0}
              >
                Copy email ({selectedEmailSummary})
              </Button>
              <Button
                size="sm"
                variant="ghost"
                icon="clear_all"
                onClick={() => {
                  clearSelection();
                  clearManualRefreshResults();
                }}
                disabled={
                  selectedConnectionIds.length === 0 && !manualRefreshSummary
                }
              >
                Clear
              </Button>
            </div>
          )}

          <div className="flex w-full flex-wrap items-center gap-2 lg:justify-end">
            <Button
              size="sm"
              variant={isConnectionsSortActive ? "secondary" : "ghost"}
              icon="schedule"
              onClick={handleToggleConnectionsSort}
            >
              {connectionsSortDirection === "asc"
                ? "Expire at ↑"
                : connectionsSortDirection === "desc"
                  ? "Expire at ↓"
                  : "Sort Expire at"}
            </Button>

            {connectionsCount > 0 && providerId === "codex" && (
              <Button
                size="sm"
                variant="secondary"
                icon="sync"
                onClick={handleRunOneByOneTest}
                disabled={oneByOneRunning}
              >
                {oneByOneRunning
                  ? "Testing Connection One-by-One..."
                  : "Test Connection One-by-One"}
              </Button>
            )}
            {providerId === "codex" && oneByOneRunning && (
              <Button
                size="sm"
                variant="ghost"
                icon="stop"
                onClick={handleStopOneByOneTest}
                disabled={oneByOneStopping}
              >
                {oneByOneStopping ? "Stopping..." : "Stop"}
              </Button>
            )}

            {connectionsCount > 0 && proxyPoolsLength > 0 && (
              <Button
                size="sm"
                variant="secondary"
                icon="lan"
                onClick={openBulkProxyModal}
              >
                Apply Proxy (all)
              </Button>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-text-muted">
                Round Robin
              </span>
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
                    className="w-14 rounded-md border border-border bg-background px-2 py-1 text-xs focus:border-primary focus:outline-none"
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
