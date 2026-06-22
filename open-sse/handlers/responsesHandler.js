/**
 * Responses API Handler for Workers
 * Converts Chat Completions to Codex Responses API format
 */

import { handleChatCore } from "./chatCore.js";
import { convertResponsesApiFormat } from "../translator/formats/responsesApi.js";
import { createResponsesApiTransformStream } from "../transformer/responsesTransformer.js";
import { convertResponsesStreamToJson } from "../transformer/streamToJsonConverter.js";
import { SSE_HEADERS_CORS } from "../utils/sseConstants.js";

/**
 * Handle /v1/responses request
 * @param {object} options
 * @param {object} options.body - Request body (Responses API format)
 * @param {object} options.modelInfo - { provider, model }
 * @param {object} options.credentials - Provider credentials
 * @param {object} options.log - Logger instance (optional)
 * @param {function} options.onCredentialsRefreshed - Callback when credentials are refreshed
 * @param {function} options.onRequestSuccess - Callback when request succeeds
 * @param {function} options.onDisconnect - Callback when client disconnects
 * @param {string} options.connectionId - Connection ID for usage tracking
 * @param {boolean} [options.headroomEnabled] - Whether Headroom context compression is enabled
 * @param {string} [options.headroomUrl] - Base URL of the Headroom compression service
 * @param {boolean} [options.rtkEnabled] - Whether RTK token saver is enabled
 * @param {boolean} [options.cavemanEnabled] - Whether Caveman system-prompt injection is enabled
 * @param {string} [options.cavemanLevel] - Caveman injection level
 * @param {boolean} [options.ponytailEnabled] - Whether Ponytail tail-focus injection is enabled
 * @param {string} [options.ponytailLevel] - Ponytail injection level
 * @param {boolean} [options.ccFilterNaming] - Whether CC naming filter is active
 * @param {string} [options.apiKey] - API key forwarded from the client request
 * @param {string} [options.userAgent] - User-Agent header from the client request
 * @param {object} [options.clientRawRequest] - Raw client request details for logging
 * @param {object} [options.providerThinking] - Provider-level thinking/reasoning config
 * @returns {Promise<{success: boolean, response?: Response, status?: number, error?: string}>}
 */
export async function handleResponsesCore({
  body, modelInfo, credentials, log,
  onCredentialsRefreshed, onRequestSuccess, onDisconnect, connectionId,
  headroomEnabled, headroomUrl,
  rtkEnabled, cavemanEnabled, cavemanLevel, ponytailEnabled, ponytailLevel,
  ccFilterNaming, apiKey, userAgent, clientRawRequest, providerThinking,
}) {
  // Convert Responses API format to Chat Completions format
  const convertedBody = convertResponsesApiFormat(body);

  // Preserve client's stream preference (matches OpenClaw behavior)
  // Default to false if omitted: Boolean(undefined) = false
  const clientRequestedStreaming = convertedBody.stream === true;
  if (convertedBody.stream === undefined) {
    convertedBody.stream = false;
  }

  // Call chat core handler — force sourceFormat so streaming path knows this is a Responses API client.
  // Token-saver params (headroom, RTK, caveman, ponytail) must be forwarded from the caller so that
  // compression settings apply on Worker/edge paths that use this handler directly (bug #1956 fix).
  const result = await handleChatCore({
    body: convertedBody,
    modelInfo,
    credentials,
    log,
    onCredentialsRefreshed,
    onRequestSuccess,
    onDisconnect,
    connectionId,
    headroomEnabled,
    headroomUrl,
    rtkEnabled,
    cavemanEnabled,
    cavemanLevel,
    ponytailEnabled,
    ponytailLevel,
    ccFilterNaming,
    apiKey,
    userAgent,
    clientRawRequest,
    providerThinking,
    sourceFormatOverride: "openai-responses",
  });

  if (!result.success || !result.response) {
    return result;
  }

  const response = result.response;
  const contentType = response.headers.get("Content-Type") || "";

  // Case 1: Client wants non-streaming, but got SSE (provider forced it, e.g., Codex)
  if (!clientRequestedStreaming && contentType.includes("text/event-stream")) {
    try {
      const jsonResponse = await convertResponsesStreamToJson(response.body);

      return {
        success: true,
        response: new Response(JSON.stringify(jsonResponse), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-cache",
            "Access-Control-Allow-Origin": "*"
          }
        })
      };
    } catch (error) {
      console.error("[Responses API] Stream-to-JSON conversion failed:", error);
      return {
        success: false,
        status: 500,
        error: "Failed to convert streaming response to JSON"
      };
    }
  }

  // Case 2: Client wants streaming, got SSE - transform it
  if (clientRequestedStreaming && contentType.includes("text/event-stream")) {
    const transformStream = createResponsesApiTransformStream(null);
    const transformedBody = response.body.pipeThrough(transformStream);

    return {
      success: true,
      response: new Response(transformedBody, {
        status: 200,
        headers: { ...SSE_HEADERS_CORS }
      })
    };
  }

  // Case 3: Non-SSE response (error or non-streaming from provider) - return as-is
  return result;
}

