export const BULK_DELETE_CONCURRENCY = 5;

export function getConnectionSelectionState(connections = [], selectedConnectionIds = []) {
  const selectedIdSet = new Set(selectedConnectionIds);
  const selectedConnections = connections.filter((connection) =>
    selectedIdSet.has(connection.id),
  );
  const selectedIds = selectedConnections.map((connection) => connection.id);

  return {
    selectedConnections,
    selectedIds,
    selectedCount: selectedConnections.length,
    allSelected:
      connections.length > 0 && selectedConnections.length === connections.length,
    hasSelection: selectedConnections.length > 0,
  };
}

export function removeConnectionsById(connections = [], deletedConnectionIds = []) {
  const deletedIdSet = new Set(deletedConnectionIds);
  return connections.filter((connection) => !deletedIdSet.has(connection.id));
}

async function runWithConcurrency(items, limit, worker) {
  if (!items.length) return;
  const safeLimit = Math.max(1, Math.min(limit, items.length));
  let nextIndex = 0;

  await Promise.all(
    Array.from({ length: safeLimit }, async () => {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        await worker(items[currentIndex], currentIndex);
      }
    }),
  );
}

export async function deleteProviderConnections(
  connectionIds = [],
  {
    fetchFn = globalThis.fetch,
    concurrency = BULK_DELETE_CONCURRENCY,
  } = {},
) {
  if (typeof fetchFn !== "function") {
    throw new Error("fetchFn is required");
  }

  const uniqueIds = Array.from(new Set(connectionIds.filter(Boolean)));
  const resultById = new Map();

  await runWithConcurrency(uniqueIds, concurrency, async (id) => {
    try {
      const response = await fetchFn(`/api/providers/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });

      if (response.ok) {
        resultById.set(id, { ok: true });
      } else {
        resultById.set(id, { ok: false, status: response.status });
      }
    } catch (error) {
      resultById.set(id, { ok: false, error });
    }
  });

  return {
    deletedIds: uniqueIds.filter((id) => resultById.get(id)?.ok),
    failed: uniqueIds
      .filter((id) => resultById.get(id)?.ok !== true)
      .map((id) => {
        const result = resultById.get(id) || {};
        if (result.status) return { id, status: result.status };
        return { id, error: result.error };
      }),
  };
}
