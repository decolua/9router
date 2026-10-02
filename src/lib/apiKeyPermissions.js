const MAX_ENTRIES = 200;

function normaliseList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((entry) => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, MAX_ENTRIES))];
}

/**
 * Empty lists mean unrestricted access. This keeps keys created before this
 * feature working exactly as before.
 */
export function normalizeApiKeyPermissions(value) {
  return {
    providerIds: normaliseList(value?.providerIds),
    models: normaliseList(value?.models),
    forceProviderId: typeof value?.forceProviderId === "string" ? value.forceProviderId.trim() : "",
    forceModel: typeof value?.forceModel === "string" ? value.forceModel.trim() : "",
  };
}

export function hasApiKeyRestrictions(value) {
  const permissions = normalizeApiKeyPermissions(value);
  return permissions.providerIds.length > 0 || permissions.models.length > 0;
}

export function hasApiKeyPolicy(value) {
  const permissions = normalizeApiKeyPermissions(value);
  return hasApiKeyRestrictions(permissions) || !!permissions.forceModel || !!permissions.forceProviderId;
}

// This initial policy feature covers chat-compatible inference and /v1/models.
// Other services fail closed for scoped keys until their dispatchers enforce
// the same policy. Unrestricted/legacy keys retain access to all endpoints.
export function supportsApiKeyPolicyPath(pathname, method) {
  const path = pathname.replace(/^\/api(?=\/v1)/, "").replace(/^\/v1\/v1(?=\/|$)/, "/v1").replace(/\/$/, "");
  if (method === "GET" && (path === "/v1/models" || path.startsWith("/v1/models/"))) return true;
  if (method !== "POST") return false;
  if (["/v1/chat/completions", "/v1/messages", "/v1/responses", "/v1/responses/compact", "/v1/api/chat",
    "/responses", "/responses/compact", "/codex/responses", "/codex/responses/compact"].includes(path)) return true;
  // Gemini native audio bypasses handleChat; keep this surface closed until
  // both native and translated dispatch paths support scoped keys.
  return false;
}

/**
 * A provider grant permits all of its models. A model grant permits only that
 * canonical provider/model pair. Provider ids, rather than display prefixes,
 * are stored so a provider prefix can safely be renamed later.
 */
export function isApiKeyAllowedForModel(value, { provider, model } = {}) {
  const permissions = normalizeApiKeyPermissions(value);
  if (!permissions.providerIds.length && !permissions.models.length) return true;
  if (!provider || !model) return false;
  return permissions.providerIds.includes(provider)
    || permissions.models.includes(`${provider}/${model}`);
}

/**
 * Decide whether a model can be published to a caller that uses this API key.
 * `publicModelId` is the exact ID clients send (for example
 * `local/model-a`); provider/model are the stable internal IDs used by
 * access grants. Combos have no provider and are intentionally hidden from a
 * restricted key because their seats may escape the key's policy.
 */
export function isApiKeyModelVisible(value, { publicModelId, provider, model } = {}) {
  const permissions = normalizeApiKeyPermissions(value);

  // An exact forced route is the complete public catalogue for this key.
  if (permissions.forceModel && publicModelId !== permissions.forceModel) return false;
  if (!provider || !model) {
    return !permissions.forceModel
      && !permissions.forceProviderId
      && !permissions.providerIds.length
      && !permissions.models.length;
  }
  if (permissions.forceProviderId && permissions.forceProviderId !== provider) return false;
  return isApiKeyAllowedForModel(permissions, { provider, model });
}

// Check the actual upstream immediately before credential selection, including
// combo/fusion seats and capacity-adapter fallbacks. Forced routes cannot escape
// to another provider/model even when the allow-lists are empty.
export function isApiKeyRouteAllowed(value, target, forcedTarget = null) {
  const permissions = normalizeApiKeyPermissions(value);
  if (permissions.forceProviderId && target?.provider !== permissions.forceProviderId) return false;
  if (permissions.forceModel && (!forcedTarget?.provider
      || target?.provider !== forcedTarget.provider || target?.model !== forcedTarget.model)) return false;
  return isApiKeyAllowedForModel(permissions, target);
}

// An exact forced model wins over a provider override. A provider override
// keeps the model ID sent by the client while ensuring only that provider is
// selected as the upstream.
export function applyApiKeyRouting(value, requestedModel) {
  const permissions = normalizeApiKeyPermissions(value);
  if (permissions.forceModel) return permissions.forceModel;
  if (!permissions.forceProviderId || typeof requestedModel !== "string") return requestedModel;

  const trimmed = requestedModel.trim();
  const slash = trimmed.indexOf("/");
  const modelId = slash >= 0 ? trimmed.slice(slash + 1) : trimmed;
  return modelId ? `${permissions.forceProviderId}/${modelId}` : requestedModel;
}
