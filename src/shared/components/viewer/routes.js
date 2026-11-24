// Exact matches only. New dashboard routes are admin-only until reviewed.
export const viewerPages = {
  "/dashboard/endpoint": { title: "Endpoint & Key", api: "/api/keys?view=summary" },
  "/dashboard/providers": { title: "Providers", api: "/api/providers/summary" },
  "/dashboard/combos": { title: "Combos", api: "/api/combos" },
  "/dashboard/usage": { title: "Usage", api: "/api/usage/stats" },
};

export function viewerPage(pathname) {
  return viewerPages[pathname === "/dashboard" ? "/dashboard/endpoint" : pathname] ?? null;
}
