/**
 * Adds a second level to groups produced by groupDataByKey: each group's items
 * are bucketed by provider into `subGroups` (same shape as a group). Returns new
 * objects; the input groups are not mutated.
 *
 * `groupFn` is groupDataByKey, injected so this stays a plain JS module that
 * doesn't import the JSX-heavy UsageStats component.
 *
 * @param {Array} groups - Output of groupDataByKey
 * @param {(items: Array, keyField: string) => Array} groupFn
 * @returns {Array}
 */
export function withProviderSubGroups(groups, groupFn) {
  if (!Array.isArray(groups)) return [];
  return groups.map((group) => ({
    ...group,
    subGroups: groupFn(group.items, "provider"),
  }));
}
