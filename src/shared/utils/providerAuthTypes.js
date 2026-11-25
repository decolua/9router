/**
 * Which connection `authType` values belong to one provider card.
 *
 * The Providers grid counts a provider's connections by filtering the whole
 * connection list down to the ones whose authType this returns. Miss a value
 * and the card reports "No connections" for accounts that exist and work —
 * which is exactly what happened to claude-cli, an `authModes: ["none"]`
 * provider: its connections are stored with authType "none", and this
 * collapsed anything without an apikey mode to "oauth" alone, dropping it
 * before its status was ever looked at.
 *
 * Kept out of the page component so it can be tested directly.
 *
 * @param {{ authModes?: string[] }} [info] registry entry for the provider
 * @param {string} key provider id
 * @param {{ freeTier?: object, apiKey?: object }} [fallbacks]
 *   provider tables consulted only when the registry declares no authModes
 * @returns {string[]} authType values to count for this provider
 */
export function providerAuthTypes(info, key, fallbacks = {}) {
  // kiro declares no authModes but accepts both, and its headless flow writes
  // "api_key" rather than "apikey".
  if (key === "kiro") return ["oauth", "apikey", "api_key"];

  const modes = info?.authModes;

  // Free-tier and API-key providers support apikey even when the registry entry
  // omits authModes (cloudflare-ai, byteplus, ollama, vertex) — otherwise their
  // apikey connections are invisible on the grid card.
  if (!Array.isArray(modes)) {
    const { freeTier = {}, apiKey = {} } = fallbacks;
    return key in freeTier || key in apiKey
      ? ["oauth", "apikey", "api_key"]
      : ["oauth"];
  }

  // Honour every mode the registry actually declares.
  const types = ["oauth"];
  if (modes.includes("apikey")) types.push("apikey", "api_key");
  if (modes.includes("none")) types.push("none");
  return types;
}

export default providerAuthTypes;
