/**
 * Check if a model is considered a "free" model.
 * Matches if m.isFree is true, or if id, name, or alias contains the word "free"
 * (case-insensitive, bounded by non-alphanumeric characters or string ends).
 *
 * @param {Object|string} m - Model object or model ID string
 * @returns {boolean}
 */
export function isFreeModel(m) {
  if (!m) return false;
  if (typeof m === "object" && m.isFree === true) return true;
  const id = typeof m === "string" ? m : (m.id || "");
  const name = typeof m === "string" ? "" : (m.name || "");
  const alias = typeof m === "string" ? "" : (m.alias || "");
  const freeRegex = /(^|[^a-zA-Z0-9])free([^a-zA-Z0-9]|$)/i;
  return freeRegex.test(id) || freeRegex.test(name) || freeRegex.test(alias);
}

export default isFreeModel;
