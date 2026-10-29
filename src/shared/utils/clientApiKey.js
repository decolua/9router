// Keep inference authentication, access checks and usage attribution on the
// same key, including Gemini clients and URL-based authentication.
export function extractClientApiKey(request) {
  const headers = request?.headers;
  if (!headers?.get) return null;
  const auth = headers.get("Authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7).trim();
  for (const name of ["x-api-key", "x-goog-api-key"]) {
    const value = headers.get(name);
    if (value) return value.trim();
  }
  try {
    return new URL(request.url).searchParams.get("key")?.trim() || null;
  } catch {
    return null;
  }
}
