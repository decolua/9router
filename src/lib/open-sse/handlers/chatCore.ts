import { detectFormat, getTargetFormat } from "../services/provider";
import { translateRequest } from "../translator/index";
import { FORMATS } from "../translator/formats";
import { createStreamController, type StreamController } from "../utils/streamHandler";
import { refreshWithRetry } from "../services/tokenRefresh";
import { createRequestLogger, type RequestLogger } from "../utils/requestLogger";
import { getModelTargetFormat, getModelStrip, PROVIDER_ID_TO_ALIAS } from "../config/providerModels";
import { createErrorResult, parseUpstreamError, formatProviderError } from "../utils/error";
import { HTTP_STATUS } from "../config/runtimeConfig";
import { handleBypassRequest } from "../utils/bypassHandler";
import { trackPendingRequest, appendRequestLog } from "@/lib/usageDb";
import { getExecutor } from "../executors/index";
import { handleForcedSSEToJson } from "./chatCore/sseToJsonHandler";
import { handleNonStreamingResponse } from "./chatCore/nonStreamingHandler";
import { handleStreamingResponse } from "./chatCore/streamingHandler";
import { detectClientTool, isNativePassthrough } from "../utils/clientDetector";

export interface ChatCoreOptions {
  body: any;
  modelInfo: { provider: string; model: string };
  credentials: any;
  log?: any;
  onCredentialsRefreshed?: (creds: any) => Promise<void>;
  onRequestSuccess?: () => Promise<void>;
  onDisconnect?: (reason?: string) => void;
  clientRawRequest?: { endpoint: string; body: any; headers: any };
  connectionId?: string | null;
  userAgent?: string;
  apiKey?: string | null;
  ccFilterNaming?: boolean;
  sourceFormatOverride?: string;
  providerThinking?: { mode: string; budget_tokens?: number };
}

export interface ChatCoreResult {
  success: boolean;
  response?: Response;
  status?: number;
  error?: string;
}

/**
 * Check if a token is expiring soon.
 */
export function isTokenExpiringSoon(expiresAt: number | string | null | undefined, bufferMs: number = 300000): boolean {
  if (!expiresAt) return false;
  const expiry = typeof expiresAt === 'number' ? expiresAt : new Date(expiresAt).getTime();
  if (isNaN(expiry)) return false;
  return expiry - Date.now() < bufferMs;
}

/**
 * Core chat handler - shared between SSE and Worker
 */
export async function handleChatCore(options: ChatCoreOptions): Promise<ChatCoreResult> {
  let { body } = options;
  const { 
    modelInfo, credentials, log, onCredentialsRefreshed, 
    onRequestSuccess, onDisconnect, clientRawRequest, 
    connectionId, userAgent, apiKey, ccFilterNaming, 
    sourceFormatOverride, providerThinking 
  } = options;
  
  const { provider, model } = modelInfo;
  const requestStartTime = Date.now();

  const sourceFormat = sourceFormatOverride || detectFormat(body);

  const bypassResponse = handleBypassRequest(body, model, userAgent, ccFilterNaming);
  if (bypassResponse) return bypassResponse;

  const alias = (PROVIDER_ID_TO_ALIAS as any)[provider] || provider;
  const modelTargetFormat = getModelTargetFormat(alias, model);
  const targetFormat = modelTargetFormat || getTargetFormat(provider);
  const stripList = getModelStrip(alias, model);

  if (providerThinking?.mode && providerThinking.mode !== "auto") {
    const mode = providerThinking.mode;
    if (mode === "on" && !body.thinking) {
      body = { ...body, thinking: { type: "enabled", budget_tokens: providerThinking.budget_tokens || 10000 } };
    } else if (mode === "off" && !body.thinking) {
      body = { ...body, thinking: { type: "disabled" } };
    } else if (!body.reasoning_effort) {
      body = { ...body, reasoning_effort: mode };
    }
  }

  const providerRequiresStreaming = provider === "openai" || provider === "codex";
  let stream = providerRequiresStreaming ? true : (body.stream !== false);

  const acceptHeader = clientRawRequest?.headers?.accept || "";
  const clientPrefersJson = acceptHeader.includes("application/json");
  const clientPrefersSSE = acceptHeader.includes("text/event-stream");
  if (clientPrefersJson && !clientPrefersSSE && body.stream !== true) {
    stream = false;
  }

  const reqLogger = await createRequestLogger(sourceFormat, targetFormat, model);
  if (clientRawRequest) reqLogger.logClientRawRequest(clientRawRequest.endpoint, clientRawRequest.body, clientRawRequest.headers);
  reqLogger.logRawRequest(body);

  const clientTool = detectClientTool(clientRawRequest?.headers || {}, body);
  const passthrough = isNativePassthrough(clientTool, provider);

  let translatedBody: any;
  let toolNameMap: any;
  if (passthrough) {
    translatedBody = { ...body, model };
  } else {
    translatedBody = translateRequest(sourceFormat, targetFormat, model, body, stream, credentials, provider, reqLogger, stripList, connectionId || undefined);
    if (!translatedBody) {
      trackPendingRequest(model, provider, connectionId || "", false, true);
      return createErrorResult(HTTP_STATUS.BAD_REQUEST, `Failed to translate request for ${sourceFormat} → ${targetFormat}`);
    }
    toolNameMap = translatedBody._toolNameMap;
    delete translatedBody._toolNameMap;
    translatedBody.model = model;
  }

  const executor = getExecutor(provider);
  trackPendingRequest(model, provider, connectionId || "", true);
  appendRequestLog({ model, provider, connectionId: connectionId || "", status: "PENDING" }).catch(() => {});

  const streamController = createStreamController({
    onDisconnect: (data) => {
      trackPendingRequest(model, provider, connectionId || "", false);
      if (onDisconnect) onDisconnect(data.reason);
    },
    onError: () => trackPendingRequest(model, provider, connectionId || "", false),
    log, provider, model
  });

  const finalBody = translatedBody;

  // Execute request
  let providerResponse: Response | undefined;
  try {
    const executeResult = await executor.execute({
      model,
      body: finalBody,
      credentials,
      stream,
      signal: streamController.signal,
      log,
      reqLogger
    });
    providerResponse = executeResult?.response;
  } catch (error: any) {
    const errMsg = formatProviderError(error, provider, model, HTTP_STATUS.BAD_GATEWAY);
    trackPendingRequest(model, provider, connectionId || "", false, true);
    reqLogger.logError(error, translatedBody);
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, errMsg);
  }

  if (!providerResponse) {
    trackPendingRequest(model, provider, connectionId || "", false, true);
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, `No response from provider ${provider}`);
  }

  // Handle 401/403
  if (!executor.noAuth && (providerResponse.status === HTTP_STATUS.UNAUTHORIZED || providerResponse.status === HTTP_STATUS.FORBIDDEN)) {
    const newCredentials = await refreshWithRetry(
      () => executor.refreshCredentials(credentials, log),
      3,
      log
    );

    if (newCredentials?.accessToken || newCredentials?.apiKey) {
      Object.assign(credentials, newCredentials);
      if (onCredentialsRefreshed) await onCredentialsRefreshed(newCredentials);

      try {
        const retryResult = await executor.execute({
          model,
          body: finalBody,
          credentials,
          stream,
          signal: streamController.signal,
          log,
          reqLogger
        });
        providerResponse = retryResult?.response || providerResponse;
      } catch (retryError) {
        // ignore
      }
    }
  }

  if (!providerResponse || !providerResponse.ok) {
    const { statusCode, message } = providerResponse 
      ? await parseUpstreamError(providerResponse)
      : { statusCode: HTTP_STATUS.BAD_GATEWAY, message: "No response from provider after retry" };
    const errMsg = formatProviderError(new Error(message), provider, model, statusCode);
    trackPendingRequest(model, provider, connectionId || "", false, true);
    reqLogger.logError(new Error(message), translatedBody);
    return createErrorResult(statusCode, errMsg);
  }

  if (onRequestSuccess) await onRequestSuccess();

  const contentType = providerResponse?.headers?.get("Content-Type") || "";
  // Some providers (e.g. codex) stream SSE without the correct Content-Type header.
  // Codex always forces streaming in its executor, so we can assume 200 OK means SSE.
  const isSSE = contentType.includes("text/event-stream") || provider === "codex";

  const commonHandlerOptions = {
    providerResponse: providerResponse as Response,
    provider,
    model,
    sourceFormat,
    targetFormat,
    body,
    stream,
    translatedBody,
    finalBody,
    requestStartTime,
    connectionId,
    apiKey,
    clientRawRequest,
    onRequestSuccess,
    reqLogger,
    trackDone: () => trackPendingRequest(model, provider, connectionId || "", false),
    appendLog: (data: any) => appendRequestLog({ model, provider, connectionId: connectionId || "", ...data }).catch(() => {})
  };

  // Case 1: Client wants JSON but provider gave SSE
  if (!stream && isSSE) {
    const result = await handleForcedSSEToJson(commonHandlerOptions);
    if (!result) return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Failed to convert streaming response to JSON");
    return result as ChatCoreResult;
  }

  // Case 2: Non-streaming response
  if (!isSSE) {
    return await handleNonStreamingResponse({
      ...commonHandlerOptions,
      toolNameMap
    });
  }

  // Case 3: Streaming response
  return handleStreamingResponse({
    ...commonHandlerOptions,
    userAgent,
    toolNameMap,
    streamController
  });
}
