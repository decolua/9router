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
  const { body } = await parseJsonBodyDetailed(request);
  return body;
}

/**
 * Parse JSON body and keep the original wire bytes for transparent passthrough.
 *
 * Flow for official passthrough:
 *   zstd in → decompress → JSON.parse → decide model → forward original rawBody
 *   (with original Content-Encoding) to chatgpt.com — same as no-base_url Codex.
 *
 * @param {Request} request
 * @returns {Promise<{ body: any, rawBody: Buffer, contentEncoding: string|null }>}
 */
export async function parseJsonBodyDetailed(request) {
  const encodingHeader = (request.headers.get("content-encoding") || "").toLowerCase().trim();
  const primary = encodingHeader && encodingHeader !== "identity"
    ? encodingHeader.split(",")[0].trim()
    : null;

  const rawBody = Buffer.from(await request.arrayBuffer());
  if (rawBody.length === 0) {
    throw new SyntaxError("Unexpected end of JSON input");
  }

  if (!primary) {
    return {
      body: JSON.parse(rawBody.toString("utf8")),
      rawBody,
      contentEncoding: null,
    };
  }

  const decoded = decodeBody(rawBody, primary);
  return {
    body: JSON.parse(decoded.toString("utf8")),
    rawBody,
    contentEncoding: primary,
  };
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
