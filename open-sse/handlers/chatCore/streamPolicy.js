import { FORMATS } from "../../translator/formats.js";

/**
 * BrowserOS tool integrations expect JSON (non-streaming) responses.
 * Force non-streaming for OpenAI Responses API requests handled by 9Router.
 */
export function shouldForceNonStreamingForResponsesTool(sourceFormat, endpoint = "") {
  return sourceFormat === FORMATS.OPENAI_RESPONSES || String(endpoint).includes("/v1/responses");
}
