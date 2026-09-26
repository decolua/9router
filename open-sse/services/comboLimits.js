/**
 * Token limits a combo pool can honour.
 *
 * A request routed to a combo may land on any member, so the pool can only
 * promise what its *smallest* member accepts. Anything larger is a limit some
 * member will reject.
 *
 * `capsFor` receives one member reference ("alias/model-id") and returns that
 * model's capabilities; passing it in keeps this pure and lets the caller own
 * the alias-to-provider mapping.
 *
 * Members whose capabilities carry no usable number are skipped rather than
 * treated as zero. When no member reports one, the field comes back undefined
 * and the caller omits it - an absent field lets a client fall back, a wrong
 * one does not.
 */
export function comboTokenLimits(members, capsFor) {
  const lowest = { contextWindow: undefined, maxOutput: undefined };
  if (!Array.isArray(members)) return lowest;

  for (const ref of members) {
    if (typeof ref !== "string" || ref.trim() === "") continue;
    const caps = capsFor(ref) || {};
    for (const field of ["contextWindow", "maxOutput"]) {
      const value = caps[field];
      if (!Number.isFinite(value) || value <= 0) continue;
      lowest[field] = lowest[field] === undefined ? value : Math.min(lowest[field], value);
    }
  }
  return lowest;
}

/** Split a combo member reference into its provider alias and model id. */
export function splitModelRef(ref) {
  const slash = ref.indexOf("/");
  if (slash === -1) return { alias: "", modelId: ref };
  return { alias: ref.slice(0, slash), modelId: ref.slice(slash + 1) };
}
