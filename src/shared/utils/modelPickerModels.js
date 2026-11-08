/**
 * Merge the model sources shown for a passthrough provider in ModelSelectModal.
 *
 * User-defined models win over the live catalog, live entries fill in anything
 * the user has not overridden, and static models are the final fallback. The
 * picker uses `value` as the React key, so dedupe by it.
 *
 * Passthrough providers such as Zed have no static catalog in the registry;
 * their models are fetched live and must be merged here explicitly.
 */
export function mergePassthroughModels({
  registered = [],
  aliases = [],
  live = [],
  hardcoded = [],
  alias,
} = {}) {
  const liveEntries = (live || []).map((model) => ({
    id: model.id,
    name: model.name || model.id,
    value: `${alias}/${model.id}`,
    kind: model.kind || "llm",
  }));

  const seen = new Set();
  return [
    ...(registered || []),
    ...(aliases || []),
    ...liveEntries,
    ...(hardcoded || []),
  ].filter((model) => {
    if (!model?.value || seen.has(model.value)) return false;
    seen.add(model.value);
    return true;
  });
}
