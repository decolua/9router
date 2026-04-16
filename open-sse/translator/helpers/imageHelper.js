/**
 * Convert HTTP(S) image URLs to base64 data URIs.
 * Used when upstream providers (Codex, etc.) require inline base64 images
 * instead of remote URLs they cannot fetch.
 *
 * Supports two modes:
 * - fetchInBody: add a `fetchedImages` map to body so callers can reuse results
 * - inline: convert URLs to data URIs directly in the content array
 *
 * @param {Array} content - OpenAI content array (messages[].content)
 * @param {object} body - request body (for caching fetched results)
 * @param {boolean} fetchInBody - if true, store results in body.fetchedImages instead of mutating content
 * @returns {Array} content with HTTP(S) image_url URLs replaced by base64 data URIs
 */
export function convertHttpImageUrlsToBase64(content, body = {}, fetchInBody = false) {
  if (!Array.isArray(content)) return content;

  // Initialize cache on body if needed
  if (fetchInBody && !body.fetchedImages) {
    body.fetchedImages = {};
  }

  return content.map(block => {
    if (!block || block.type !== "image_url") return block;

    const url = typeof block.image_url === "string"
      ? block.image_url
      : block.image_url?.url;

    if (!url || typeof url !== "string") return block;

    // Skip data URIs — already inline
    if (url.startsWith("data:")) return block;

    // Only handle HTTP(S) URLs
    if (!url.startsWith("http://") && !url.startsWith("https://")) return block;

    // Use cached result if available
    if (fetchInBody && body.fetchedImages && url in body.fetchedImages) {
      const cached = body.fetchedImages[url];
      return {
        type: "image_url",
        image_url: {
          url: cached.url,
          detail: block.image_url?.detail || cached.detail || "auto"
        }
      };
    }

    return block; // Let caller handle actual fetching via body.fetchedImages cache
  });
}

/**
 * Fetch a remote image URL and return it as a base64 data URI.
 * Returns null if fetch fails.
 *
 * @param {string} imageUrl - HTTP(S) URL of the image
 * @param {object} options - { signal, timeoutMs }
 * @returns {Promise<{url: string, mimeType: string}|null>}
 */
export async function fetchImageAsBase64(imageUrl, options = {}) {
  const { signal, timeoutMs = 10000 } = options;
  if (!imageUrl || (!imageUrl.startsWith("http://") && !imageUrl.startsWith("https://"))) {
    return null;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const fetchSignal = signal || controller.signal;

    const response = await fetch(imageUrl, { signal: fetchSignal });
    clearTimeout(timeout);

    if (!response.ok) return null;

    const mimeType = response.headers.get("Content-Type") || "image/jpeg";
    const arrayBuffer = await response.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");

    return { url: `data:${mimeType};base64,${base64}`, mimeType };
  } catch {
    return null;
  }
}

/**
 * Process all HTTP(S) image URLs in a request body, converting them to base64.
 * Uses body.fetchedImages as a cache to avoid duplicate fetches.
 * Mutates body.fetchedImages in place.
 *
 * @param {object} body - OpenAI request body
 * @param {Array} paths - array of dot-notation paths to content arrays in body
 * @param {object} options - { signal, timeoutMs }
 * @returns {Promise<object>} body with image URLs converted to base64 data URIs
 */
export async function resolveHttpImageUrlsInBody(body, paths = ["messages"], options = {}) {
  if (!body.fetchedImages) body.fetchedImages = {};

  for (const path of paths) {
    const parts = path.split(".");
    let node = body;
    for (let i = 0; i < parts.length - 1; i++) {
      node = node?.[parts[i]];
      if (!node) break;
    }
    const lastKey = parts[parts.length - 1];
    const arr = node?.[lastKey];
    if (!Array.isArray(arr)) continue;

    for (const item of arr) {
      if (item.role !== "user" || !Array.isArray(item.content)) continue;

      for (const block of item.content) {
        if (block?.type !== "image_url") continue;

        const url = typeof block.image_url === "string"
          ? block.image_url
          : block.image_url?.url;

        if (!url || url.startsWith("data:") || !body.fetchedImages[url]) {
          continue;
        }

        // Already cached
        if (body.fetchedImages[url]?.url) continue;

        // Fetch and cache
        const result = await fetchImageAsBase64(url, options);
        if (result) {
          body.fetchedImages[url] = { url: result.url, detail: block.image_url?.detail || "auto" };
        }
      }
    }
  }

  return body;
}