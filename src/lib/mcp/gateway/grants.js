// Per-grant tool filter helpers.
//
// The gateway enforces two layers of visibility for every key:
//   1. Which instances the key has been granted (mcpKeyGrants.instanceId)
//   2. Which tools within each granted instance are visible
//      (mcpKeyGrants.toolAllowlist, a JSON array of bare names; null = all)
//
// These helpers are called from BOTH the tools/list filter site AND the
// tools/call dispatch site, so a key whose allowlist excludes a tool
// cannot see it in lists AND cannot call it directly.

/**
 * @param {string|null|undefined} bareName
 * @param {string} instanceSlug
 * @param {Array<{instanceId: string, toolAllowlist: string[]|null}>} grants
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
 *
 * Input tools have the namespaced form `instanceSlug__bareName`. We map
 * each to the underlying instance, then apply the per-grant allowlist.
 *
 * @param {Array<{name: string, description?: string, inputSchema?: object}>} tools
 * @param {Array<{instanceId: string, slug?: string, toolAllowlist: string[]|null}>} grants
 * @returns {Array} filtered tools (may be empty)
 */
export function filterToolsByGrants(tools, grants) {
  if (!Array.isArray(tools)) return [];
  if (!Array.isArray(grants) || grants.length === 0) return [];
  // Build a slug → grant lookup. `slug` is not part of mcpKeyGrants
  // directly — callers are expected to pass a grants list enriched with
  // `slug` (handler does this). If absent, fall back to instanceId.
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
