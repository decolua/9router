export const STATUS_FILTER_OPTIONS = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
  { value: "none", label: "No connection" },
];

// noAuth providers (e.g. free proxies) are always usable even though they
// never have a stored connection record, so they never fall into "none".
export function getConnectionStatus(stats, isNoAuth = false) {
  if (isNoAuth) return "active";
  if (!stats || stats.total === 0) return "none";
  return stats.allDisabled ? "inactive" : "active";
}

export function matchesStatusFilter(statusFilter, stats, isNoAuth = false) {
  if (statusFilter === "all") return true;
  return getConnectionStatus(stats, isNoAuth) === statusFilter;
}

// Build the { id, priority } writes that persist `next` (the re-ordered
// list): every row gets its final 1-based position — the same meaning the
// server gives it (connectionsRepo orders by priority ASC and renumbers
// 1..N after every change).
//
// Every row must be written, not only the moved ones: if the stored
// priorities contain duplicates (bulk imports can create ties), the server
// re-breaks those ties by most-recently-updated on each PUT, so skipping a
// tied row lets it drift to a position the user did not ask for. Writing
// all positions keeps every write collision-free and converges regardless
// of what is already stored.
//
// The writes MUST be sent sequentially in ascending position order: the
// server renumbers 1..N after each PUT, and ascending order keeps every
// later write's target position valid in the intermediate state.
export function buildPriorityUpdates(next) {
  if (next.every((row, i) => row && row.id && row.priority === i + 1)) {
    return [];
  }
  return next
    .map((row, i) => ({ id: row.id, priority: i + 1 }))
    .filter((row) => Boolean(row.id));
}
