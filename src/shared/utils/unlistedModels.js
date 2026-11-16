/**
 * Models a provider reports that this install does not list.
 *
 * The model catalog is hand-maintained, so a model released yesterday stays
 * invisible until someone edits `open-sse/config/providerModels.js`. The
 * provider itself knows the current list, and the provider page can ask for it
 * — cursor and zed always do, because the registry carries nothing usable for
 * them, and every other provider asks when the operator presses the button.
 *
 * This is the difference: what the provider offers, minus what is already on
 * the page. Kept out of the component so it can be tested, and because "which
 * models are missing" is a question about data, not about rendering.
 */

/**
 * @param {object} args
 * @param {Array<object>} args.liveModels what the provider reported
 * @param {Array<object>} args.listedModels the catalog's models, already shown
 * @param {Array<object>} args.customModelRows models added by hand, also shown
 * @returns {Array<{ id: string, name: string }>} in the provider's own order
 */
export function unlistedLiveModels({ liveModels, listedModels = [], customModelRows = [] }) {
  if (!Array.isArray(liveModels) || liveModels.length === 0) return [];

  const known = new Set();
  for (const model of [...listedModels, ...customModelRows]) {
    const id = model?.id;
    if (id) known.add(id);
  }

  const unlisted = [];
  for (const entry of liveModels) {
    // Providers disagree about which field holds the id; the live endpoint
    // normalises most of them, and this covers the rest.
    const id = typeof entry === "string" ? entry : (entry?.id || entry?.name);
    if (typeof id !== "string" || !id) continue;
    // A provider listing the same model twice should not produce two buttons
    // that do the same thing.
    if (known.has(id)) continue;
    known.add(id);
    unlisted.push({ id, name: (typeof entry === "object" && entry?.name) || id });
  }
  return unlisted;
}

export default unlistedLiveModels;
