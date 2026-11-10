export function filterProxyPools(pools, status) {
  if (status === "enabled") return pools.filter(pool => pool.isActive === true);
  if (status === "disabled") return pools.filter(pool => pool.isActive !== true);
  return pools;
}

// Bulk actions must never include rows hidden by the current filter.
export function getVisibleProxyPoolSelection(pools, selectedIds) {
  const selected = new Set(selectedIds);
  return pools.filter(pool => selected.has(pool.id)).map(pool => pool.id);
}

export function updateProxyPoolSelection(pools, selectedIds, { id, anchorId, checked, shiftKey }) {
  const ids = pools.map(pool => pool.id);
  const selected = new Set(getVisibleProxyPoolSelection(pools, selectedIds));
  const index = ids.indexOf(id);
  if (index === -1) return [...selected];
  const anchor = shiftKey ? ids.indexOf(anchorId) : -1;
  const range = anchor === -1 ? [id] : ids.slice(Math.min(anchor, index), Math.max(anchor, index) + 1);
  for (const target of range) {
    if (checked) selected.add(target);
    else selected.delete(target);
  }
  return ids.filter(target => selected.has(target));
}
