/**
 * Fetch a remote image URL and return it as a base64 data URI.
 * Returns null if fetch fails.
 */
export async function fetchImageAsBase64(imageUrl: string, options: { signal?: AbortSignal, timeoutMs?: number } = {}) {
  const { signal, timeoutMs = 10000 } = options;
  if (!imageUrl || (!imageUrl.startsWith("http://") && !imageUrl.startsWith("https://"))) {
    return null;
  }

  const controller = new AbortController();
  const timeout = signal ? null : setTimeout(() => controller.abort(), timeoutMs);
  const fetchSignal = signal || controller.signal;

  try {
    const response = await fetch(imageUrl, { signal: fetchSignal });
    if (!response.ok) return null;

    const mimeType = response.headers.get("Content-Type") || "image/jpeg";
    const arrayBuffer = await response.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");
    return { url: `data:${mimeType};base64,${base64}`, mimeType };
  } catch {
    return null;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
