import { MAX_KEY_CONNECTIONS } from "../constants/keyConnections.js";

export function validateKeyConnections(value) {
  if (value === null) return { value: [] };
  if (!Array.isArray(value) || value.length > MAX_KEY_CONNECTIONS) {
    return { error: `allowedConnections must be an array of at most ${MAX_KEY_CONNECTIONS} IDs` };
  }
  if (value.some(id => typeof id !== "string" || !id.trim()) || new Set(value).size !== value.length) {
    return { error: "allowedConnections must contain unique, nonempty string IDs" };
  }
  return { value };
}

export function groupKeyConnections(ids, providers, resolveProviderId) {
  const groups = new Map();
  for (const id of ids) {
    const provider = Object.hasOwn(providers, id) && providers[id];
    if (typeof provider !== "string" || !provider) throw new Error("Missing pinned provider");
    const providerId = resolveProviderId(provider);
    if (!groups.has(providerId)) groups.set(providerId, new Set());
    groups.get(providerId).add(id);
  }
  return groups;
}

export function accountLabel(account) {
  const name = account.name || account.displayName;
  if (name && account.email && name !== account.email) return name + " · " + account.email;
  return name || account.email || account.id;
}

// No IDs for a provider means every account (including future accounts) is allowed.
export function toggleAccount(selection, connections, id, on) {
  const account = connections.find(item => item.id === id);
  if (!account) return selection;
  const ids = connections.filter(item => item.provider === account.provider).map(item => item.id);
  const group = new Set(ids);
  const pinned = selection.filter(value => group.has(value));
  const enabled = new Set(pinned.length ? pinned : ids);
  if (on) enabled.add(id);
  else enabled.delete(id);
  if (!enabled.size) return selection;

  const next = selection.filter(value => !group.has(value));
  if (enabled.size !== ids.length) next.push(...enabled);
  return next.length <= MAX_KEY_CONNECTIONS ? next : selection;
}
