/**
 * Extract an API key from request headers.
 * Prefers `Authorization: Bearer <key>`; falls back to `x-api-key`.
 * Returns the raw key string or `null`.
 *
 * Pure extraction — does NOT validate the key. Callers must run the returned
 * value through the appropriate validator (e.g. `validateApiKey` for
 * LLM-API keys, `validateGatewayKey` for MCP gateway keys).
 */
export function extractApiKey(request) {
  const authHeader = request.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) return authHeader.slice(7);
  return request.headers.get("x-api-key");
}
