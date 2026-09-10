import { FORMATS } from "../../translator/formats.js";
import { needsTranslation } from "../../translator/index.js";
import { createSSETransformStreamWithLogger, createPassthroughStreamWithLogger } from "../../utils/stream.js";
import { pipeWithDisconnect } from "../../utils/streamHandler.js";
import { PROVIDERS } from "../../config/providers.js";
import {
  STREAM_FIRST_CHUNK_TIMEOUT_MS,
  STREAM_STALL_TIMEOUT_MS,
  STREAM_PREFLIGHT_ENABLED,
  STREAM_PREFLIGHT_TIMEOUT_MS,
  STREAM_PREFLIGHT_MAX_BYTES
} from "../../config/runtimeConfig.js";
import { buildAbortedResponsesTerminalBytes } from "../../utils/responsesStreamHelpers.js";
import { buildAbortedAnthropicTerminalBytes } from "../../utils/anthropicStreamHelpers.js";
import { preflightTransformedStream, StreamPreflightError } from "../../utils/streamPreflight.js";
import { buildRequestDetail, extractRequestConfig, saveUsageStats, formatDoneLine } from "./requestDetail.js";
import { saveRequestDetail } from "@/lib/usageDb.js";
import { SSE_HEADERS_CORS as SSE_HEADERS } from "../../utils/sseConstants.js";

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
function buildTransformStream({ provider, sourceFormat, targetFormat, userAgent, reqLogger, toolNameMap, customToolNames, model, connectionId, body, onStreamComplete, apiKey, credentials }) {
  const isDroidCLI = userAgent?.toLowerCase().includes("droid") || userAgent?.toLowerCase().includes("codex-cli");
  // Responses-API providers (e.g. codex) emit Responses SSE → translate into client format
  const isResponsesProvider = PROVIDERS[provider]?.format === FORMATS.OPENAI_RESPONSES;
  const needsCodexTranslation = isResponsesProvider && targetFormat === FORMATS.OPENAI_RESPONSES && !isDroidCLI;

  if (needsCodexTranslation) {
    const codexTarget = CODEX_SOURCE_TO_TARGET[sourceFormat] || FORMATS.OPENAI;
    return createSSETransformStreamWithLogger(FORMATS.OPENAI_RESPONSES, codexTarget, provider, reqLogger, toolNameMap, model, connectionId, body, onStreamComplete, apiKey, customToolNames, credentials);
  }

  if (needsTranslation(targetFormat, sourceFormat)) {
    return createSSETransformStreamWithLogger(targetFormat, sourceFormat, provider, reqLogger, toolNameMap, model, connectionId, body, onStreamComplete, apiKey, customToolNames, credentials);
  }

  return createPassthroughStreamWithLogger(provider, reqLogger, model, connectionId, body, onStreamComplete, apiKey, sourceFormat);
}

/**
 * Handle streaming response — pipe provider SSE through transform stream to client.
 */
export async function handleStreamingResponse({ providerResponse, provider, model, sourceFormat, targetFormat, userAgent, body, stream, translatedBody, finalBody, requestStartTime, connectionId, apiKey, clientRawRequest, onRequestSuccess, reqLogger, toolNameMap, customToolNames, streamController, onStreamComplete, streamDetailId, pxpipe, reqTag, log, credentials }) {
  // onRequestSuccess (clears the account error) is NOT called here: an HTTP 200
  // with SSE headers does not mean the stream will complete. It is invoked from
  // the onStreamComplete path once a real terminal event is observed, so an
  // account is never cleared on a stream that stalls or aborts mid-flight.

  // When upstream returns HTML/text instead of SSE (e.g. Cloudflare 5xx error
  // page), piping it through the SSE transform stream causes Next.js
  // "failed to pipe response" and crashes the chat router. Read the body,
  // pull a short human-readable message from the <title>, sanitize it, and
  // return a clean JSON error instead. The message is stripped of HTML tags
  // and clamped so untrusted upstream text never reaches the client verbatim
  // (the UI may render error.message as HTML).
  const upstreamContentType = (providerResponse.headers.get('content-type') || '').toLowerCase();
  if (upstreamContentType && !upstreamContentType.includes('text/event-stream') && !upstreamContentType.includes('application/json')) {
    const bodyText = await providerResponse.text().catch(() => '');
    const titleMatch = bodyText.match(/<title>([^<]+)<\/title>/i);
    const sanitizedTitle = (titleMatch?.[1] || '').replace(/<[^>]*>/g, '').replace(/[\r\n]+/g, ' ').trim().slice(0, 160);
    const shortMsg = sanitizedTitle
      || (bodyText.length < 200 ? bodyText.replace(/<[^>]*>/g, '').trim().slice(0, 160) : `Upstream returned non-SSE response (${upstreamContentType})`);
    const status = providerResponse.ok ? 502 : (providerResponse.status || 502);
    const error = `[${status}]: ${shortMsg}`;
    if (log?.errorLine) log.errorLine(reqTag, "✗", `BLOCKED ${status} · ${provider}/${model} · non-SSE (${upstreamContentType})\n    ${shortMsg}`);
    else console.warn(`[STREAM] ${provider} | ${model} | blocked pipe: ${shortMsg} [${status}]`);
    streamController?.handleError?.(new Error(`upstream non-SSE: ${status}`));
    return {
      success: false,
      status,
      error,
      streamStarted: false,
      retryable: true,
      errorScope: "transport",
      lockAccount: true,
      comboFallback: true,
      response: new Response(JSON.stringify({ error: { message: error } }), {
        status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      }),
    };
  }

  const transformStream = buildTransformStream({ provider, sourceFormat, targetFormat, userAgent, reqLogger, toolNameMap, customToolNames, model, connectionId, body, onStreamComplete, apiKey, credentials });

  // Preserve each client protocol when an upstream stream aborts. A synthetic
  // terminal reports failure; it must never masquerade as message_stop.
  const isResponsesPassthrough = sourceFormat === FORMATS.OPENAI_RESPONSES && targetFormat === FORMATS.OPENAI_RESPONSES;
  const onAbortTerminal = isResponsesPassthrough
    ? buildAbortedResponsesTerminalBytes
    : sourceFormat === FORMATS.CLAUDE
      ? buildAbortedAnthropicTerminalBytes
      : null;
  const firstChunkTimeoutMs = PROVIDERS[provider]?.firstChunkTimeoutMs || STREAM_FIRST_CHUNK_TIMEOUT_MS;
  const stallTimeoutMs = PROVIDERS[provider]?.stallTimeoutMs || STREAM_STALL_TIMEOUT_MS;
  const transformedBody = pipeWithDisconnect(providerResponse, transformStream, streamController, onAbortTerminal, {
    firstChunkTimeoutMs,
    stallTimeoutMs
  });

  // Preflight: read up to the first valid transformed output event BEFORE committing
  // HTTP 200. If the upstream stream is empty/malformed and never produces a valid
  // first event, we fail pre-commit here (streamStarted:false) so combo/account
  // fallback can run — instead of returning an empty 200 to the client. Buffered
  // bytes are replayed verbatim, so a valid stream is passed through byte-for-byte.
  if (STREAM_PREFLIGHT_ENABLED) {
    try {
      const committedBody = await preflightTransformedStream(transformedBody, sourceFormat, {
        // Never shorten a provider's established TTFT budget. The global preflight
        // override may lengthen it, but defaults to the same first-chunk timeout.
        timeoutMs: Math.max(STREAM_PREFLIGHT_TIMEOUT_MS, firstChunkTimeoutMs),
        maxBytes: STREAM_PREFLIGHT_MAX_BYTES
      });
      return commitStreamingResponse({
        committedBody, provider, model, connectionId, requestStartTime,
        body, stream, translatedBody, finalBody, pxpipe, streamDetailId
      });
    } catch (error) {
      const status = error instanceof StreamPreflightError ? error.status : 502;
      const msg = error?.message || "stream failed before first output";
      if (log?.errorLine) log.errorLine(reqTag, "✗", `PREFLIGHT ${status} · ${provider}/${model} · ${msg}`);
      else console.warn(`[STREAM] ${provider} | ${model} | preflight failed: ${msg} [${status}]`);
      streamController?.handleError?.(error instanceof Error ? error : new Error(msg));
      saveRequestDetail(buildRequestDetail({
        provider, model, connectionId,
        latency: { ttft: 0, total: Date.now() - requestStartTime },
        tokens: { prompt_tokens: 0, completion_tokens: 0 },
        request: extractRequestConfig(body, stream),
        providerRequest: finalBody || translatedBody || null,
        response: { error: msg, status, thinking: null },
        pxpipe,
        status: "error"
      }, { id: streamDetailId })).catch(() => {});
      return {
        success: false,
        status,
        error: `[${status}]: ${msg}`,
        streamStarted: false,
        retryable: true,
        errorScope: "transport",
        lockAccount: true,
        comboFallback: true,
        response: new Response(JSON.stringify({ error: { message: `[${status}]: ${msg}` } }), {
          status,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
        })
      };
    }
  }

  return commitStreamingResponse({
    committedBody: transformedBody, provider, model, connectionId, requestStartTime,
    body, stream, translatedBody, finalBody, pxpipe, streamDetailId
  });
}

/**
 * Commit a streaming response: persist the in-progress request detail and hand the
 * (possibly preflighted) body to the client as an SSE Response.
 */
function commitStreamingResponse({ committedBody, provider, model, connectionId, requestStartTime, body, stream, translatedBody, finalBody, pxpipe, streamDetailId }) {
  saveRequestDetail(buildRequestDetail({
    provider, model, connectionId,
    latency: { ttft: 0, total: Date.now() - requestStartTime },
    tokens: { prompt_tokens: 0, completion_tokens: 0 },
    request: extractRequestConfig(body, stream),
    providerRequest: finalBody || translatedBody || null,
    providerResponse: "[Streaming - raw response not captured]",
    response: { content: "[Streaming in progress...]", thinking: null, type: "streaming" },
    pxpipe,
    status: "success"
  }, { id: streamDetailId })).catch(err => {
    console.error("[RequestDetail] Failed to save streaming request:", err.message);
  });

  return {
    success: true,
    streamStarted: true,
    retryable: false,
    response: new Response(committedBody, { headers: SSE_HEADERS })
  };
}

/**
 * Build onStreamComplete callback for streaming usage tracking.
 */
export function buildOnStreamComplete({ provider, model, connectionId, apiKey, requestStartTime, body, stream, finalBody, translatedBody, clientRawRequest, onRequestSuccess, pxpipe, reqTag, log }) {
  const streamDetailId = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

  const onStreamComplete = (contentObj, usage, ttftAt, { genuineTerminal = false } = {}) => {
    const latency = {
      ttft: ttftAt ? ttftAt - requestStartTime : Date.now() - requestStartTime,
      total: Date.now() - requestStartTime
    };
    const safeContent = contentObj?.content || "[Empty streaming response]";
    const safeThinking = contentObj?.thinking || null;

    // A stream that reached the flush without a genuine success terminal ended
    // incompletely (silent/incomplete close or synthetic error terminal). Record
    // it as an error, not a success, so the request log reflects reality.
    saveRequestDetail(buildRequestDetail({
      provider, model, connectionId,
      latency,
      tokens: usage || { prompt_tokens: 0, completion_tokens: 0 },
      request: extractRequestConfig(body, stream),
      providerRequest: finalBody || translatedBody || null,
      providerResponse: safeContent,
      response: genuineTerminal
        ? { content: safeContent, thinking: safeThinking, type: "streaming" }
        : { content: safeContent, thinking: safeThinking, type: "streaming", error: "stream closed before terminal event" },
      pxpipe,
      status: genuineTerminal ? "success" : "error"
    }, { id: streamDetailId })).catch(err => {
      console.error("[RequestDetail] Failed to update streaming content:", err.message);
    });

    // Persist stream usage to DB (no console line; the "📊 done" line below is authoritative)
    saveUsageStats({ provider, model, tokens: usage, connectionId, apiKey, endpoint: clientRawRequest?.endpoint, label: "STREAM USAGE", silent: true });
    if (log?.line) log.line(reqTag, "📊", formatDoneLine({ usage, latency }));

    // Clear account error state only on genuine stream completion (real success terminal
    // reached: message_stop / [DONE] / response.completed / finish_reason). Best-effort,
    // non-throwing — NOT called at pipe-build time, nor on preflight, stall, abort, a
    // silent/incomplete close, or an error terminal (genuineTerminal stays false there).
    if (genuineTerminal && typeof onRequestSuccess === "function") {
      try {
        const maybe = onRequestSuccess();
        if (maybe && typeof maybe.catch === "function") maybe.catch(() => {});
      } catch { /* best-effort */ }
    }
  };

  return { onStreamComplete, streamDetailId };
}
