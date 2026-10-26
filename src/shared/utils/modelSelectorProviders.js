// Helpers for the model picker (combo / adapter / CLI-tools selectors).
//
// The picker must only offer providers the runtime can actually serve.
// Credentials are resolved with `getProviderConnections({ provider, isActive: true })`
// (src/sse/services/auth.js) and `/v1/models` filters `isActive !== false`
// (src/app/api/v1/models/route.js), so a provider whose connections are all disabled
// answers `404 No active credentials for provider: <id>` on every request — yet it used
// to stay selectable in the picker, which let operators build combos that can never serve.
//
// Connections created before the `isActive` column existed have no flag at all; they are
// still routed, so they must stay visible (`isActive !== false`, never a truthiness check).

/**
 * A connection is connectable when it is not explicitly disabled and its provider is not
 * marked `hidden` in the registry (hidden entries are not offered in the dashboard either).
 */
export function isConnectableConnection(connection, providers = {}) {
  if (!connection || connection.isActive === false) return false;
  return !providers?.[connection.provider]?.hidden;
}

/**
 * Filter the `/api/providers` connection list down to the ones the picker may render.
 * Accepts anything (a failed fetch yields undefined) and never throws.
 */
export function selectConnectableProviders(connections, providers = {}) {
  if (!Array.isArray(connections)) return [];
  return connections.filter((connection) => isConnectableConnection(connection, providers));
}

/**
 * Providers that need no credentials are always selectable, except the ones the registry
 * hides (e.g. `mimo-free`, whose free-ai catalog is not guaranteed to exist upstream).
 */
export function selectNoAuthProviderIds(freeProviders = {}) {
  return Object.keys(freeProviders).filter(
    (id) => freeProviders[id]?.noAuth && !freeProviders[id]?.hidden,
  );
}
