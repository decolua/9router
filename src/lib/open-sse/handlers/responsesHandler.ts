/**
 * Responses API Handler
 */

import { handleChatCore, type ChatCoreResult } from "./chatCore";
import { convertResponsesApiFormat } from "../translator/helpers/responsesApiHelper";
import { createResponsesApiTransformStream } from "../transformer/responsesTransformer";
import { convertResponsesStreamToJson } from "../transformer/streamToJsonConverter";

export interface ResponsesCoreOptions {
  body: any;
  modelInfo: { provider: string; model: string };
  credentials: any;
  log?: any;
  onCredentialsRefreshed?: (creds: any) => Promise<void>;
  onRequestSuccess?: () => Promise<void>;
  onDisconnect?: (reason?: string) => void;
  connectionId?: string | null;
}

/**
 * Handle /v1/responses request
 */
export async function handleResponsesCore(options: ResponsesCoreOptions): Promise<ChatCoreResult> {
  const { body, modelInfo, credentials, log, onCredentialsRefreshed, onRequestSuccess, onDisconnect, connectionId } = options;

  // Convert Responses API format to Chat Completions format
  const convertedBody = convertResponsesApiFormat(body);

  const clientRequestedStreaming = convertedBody.stream === true;
  if (convertedBody.stream === undefined) {
    convertedBody.stream = false;
  }

  const result = await handleChatCore({
    body: convertedBody,
    modelInfo,
    credentials,
    log,
    onCredentialsRefreshed,
    onRequestSuccess,
    onDisconnect,
    connectionId,
    sourceFormatOverride: "openai-responses"
  });

  if (!result.success || !result.response) {
    return result;
  }

  const response = result.response;
  const contentType = response.headers.get("Content-Type") || "";

  // Case 1: Client wants non-streaming, but got SSE
  if (!clientRequestedStreaming && contentType.includes("text/event-stream")) {
    try {
      const jsonResponse = await convertResponsesStreamToJson(response.body!);

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
    const transformedBody = response.body!.pipeThrough(transformStream);

    return {
      success: true,
      response: new Response(transformedBody, {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
          "Access-Control-Allow-Origin": "*"
        }
      })
    };
  }

  // Case 3: Non-SSE response (error or non-streaming from provider) - return as-is
  return result;
}
