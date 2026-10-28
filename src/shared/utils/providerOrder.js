/**
 * Provider ordering for provider-grouped views (currently the Quota Tracker).
 *
 * Why this is stored separately from `providerConnections.priority`:
 *
 * `priority` is a PER-PROVIDER rank, not a global one. `createProviderConnection`
 * assigns MAX(priority)+1 scoped to `WHERE provider = ?`, and `reorderInTx`
 * renumbers 1..N scoped to the provider as well. Every provider's first
 * connection therefore ties at priority 1, and the quota panel broke that tie by
 * provider *name* — which pinned `antigravity` to the top with no way to move it.
 *
 * `priority` also drives account selection at request time (getProviderCredentials
 * picks the lowest-priority active connection, see src/sse/services/auth.js), so
 * dragging cards must never rewrite it: reordering the UI would silently change
 * which account serves traffic. The user's provider order lives in
 * `settings.providerOrder` instead, and only ever affects display order.
 */

// Guard the settings row against unbounded growth from a buggy/hostile client.
const MAX_ORDER_ENTRIES = 500;
const MAX_PROVIDER_ID_LENGTH = 200;

/**
 * Normalize anything that came out of settings (or a request body) into a clean
 * array of provider ids: strings only, trimmed, de-duplicated, first wins.
 */
export function sanitizeProviderOrder(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const id = entry.trim();
    if (!id || id.length > MAX_PROVIDER_ID_LENGTH) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= MAX_ORDER_ENTRIES) break;
  }
  return out;
}

/** Standard arrayMove semantics: remove at `from`, insert at `to`. */
export function moveInArray(list, from, to) {
  const next = [...list];
  if (!Number.isInteger(from) || !Number.isInteger(to)) return next;
  if (from < 0 || from >= next.length) return next;
  const target = Math.max(0, Math.min(next.length - 1, to));
  if (from === target) return next;
  const [moved] = next.splice(from, 1);
  next.splice(target, 0, moved);
  return next;
}

/**
 * Distinct provider ids in first-seen order. Connections of one provider are
 * contiguous in the quota panel, so this is the visible provider sequence.
 */
export function providerSequence(connections) {
  if (!Array.isArray(connections)) return [];
  const seen = new Set();
  const out = [];
  for (const conn of connections) {
    const provider = conn?.provider;
    if (typeof provider !== "string" || !provider || seen.has(provider)) continue;
    seen.add(provider);
    out.push(provider);
  }
  return out;
}

/**
 * Move every connection of `fromProvider` to the slot of `toProvider`.
 *
 * The relative order of connections *within* a provider is preserved on purpose:
 * that order is the account selection order at request time, so a provider-level
 * drag must not reshuffle accounts inside any provider.
 *
 * Returns the original array (same reference) when the move is a no-op, so
 * callers can cheaply detect "nothing to persist".
 */
export function moveProviderBlock(connections, fromProvider, toProvider) {
  if (!Array.isArray(connections) || !fromProvider || !toProvider) return connections;
  if (fromProvider === toProvider) return connections;

  const sequence = providerSequence(connections);
  const from = sequence.indexOf(fromProvider);
  const to = sequence.indexOf(toProvider);
  if (from === -1 || to === -1 || from === to) return connections;

  const nextSequence = moveInArray(sequence, from, to);
  const byProvider = new Map();
  for (const conn of connections) {
    const provider = conn?.provider;
    if (!byProvider.has(provider)) byProvider.set(provider, []);
    byProvider.get(provider).push(conn);
  }

  const ordered = [];
  for (const provider of nextSequence) {
    const group = byProvider.get(provider);
    if (group) ordered.push(...group);
  }
  // Defensive: anything not covered by the sequence keeps its position at the end.
  if (ordered.length !== connections.length) {
    const emitted = new Set(ordered);
    for (const conn of connections) if (!emitted.has(conn)) ordered.push(conn);
  }
  return ordered;
}

/**
 * Provider id → display rank. Providers absent from the stored order rank last
 * (Number.MAX_SAFE_INTEGER) so a newly added provider appears at the end rather
 * than jumping to the top. An empty order therefore leaves every comparator
 * untouched, which keeps the default behaviour byte-identical to before.
 */
export function providerRankMap(providerOrder) {
  const ranks = new Map();
  const order = sanitizeProviderOrder(providerOrder);
  order.forEach((provider, index) => {
    if (!ranks.has(provider)) ranks.set(provider, index);
  });
  return ranks;
}

/**
 * Comparator for /api/providers/client.
 *
 * `sort: "provider"` keeps its registry-order tiebreak; `sort: "priority"`
 * (the quota panel default) keeps its per-provider priority tiebreak. In both
 * cases the user's provider order is the primary key when it has an opinion.
 */
export function sortConnectionsByProviderOrder(connections, options = {}) {
  const { sort, providerOrder, usageOrder } = options;
  const list = Array.isArray(connections) ? [...connections] : [];
  const ranks = providerRankMap(providerOrder);
  const rankOf = (provider) =>
    ranks.has(provider) ? ranks.get(provider) : Number.MAX_SAFE_INTEGER;

  if (sort === "provider") {
    return list.sort((a, b) => {
      const rankDiff = rankOf(a.provider) - rankOf(b.provider);
      if (rankDiff !== 0) return rankDiff;
      const orderA = Array.isArray(usageOrder) ? usageOrder.indexOf(a.provider) : -1;
      const orderB = Array.isArray(usageOrder) ? usageOrder.indexOf(b.provider) : -1;
      if (orderA !== orderB) return orderA - orderB;
      return (a.provider || "").localeCompare(b.provider || "");
    });
  }

  return list.sort((a, b) => {
    const rankDiff = rankOf(a.provider) - rankOf(b.provider);
    if (rankDiff !== 0) return rankDiff;
    const priorityA = a.priority ?? Number.MAX_SAFE_INTEGER;
    const priorityB = b.priority ?? Number.MAX_SAFE_INTEGER;
    if (priorityA !== priorityB) return priorityA - priorityB;
    return (a.provider || "").localeCompare(b.provider || "");
  });
}
