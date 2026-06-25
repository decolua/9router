export function extractBearerToken(header) {
  const value = typeof header === "string" ? header : "";
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

export async function parseApiKey() {
  return null;
}
