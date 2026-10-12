// Keep middleware and handlers in agreement about every accepted transport.
export function extractRequestApiKey(request) {
  const authorization = request.headers.get("Authorization");
  if (authorization?.startsWith("Bearer ")) return authorization.slice(7);
  const header = request.headers.get("x-api-key") || request.headers.get("x-goog-api-key");
  if (header) return header;
  try {
    return new URL(request.url).searchParams.get("key") || null;
  } catch {
    return request.nextUrl?.searchParams?.get("key") || null;
  }
}
