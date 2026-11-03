// Pure helpers for the API-key policy allow list edited in the dashboard.
// Kept separate from the component so the add/remove contract can be unit
// tested: ModelSelectModal's "Select All" / "Deselect All" calls the per-item
// callbacks synchronously in a forEach, so each call must derive its result
// from the latest list rather than a render-time snapshot.

export const sameEntry = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

/**
 * Append `value` unless it is already present (case-insensitive, first spelling
 * wins). Returns `list` itself when nothing was added, so callers can skip the
 * state update.
 */
export function addPolicyModelEntry(list, value) {
  const current = Array.isArray(list) ? list : [];
  const unchanged = !value || current.some((entry) => sameEntry(entry, value));
  if (unchanged) return Array.isArray(list) ? list : current;
  return [...current, value];
}

/**
 * Remove every entry matching `value` (case-insensitive). Returns `list` itself
 * when nothing matched.
 */
export function removePolicyModelEntry(list, value) {
  const current = Array.isArray(list) ? list : [];
  const next = current.filter((entry) => !sameEntry(entry, value));
  if (next.length === current.length) return Array.isArray(list) ? list : current;
  return next;
}

/**
 * Edit-form updater for onSelect. `prev` is the previous edit form; the return
 * value is the next one, or `prev` itself when nothing changed so React can bail
 * out of the re-render. Designed for setEditForm((prev) => ...).
 */
export function applyPolicyModelSelect(prev, value) {
  const base = prev || {};
  const current = Array.isArray(base.accessAllow) ? base.accessAllow : [];
  const accessAllow = addPolicyModelEntry(current, value);
  return accessAllow === current ? base : { ...base, accessAllow };
}

/** Edit-form updater for onDeselect; same contract as applyPolicyModelSelect. */
export function applyPolicyModelDeselect(prev, value) {
  const base = prev || {};
  const current = Array.isArray(base.accessAllow) ? base.accessAllow : [];
  const accessAllow = removePolicyModelEntry(current, value);
  return accessAllow === current ? base : { ...base, accessAllow };
}
