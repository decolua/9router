import { decodeBody, primaryContentEncoding } from "open-sse/utils/bodyEncoding.js";

/**
 * Read a Request body as JSON, honoring Content-Encoding.
 *
 * Codex (and other OpenAI-style clients) may zstd-compress large Responses
 * API payloads. Next/undici does not auto-decompress request bodies, so
 * request.json() fails with SyntaxError → "Invalid JSON body".
 *
 * @param {Request} request
 * @returns {Promise<any>}
 */
export async function parseJsonBody(request) {
  const primary = primaryContentEncoding(request.headers.get("content-encoding"));
  const rawBody = Buffer.from(await request.arrayBuffer());
  if (rawBody.length === 0) {
    throw new SyntaxError("Unexpected end of JSON input");
  }
  const decoded = primary ? decodeBody(rawBody, primary) : rawBody;
  return JSON.parse(decoded.toString("utf8"));
}

// Re-export for tests / callers that only need decompress helpers
export { decodeBody, primaryContentEncoding } from "open-sse/utils/bodyEncoding.js";
