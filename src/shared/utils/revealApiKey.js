/**
 * Fetch full API key value for an authenticated dashboard session.
 * @param {string} keyId
 * @returns {Promise<string|null>}
 */
export async function revealApiKey(keyId) {
  if (!keyId) return null;
  try {
    const res = await fetch(`/api/keys/${encodeURIComponent(keyId)}?reveal=true`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.key?.key || null;
  } catch {
    return null;
  }
}
