import { getProviderAlias } from "@/shared/constants/providers";

/**
 * Resolve the prefix a provider is addressed by in a published model ID.
 *
 * Custom providers (OpenAI-/Anthropic-compatible, custom embedding) are created
 * as provider nodes whose ID is a UUID-bearing string such as
 * `openai-compatible-chat-330c58ab-a28a-46ed-9baa-0e1c8510562c`. The user picks
 * a short prefix ("mirai") on the node, and that is the prefix the UI advertises
 * and the one clients should send. `getProviderAlias()` cannot supply it: custom
 * nodes are not registry entries, so their alias *is* the raw ID.
 *
 * Precedence:
 *   1. providerSpecificData.prefix — written onto the connection when it is
 *      created (POST /api/providers) and kept in sync when the node is edited
 *      (PUT /api/provider-nodes/[id]).
 *   2. node.prefix — the provider-node row itself, for callers that already
 *      have the node but not the connection.
 *   3. getProviderAlias(providerId) — the registry alias for built-in providers.
 *
 * The prefix is display-only: it never selects an upstream credential and never
 * builds an upstream URL. Routing still resolves prefix -> node ID through the
 * provider-nodes lookup.
 *
 * @param {object} input
 * @param {string} input.providerId            Provider id or node id.
 * @param {object} [input.providerSpecificData] Connection's providerSpecificData.
 * @param {object} [input.node]                Provider node row (optional).
 * @returns {string} The prefix to publish (falls back to the provider id).
 */
export function resolveProviderPrefix({ providerId, providerSpecificData, node } = {}) {
  const connectionPrefix = providerSpecificData?.prefix;
  if (typeof connectionPrefix === "string" && connectionPrefix.trim()) {
    return connectionPrefix.trim();
  }

  const nodePrefix = node?.prefix;
  if (typeof nodePrefix === "string" && nodePrefix.trim()) {
    return nodePrefix.trim();
  }

  if (!providerId) return "";

  const alias = getProviderAlias(providerId);
  return (typeof alias === "string" && alias.trim()) ? alias.trim() : providerId;
}
