// Compatibility facade for the official Claude provider. It intentionally uses
// a dedicated namespace and never shares identity with compatible gateway nodes.
import { captureClaudeIdentity, clearClaudeIdentity, getClaudeIdentity } from "./claudeIdentityManager.js";

const OFFICIAL_CLAUDE_NAMESPACE = "claude:official";

export function cacheClaudeHeaders(headers, source = {}) {
  return captureClaudeIdentity(headers, { ...source, namespace: OFFICIAL_CLAUDE_NAMESPACE });
}

export function getCachedClaudeHeaders() {
  return getClaudeIdentity(OFFICIAL_CLAUDE_NAMESPACE)?.headers || null;
}

export function clearCachedClaudeHeaders() {
  clearClaudeIdentity(OFFICIAL_CLAUDE_NAMESPACE);
}
