/**
 * Detect whether the current runtime is a Cloudflare Worker.
 *
 * Uses the presence of the `WebSocketPair` global (CF-specific), the
 * `navigator.userAgent` string that Workers set, or the `OPENNEXT_CLOUDFLARE`
 * env var stamped by @opennextjs/cloudflare.
 *
 * @returns {boolean}
 */
export function isCloudflareWorker() {
  try {
    if (typeof WebSocketPair !== "undefined") return true;
    if (typeof navigator !== "undefined" && navigator?.userAgent === "Cloudflare-Workers") return true;
    if (process.env.OPENNEXT_CLOUDFLARE === "1") return true;
  } catch {}
  return false;
}
