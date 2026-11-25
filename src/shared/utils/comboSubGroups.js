/**
 * Adds a second level to groups produced by groupDataByKey: each API key's
 * items are bucketed by the combo that was called into `subGroups` (same shape
 * as a group), so the table reads key → combo → the models that answered.
 * Direct model calls — and rows recorded before combos were tracked — have no
 * combo and land in groupFn's fallback bucket. Returns new objects; the input
 * groups are not mutated.
 *
 * `groupFn` is groupDataByKey, injected so this stays a plain JS module that
 * doesn't import the JSX-heavy UsageStats component.
 *
 * @param {Array} groups - Output of groupDataByKey
 * @param {(items: Array, keyField: string) => Array} groupFn
 * @returns {Array}
 */
export function withComboSubGroups(groups, groupFn) {
  if (!Array.isArray(groups)) return [];
  return groups.map((group) => ({
    ...group,
    subGroups: groupFn(group.items, "combo"),
  }));
}
