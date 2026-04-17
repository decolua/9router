import { proxyAwareFetch } from "../utils/proxyFetch.js";

/**
 * Fetch a remote image URL and convert it to a base64 data URI.
 * Used by executors that cannot independently fetch remote URLs (e.g. Codex, Kiro).
 *
 * @param {string} url - HTTP/HTTPS image URL
 * @param {object} options - { timeoutMs?: number }
 * @returns {Promise<{url: string}|null>} - data: URI on success, null on failure
 */
export async function fetchImageAsBase64(url, options = {}) {
  const { timeoutMs = 15000 } = options;
  try {
    const resp = await proxyAwareFetch(url, {
      timeout: timeoutMs,
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!resp.ok) return null;
    const buf = await resp.arrayBuffer();
    const mime = resp.headers.get("content-type") || "image/jpeg";
    const b64 = Buffer.from(buf).toString("base64");
    return { url: `data:${mime};base64,${b64}` };
  } catch {
    return null;
  }
}
