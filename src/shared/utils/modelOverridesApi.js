/**
 * API helpers for model metadata overrides.
 *
 * Endpoints:
 *   GET    /api/models/overrides?provider=<alias>  → { overrides: { "alias|model": {...} } }
 *   PUT    /api/models/overrides                   → body: { provider, model, override }
 *   DELETE /api/models/overrides?provider=<alias>&model=<id>
 */

/**
 * Fetch all overrides for a provider.
 * @param {string} provider - provider alias
 * @returns {Promise<Record<string, object>>} map of "model" → override object
 */
export async function fetchModelOverrides(provider) {
  const res = await fetch(
    `/api/models/overrides?provider=${encodeURIComponent(provider)}`,
    { cache: "no-store" }
  );
  if (!res.ok) throw new Error("Failed to fetch model overrides");
  const data = await res.json();
  return data.overrides || {};
}

/**
 * Set (upsert) a metadata override for one model.
 * @param {string} provider - provider alias
 * @param {string} model    - model ID
 * @param {object} override - partial override fields
 * @returns {Promise<object>} saved override
 */
export async function setModelOverride(provider, model, override) {
  const res = await fetch("/api/models/overrides", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider, model, override }),
  });
  const data = await res.json();
  if (!res.ok) {
    const msg = data.details
      ? data.details.join("; ")
      : data.error || "Failed to save override";
    throw new Error(msg);
  }
  return data.override;
}

/**
 * Delete the override for one model (reverts to defaults).
 * @param {string} provider - provider alias
 * @param {string} model    - model ID
 * @returns {Promise<void>}
 */
export async function deleteModelOverride(provider, model) {
  const res = await fetch(
    `/api/models/overrides?provider=${encodeURIComponent(provider)}&model=${encodeURIComponent(model)}`,
    { method: "DELETE" }
  );
  if (!res.ok) throw new Error("Failed to delete override");
}
