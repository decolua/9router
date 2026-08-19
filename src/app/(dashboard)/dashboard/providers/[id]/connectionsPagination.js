// Pure-math pagination for the provider detail connections list.
// Used by src/app/(dashboard)/dashboard/providers/[id]/page.js
// and guarded by tests/unit/provider-connections-pagination.test.js.

export const CONNECTIONS_PER_PAGE = 10;
export const CONNECTIONS_MAX_PAGE_SIZE = 200;

export function computeConnectionPagination(connections = [], page = 1, pageSize = CONNECTIONS_PER_PAGE) {
  const list = Array.isArray(connections) ? connections : [];
  const size = Number.isFinite(pageSize) && pageSize >= 1 ? Math.floor(pageSize) : CONNECTIONS_PER_PAGE;
  const totalItems = list.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / size));
  const numeric = Math.floor(Number(page));
  const safePage = Number.isFinite(numeric) && numeric > 0 ? numeric : 1;
  const currentPage = Math.min(safePage, totalPages);
  const start = (currentPage - 1) * size;
  const items = list.slice(start, start + size);
  return { currentPage, totalPages, totalItems, start, items, pageSize: size };
}
