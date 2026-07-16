// Compatibility facade. New code should use claudeIdentityManager directly.
import { captureClaudeIdentity, clearClaudeIdentity, getClaudeIdentity } from "./claudeIdentityManager.js";

export function cacheClaudeHeaders(headers) {
  return captureClaudeIdentity(headers);
}

export function getCachedClaudeHeaders() {
  return getClaudeIdentity()?.headers || null;
}

export function clearCachedClaudeHeaders() {
  clearClaudeIdentity();
}
