/**
 * Decode HTTP request body bytes honoring Content-Encoding.
 * Used by JSON parsers and the Codex official passthrough pre-handler.
 */

import { gunzipSync, brotliDecompressSync, inflateSync, zstdDecompressSync } from "node:zlib";

/**
 * @param {Buffer} buf
 * @param {string|null|undefined} encoding lowercased Content-Encoding value
 * @returns {Buffer}
 */
export function decodeBody(buf, encoding) {
  if (!buf || buf.length === 0) return buf;
  const enc = (encoding || "").toLowerCase().trim();
  if (!enc || enc === "identity") return buf;

  // Multi-encoding is rare for request bodies; take the primary token.
  const primary = enc.split(",")[0].trim();

  if (primary === "zstd" || primary === "zst") {
    if (typeof zstdDecompressSync !== "function") {
      throw new Error("Content-Encoding: zstd requires Node.js with zlib.zstdDecompressSync (Node ≥22.15)");
    }
    return zstdDecompressSync(buf);
  }
  if (primary === "gzip" || primary === "x-gzip") {
    return gunzipSync(buf);
  }
  if (primary === "br") {
    return brotliDecompressSync(buf);
  }
  if (primary === "deflate") {
    return inflateSync(buf);
  }

  // Unknown encoding — return as-is (caller may still parse as UTF-8 JSON)
  return buf;
}

/**
 * Primary Content-Encoding token, or null if none / identity.
 * @param {string|null|undefined} encodingHeader
 * @returns {string|null}
 */
export function primaryContentEncoding(encodingHeader) {
  const enc = (encodingHeader || "").toLowerCase().trim();
  if (!enc || enc === "identity") return null;
  return enc.split(",")[0].trim() || null;
}
