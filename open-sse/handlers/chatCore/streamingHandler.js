import { FORMATS } from "../../translator/formats.js";
import { needsTranslation } from "../../translator/index.js";
import { createSSETransformStreamWithLogger, createPassthroughStreamWithLogger } from "../../utils/stream.js";
import { pipeWithDisconnect, withSseHeartbeat } from "../../utils/streamHandler.js";
import { PROVIDERS } from "../../config/providers.js";
import { HTTP_STATUS, resolveStreamStallTimeoutMs, STREAM_HEARTBEAT_INTERVAL_MS, STREAM_PRECONTENT_RETRY_ATTEMPTS, STREAM_PRECONTENT_RETRY_DELAY_MS } from "../../config/runtimeConfig.js";
import { UPSTREAM_ERROR_TITLE_MAX_CHARS } from "../../config/errorConfig.js";
import { buildAbortedResponsesTerminalBytes } from "../../utils/responsesStreamHelpers.js";
import { buildStreamErrorBytes } from "../../utils/streamHelpers.js";
import { createErrorResult, getClientErrorStatus, getStreamErrorStatus, getUpstreamDisconnectStatus, isTransientStreamError, readErrorResponseText } from "../../utils/error.js";
import { prepareStreamingResponse } from "../../utils/preContentRetry.js";
import { buildRequestDetail, extractRequestConfig, saveUsageStats, formatDoneLine } from "./requestDetail.js";
import { appendRequestLog, saveRequestDetail } from "@/lib/usageDb.js";
import { SSE_HEADERS_CORS as SSE_HEADERS } from "../../utils/sseConstants.js";
import { upstreamResponseHeaders } from "../../utils/upstreamHeaders.js";

// Codex returns Responses API SSE → which client format to translate INTO, by request sourceFormat.
// Gemini-family all map to ANTIGRAVITY decoder; unknown sources fall back to OPENAI.
const CODEX_SOURCE_TO_TARGET = {
  [FORMATS.OPENAI_RESPONSES]: FORMATS.OPENAI_RESPONSES,
  [FORMATS.CLAUDE]: FORMATS.CLAUDE,
  [FORMATS.ANTIGRAVITY]: FORMATS.ANTIGRAVITY,
  [FORMATS.GEMINI]: FORMATS.ANTIGRAVITY,
  [FORMATS.GEMINI_CLI]: FORMATS.ANTIGRAVITY,
};

/**
 * Determine which SSE transform stream to use based on provider/format.
 */
function buildTransformStream({ provider, sourceFormat, targetFormat, userAgent, reqLogger, toolNameMap, customToolNames, model, connectionId, body, onStreamComplete, apiKey, credentials, lifecycleOptions }) {
  const isDroidCLI = userAgent?.toLowerCase().includes("droid") || userAgent?.toLowerCase().includes("codex-cli");
  // Responses-API providers (e.g. codex) emit Responses SSE → translate into client format
  const isResponsesProvider = PROVIDERS[provider]?.format === FORMATS.OPENAI_RESPONSES;
  const needsCodexTranslation = isResponsesProvider && targetFormat === FORMATS.OPENAI_RESPONSES && !isDroidCLI;

  if (needsCodexTranslation) {
    const codexTarget = CODEX_SOURCE_TO_TARGET[sourceFormat] || FORMATS.OPENAI;
    return createSSETransformStreamWithLogger(FORMATS.OPENAI_RESPONSES, codexTarget, provider, reqLogger, toolNameMap, model, connectionId, body, onStreamComplete, apiKey, customToolNames, credentials, lifecycleOptions);
  }

  if (needsTranslation(targetFormat, sourceFormat)) {
    return createSSETransformStreamWithLogger(targetFormat, sourceFormat, provider, reqLogger, toolNameMap, model, connectionId, body, onStreamComplete, apiKey, customToolNames, credentials, lifecycleOptions);
  }

  // The passthrough path has no format translation, so the fingerprint's tool
  // rename map (read -> read_client) has to be handed over explicitly —
  // otherwise the client receives a call to a tool it never declared (#4986).
  return createPassthroughStreamWithLogger(provider, reqLogger, model, connectionId, body, onStreamComplete, apiKey, toolNameMap, sourceFormat, lifecycleOptions);
}

const TERMINAL_SSE_FORMATS = new Set([FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, FORMATS.CLAUDE]);
const NATIVE_STREAM_PROVIDERS = new Set(["ollama", "kiro", "cursor", "commandcode"]);

/**
 * Handle streaming response — pipe provider SSE through transform stream to client.
 */
export async function handleStreamingResponse({
  providerResponse, provider, model, sourceFormat, targetFormat, userAgent, body, stream, translatedBody, finalBody, getProviderBody,
  requestStartTime, connectionId, apiKey, onRequestSuccess, reqLogger, toolNameMap, customToolNames, streamController,
  onStreamComplete, onStreamFailure, streamDetailId, pxpipe, log, credentials, reexecute, executor,
}) {
  const { signal } = streamController;
  const contentType = (providerResponse.headers.get("content-type") || "").toLowerCase();
  const assumesSse = TERMINAL_SSE_FORMATS.has(targetFormat) && !NATIVE_STREAM_PROVIDERS.has(provider);
  const sendsSse = contentType.includes("text/event-stream") || (!contentType && assumesSse);
  const sendsJson = contentType.includes("application/json") || contentType.includes("+json");
  const sendsNdjson = targetFormat === FORMATS.OLLAMA && contentType.includes("ndjson");
  const cancel = () => {
    void providerResponse.body?.cancel().catch(() => {});
    streamController.handleDisconnect("client_closed");
    return createErrorResult(HTTP_STATUS.CLIENT_CLOSED_REQUEST, "Request aborted");
  };
  const fail = (message, status = HTTP_STATUS.BAD_GATEWAY, accountStatus = status, headers = providerResponse.headers, resetsAtMs) => {
    streamController.handleError(new Error(`Before first output (${accountStatus}): ${message}`));
    onStreamFailure?.({ message, status, outputSeen: false, phase: "preflight" });
    appendRequestLog({ provider, model, connectionId, status: `FAILED ${accountStatus}` }).catch(() => {});
    return createErrorResult(status, `[${status}]: ${message}`, resetsAtMs, upstreamResponseHeaders(headers), accountStatus);
  };
  const preflight = (sendsSse && assumesSse && provider !== "codex") || sendsJson;
  if (signal?.aborted) return cancel();
  if (preflight) {
    let prepared;
    try {
      prepared = await prepareStreamingResponse(providerResponse, {
        reexecute: provider === "codex" ? undefined : reexecute,
        attempts: STREAM_PRECONTENT_RETRY_ATTEMPTS,
        delayMs: STREAM_PRECONTENT_RETRY_DELAY_MS,
        signal, executor, allowMissingContentType: assumesSse,
        onRetry: (message) => log?.warn?.("STREAM", `${provider}/${model} | before first output: ${message}`),
      });
    } catch (error) {
      if (signal?.aborted) return cancel();
      throw error;
    }
    if (prepared.error) {
      const { error, exhausted, headers } = prepared;
      const accountStatus = getStreamErrorStatus(error) ?? HTTP_STATUS.BAD_GATEWAY;
      const status = (exhausted && accountStatus >= 500) || isTransientStreamError(error.code)
        ? HTTP_STATUS.BAD_GATEWAY : getClientErrorStatus(accountStatus, error.message);
      return fail(error.message, status, accountStatus, headers, error.resetsAtMs);
    }
    providerResponse = prepared.response;
  } else if (contentType && !sendsSse && !sendsNdjson) {
    const text = await readErrorResponseText(providerResponse, { signal }).catch(() => "");
    if (signal?.aborted) return cancel();
    const title = text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
    const detail = (title || (text.length <= UPSTREAM_ERROR_TITLE_MAX_CHARS ? text : ""))
      .replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim().slice(0, UPSTREAM_ERROR_TITLE_MAX_CHARS);
    return fail(detail || `Upstream returned non-SSE response (${contentType})`);
  }
  if (signal?.aborted) return cancel();
  if (!providerResponse.body) return fail("Upstream returned no stream body");

  const complete = (...args) => {
    if (onRequestSuccess) {
      void Promise.resolve().then(onRequestSuccess).catch((error) => {
        console.error("[ChatCore] onRequestSuccess failed:", error?.message || error);
      });
    }
    return onStreamComplete?.(...args);
  };
  const lifecycleOptions = { requireUpstreamTerminal: sendsSse && assumesSse, onStreamFailure };
  const transformStream = buildTransformStream({
    provider, sourceFormat, targetFormat, userAgent, reqLogger, toolNameMap, customToolNames, model, connectionId,
    body, onStreamComplete: complete, apiKey, credentials, lifecycleOptions,
  });
  const onAbortTerminal = (message, responseId, error) => {
    const status = getUpstreamDisconnectStatus(error);
    onStreamFailure?.({ message, status, outputSeen: transformStream.hasOutput?.(), phase: "committed" });
    appendRequestLog({ provider, model, connectionId, status: `FAILED ${status}` }).catch(() => {});
    return sourceFormat === FORMATS.OPENAI_RESPONSES
      ? buildAbortedResponsesTerminalBytes(message, status, responseId)
      : buildStreamErrorBytes(status, message, sourceFormat);
  };
  const stallTimeoutMs = resolveStreamStallTimeoutMs(PROVIDERS[provider]?.stallTimeoutMs);
  const transformedBody = pipeWithDisconnect(providerResponse, transformStream, streamController, onAbortTerminal, stallTimeoutMs);
  const heartbeat = sendsSse && STREAM_HEARTBEAT_INTERVAL_MS > 0 && TERMINAL_SSE_FORMATS.has(sourceFormat);
  const responseBody = heartbeat
    ? withSseHeartbeat(transformedBody, STREAM_HEARTBEAT_INTERVAL_MS, signal, () => !!transformStream.hasOutput?.())
    : transformedBody;

  saveRequestDetail(buildRequestDetail({
    provider, model, connectionId,
    latency: { ttft: 0, total: Date.now() - requestStartTime },
    tokens: { prompt_tokens: 0, completion_tokens: 0 },
    request: extractRequestConfig(body, stream),
    providerRequest: getProviderBody?.() || finalBody || translatedBody || null,
    providerResponse: "[Streaming - raw response not captured]",
    response: { content: "[Streaming in progress...]", thinking: null, type: "streaming" },
    pxpipe,
    status: "success"
  }, { id: streamDetailId })).catch(err => {
    console.error("[RequestDetail] Failed to save streaming request:", err.message);
  });

  return {
    success: true,
    response: new Response(responseBody, { headers: {
      ...SSE_HEADERS, ...(heartbeat ? { "X-Accel-Buffering": "no" } : {}), ...upstreamResponseHeaders(providerResponse.headers),
    } }),
  };
}

/**
 * Build onStreamComplete callback for streaming usage tracking.
 */
export function buildOnStreamComplete({ provider, model, connectionId, apiKey, requestStartTime, body, stream, finalBody, getProviderBody, translatedBody, clientRawRequest, pxpipe, reqTag, log }) {
  const streamDetailId = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

  const onStreamComplete = (contentObj, usage, ttftAt) => {
    const latency = {
      ttft: ttftAt ? ttftAt - requestStartTime : Date.now() - requestStartTime,
      total: Date.now() - requestStartTime
    };
    const safeContent = contentObj?.content || "[Empty streaming response]";
    const safeThinking = contentObj?.thinking || null;

    saveRequestDetail(buildRequestDetail({
      provider, model, connectionId,
      latency,
      tokens: usage || { prompt_tokens: 0, completion_tokens: 0 },
      request: extractRequestConfig(body, stream),
      providerRequest: getProviderBody?.() || finalBody || translatedBody || null,
      providerResponse: safeContent,
      response: { content: safeContent, thinking: safeThinking, type: "streaming" },
      pxpipe,
      status: "success"
    }, { id: streamDetailId })).catch(err => {
      console.error("[RequestDetail] Failed to update streaming content:", err.message);
    });

    // Persist stream usage to DB (no console line; the "📊 done" line below is authoritative)
    saveUsageStats({ provider, model, tokens: usage, connectionId, apiKey, endpoint: clientRawRequest?.endpoint, label: "STREAM USAGE", silent: true });
    if (log?.line) log.line(reqTag, "📊", formatDoneLine({ usage, latency }));
  };

  return { onStreamComplete, streamDetailId };
}
