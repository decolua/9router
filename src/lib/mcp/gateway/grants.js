// Per-grant tool filter helpers.

/**
 * Check whether a bare tool name is allowed for a given instance slug.
 * @param {string | null | undefined} bareName
 * @param {string} instanceSlug
 * @param {Array<{instanceId: string, slug?: string | null, toolAllowlist: string[] | null}>} grants
 * @returns {boolean}
 */
export function isToolAllowed(bareName, instanceSlug, grants) {
  if (!Array.isArray(grants) || grants.length === 0) return false;
  const grant = grants.find((g) => g.slug === instanceSlug || g.instanceId === instanceSlug);
  if (!grant) return false;
  if (!grant.toolAllowlist) return true; // null = all tools visible
  return grant.toolAllowlist.includes(bareName);
}

/**
 * Filter a tools/list response down to the caller's allowed set.
 * Input tools have the namespaced form `instanceSlug__bareName`.
 * @param {Array<{name: string, description?: string, inputSchema?: unknown}>} tools
 * @param {Array<{instanceId: string, slug?: string | null, toolAllowlist: string[] | null}>} grants
 * @returns {Array<object>} filtered tools (may be empty)
 */
export function filterToolsByGrants(tools, grants) {
  if (!Array.isArray(tools)) return [];
  if (!Array.isArray(grants) || grants.length === 0) return [];

  const grantBySlug = new Map();
  for (const g of grants) {
    if (g.slug) grantBySlug.set(g.slug, g);
    else if (g.instanceId) grantBySlug.set(g.instanceId, g);
  }

  return tools.filter((t) => {
    const idx = t.name.indexOf("__");
    if (idx <= 0) return false;
    const slug = t.name.slice(0, idx);
    const bare = t.name.slice(idx + 2);
    const g = grantBySlug.get(slug);
    if (!g) return false;
    if (!g.toolAllowlist) return true;
    return g.toolAllowlist.includes(bare);
  });
}
