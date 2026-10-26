/**
 * Providers the model picker may offer without an API-key connection.
 *
 * A registry entry marked `hidden` is internal/experimental: it must never be
 * selectable in the combos / media-combos / CLI-tools pickers, even when it
 * declares `noAuth` — otherwise the picker offers a model the runtime will not
 * serve. Providers whose connections are all disabled are filtered by the caller,
 * which has the connection list.
 *
 * Pure so it can be tested without rendering the modal.
 */
export function selectNoAuthProviderIds(freeProviders) {
  if (!freeProviders || typeof freeProviders !== "object") return [];
  return Object.keys(freeProviders).filter((id) => {
    const provider = freeProviders[id];
    return !!provider && provider.noAuth === true && provider.hidden !== true;
  });
}
