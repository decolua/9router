/** Usage visibility: members always see only their own data. */
export const USAGE_SCOPE_MINE = "mine";
export const USAGE_SCOPE_ALL = "all";

/**
 * Resolve which user's usage rows to include.
 * @returns {string|null} user id to filter by, or null for org-wide (admin only)
 */
export function resolveUsageFilterUserId(user, scopeParam) {
  if (user?.role === "admin" && scopeParam === USAGE_SCOPE_ALL) {
    return null;
  }
  return user?.id || null;
}

export function usageScopeQueryString(scope) {
  return scope === USAGE_SCOPE_ALL ? "scope=all" : "scope=mine";
}

export function appendUsageScope(searchParams, scope) {
  const params = new URLSearchParams(searchParams);
  params.set("scope", scope === USAGE_SCOPE_ALL ? USAGE_SCOPE_ALL : USAGE_SCOPE_MINE);
  return params.toString();
}
