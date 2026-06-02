import ConnectionRow from "./ConnectionRow";

export default function ProviderConnectionsList({
  displayedConnections,
  connections,
  proxyPools,
  isOAuth,
  isSelected,
  toggleSelectConnection,
  handleSwapPriority,
  handleUpdateConnectionStatus,
  handleUpdateProxy,
  openEditConnection,
  handleDelete,
  oneByOneResults,
  manualRefreshResults,
  manualRefreshing,
  isConnectionsSortActive,
  warmupResults,
  handleWarmupSingle,
}) {
  return (
    <div className="flex min-w-0 flex-col divide-y divide-black/[0.03] dark:divide-white/[0.03]">
      {displayedConnections.map((conn, index) => {
        const originalIndex = connections.findIndex(
          (item) => item.id === conn.id,
        );
        return (
          <div key={conn.id} className="flex min-w-0 items-stretch">
            <div className="min-w-0 flex-1">
              <ConnectionRow
                index={index}
                connection={conn}
                proxyPools={proxyPools}
                isOAuth={isOAuth}
                isSelected={isSelected(conn.id)}
                onSelectChange={(checked, isShift) =>
                  toggleSelectConnection(conn.id, isShift)
                }
                isFirst={index === 0}
                isLast={index === displayedConnections.length - 1}
                onMoveUp={() =>
                  handleSwapPriority(originalIndex, originalIndex - 1)
                }
                onMoveDown={() =>
                  handleSwapPriority(originalIndex, originalIndex + 1)
                }
                onToggleActive={(isActive) =>
                  handleUpdateConnectionStatus(conn.id, isActive)
                }
                onUpdateProxy={(proxyPoolId) =>
                  handleUpdateProxy(conn.id, proxyPoolId)
                }
                onEdit={() => openEditConnection(conn)}
                onDelete={() => handleDelete(conn.id)}
                oneByOneStatus={oneByOneResults[conn.id] || null}
                manualRefreshStatus={
                  manualRefreshResults[conn.id] ||
                  (manualRefreshing && isSelected(conn.id)
                    ? { state: "refreshing" }
                    : null)
                }
                disablePriorityControls={isConnectionsSortActive}
                onWarmup={(options) => handleWarmupSingle(conn.id, options)}
                warmupStatus={warmupResults[conn.id] || null}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
