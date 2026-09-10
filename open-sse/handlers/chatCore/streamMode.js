import { FORMATS } from "../../translator/formats.js";

/**
 * Whether the client asked for an SSE-framed response.
 *
 * The OpenAI API defines `stream` with a default of **false**, so a body that
 * omits the key is a non-streaming request. Reading an absent key as "stream"
 * frames a plain `chat.completion` object as SSE: wrong content-type, plus a
 * `data: [DONE]` glued onto valid JSON, which strict parsers reject (#3492).
 *
 * The Gemini and Antigravity surfaces are the exception. Their endpoints carry
 * the mode in the path rather than the body, and this router only routes their
 * streaming ones, so those formats always mean SSE.
 */
export function clientRequestedStreaming(body, sourceFormat) {
  if (
    sourceFormat === FORMATS.ANTIGRAVITY ||
    sourceFormat === FORMATS.GEMINI ||
    sourceFormat === FORMATS.GEMINI_CLI
  ) {
    return true;
  }
  return body?.stream === true;
}
