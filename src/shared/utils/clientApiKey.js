/**
 * The client key, read from the same places and in the same order as the
 * middleware (src/dashboardGuard.js) reads the key it authorizes a remote
 * /v1 call with: Bearer, x-api-key, x-goog-api-key, ?key=. Handlers' own
 * extractApiKey() only reads the first two, so using it here would let a
 * restricted key sent as x-goog-api-key look like "no key" (= unrestricted).
 */
export function extractClientApiKey(request) {
  const headers = request?.headers;
  if (!headers?.get) return null;
  const auth = headers.get("Authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7);
  const xApiKey = headers.get("x-api-key");
  if (xApiKey) return xApiKey;
  const googKey = headers.get("x-goog-api-key");
  if (googKey) return googKey;
  try {
    return new URL(request.url).searchParams.get("key") || null;
  } catch {
    return null;
  }
}
