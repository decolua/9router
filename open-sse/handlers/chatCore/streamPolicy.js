import { FORMATS } from "../../translator/formats.js";

/**
 * BrowserOS tool integrations expect JSON (non-streaming) responses.
 * Force non-streaming for OpenAI Responses API requests handled by 9Router.
 */
export function shouldForceNonStreamingForResponsesTool(sourceFormat, endpoint = "") {
  const safeEndpoint = typeof endpoint === "string" ? endpoint : "";
  const pathOnly = safeEndpoint.split("?")[0];
  const withLeadingSlash = pathOnly.startsWith("/") ? pathOnly : `/${pathOnly}`;
  const normalizedEndpoint = withLeadingSlash.replace(/\/{2,}/g, "/").replace(/\/+$/, "");
  return sourceFormat === FORMATS.OPENAI_RESPONSES || normalizedEndpoint === "/v1/responses";
}
