/**
 * Base URL handling for connections whose provider declares `connectionBaseUrl`
 * in the registry (self-hosted TTS / STT today).
 *
 * The value is stored as `providerSpecificData.baseUrl`, which is the key the
 * runtime reads (`sttCore`'s endpoint override, `selfhostedTts.synthesize`).
 * The rest of `providerSpecificData` belongs to other parts of the form — proxy
 * settings, region — so it is merged through rather than replaced, and clearing
 * the field removes only `baseUrl` so the provider falls back to its default.
 *
 * @param {object|null|undefined} providerSpecificData  the connection's current value
 * @param {string} baseUrl                              the field's raw value
 * @returns {object|undefined}                          undefined when nothing is left to store
 */
export function withConnectionBaseUrl(providerSpecificData, baseUrl) {
  const merged = { ...(providerSpecificData || {}) };
  const trimmed = typeof baseUrl === "string" ? baseUrl.trim() : "";

  if (trimmed) merged.baseUrl = trimmed;
  else delete merged.baseUrl;

  return Object.keys(merged).length > 0 ? merged : undefined;
}
