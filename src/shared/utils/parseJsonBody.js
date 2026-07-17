import { gunzipSync, brotliDecompressSync, inflateSync, zstdDecompressSync } from "node:zlib";

/**
 * Read a Request body as JSON, honoring Content-Encoding.
 *
 * Codex (and other OpenAI-style clients) may zstd-compress large Responses
 * API payloads when model_provider is treated as official OpenAI/ChatGPT.
 * Next/undici does not auto-decompress request bodies, so request.json()
 * fails with SyntaxError → "Invalid JSON body".
 *
 * @param {Request} request
 * @returns {Promise<any>}
 */
export async function parseJsonBody(request) {
  const encoding = (request.headers.get("content-encoding") || "").toLowerCase().trim();
  // Fast path: no content encoding → native JSON parse
  if (!encoding || encoding === "identity") {
    return request.json();
  }

  const raw = Buffer.from(await request.arrayBuffer());
  if (raw.length === 0) {
    throw new SyntaxError("Unexpected end of JSON input");
  }

  const decoded = decodeBody(raw, encoding);
  return JSON.parse(decoded.toString("utf8"));
}

/**
 * @param {Buffer} buf
 * @param {string} encoding lowercased Content-Encoding value
 * @returns {Buffer}
 */
export function decodeBody(buf, encoding) {
  if (!buf || buf.length === 0) return buf;
  const enc = (encoding || "").toLowerCase();

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

  // Unknown encoding — try raw UTF-8 JSON (may still fail later)
  return buf;
}
