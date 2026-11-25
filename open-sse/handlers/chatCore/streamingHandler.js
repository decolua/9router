import { FORMATS } from "../../translator/formats.js";
import { needsTranslation } from "../../translator/index.js";
import { createSSETransformStreamWithLogger, createPassthroughStreamWithLogger } from "../../utils/stream.js";
import { createOutcomeTrackingStream, createPrecommitStream, pipeWithDisconnect, streamFromPrecommit } from "../../utils/streamHandler.js";
import { createStreamingOutcomeTracker, OUTCOME_ERROR, OUTCOME_STATE, outcomeErrorResult, supportsOutcome } from "../../utils/upstreamOutcome.js";
import { PROVIDERS } from "../../config/providers.js";
import { HTTP_STATUS, STREAM_STALL_TIMEOUT_MS } from "../../config/runtimeConfig.js";
import { buildAbortedResponsesTerminalBytes } from "../../utils/responsesStreamHelpers.js";
import { buildStreamErrorBytes } from "../../utils/streamHelpers.js";
import { buildRequestDetail, extractRequestConfig, saveUsageStats, formatDoneLine } from "./requestDetail.js";
import { saveRequestDetail } from "@/lib/usageDb.js";
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
function buildTransformStream({ provider, sourceFormat, targetFormat, userAgent, reqLogger, toolNameMap, customToolNames, model, connectionId, body, onStreamComplete, apiKey, credentials, outcomeTracker }) {
  const isDroidCLI = userAgent?.toLowerCase().includes("droid") || userAgent?.toLowerCase().includes("codex-cli");
  // Responses-API providers (e.g. codex) emit Responses SSE → translate into client format
  const isResponsesProvider = PROVIDERS[provider]?.format === FORMATS.OPENAI_RESPONSES;
  const needsCodexTranslation = isResponsesProvider && targetFormat === FORMATS.OPENAI_RESPONSES && !isDroidCLI;

  if (needsCodexTranslation) {
    const codexTarget = CODEX_SOURCE_TO_TARGET[sourceFormat] || FORMATS.OPENAI;
    return createSSETransformStreamWithLogger(FORMATS.OPENAI_RESPONSES, codexTarget, provider, reqLogger, toolNameMap, model, connectionId, body, onStreamComplete, apiKey, customToolNames, credentials, outcomeTracker);
  }

  if (needsTranslation(targetFormat, sourceFormat)) {
    return createSSETransformStreamWithLogger(targetFormat, sourceFormat, provider, reqLogger, toolNameMap, model, connectionId, body, onStreamComplete, apiKey, customToolNames, credentials, outcomeTracker);
  }

  // The passthrough path has no format translation, so the fingerprint's tool
  // rename map (read -> read_client) has to be handed over explicitly —
  // otherwise the client receives a call to a tool it never declared (#4986).
  return createPassthroughStreamWithLogger(provider, reqLogger, model, connectionId, body, onStreamComplete, apiKey, toolNameMap, outcomeTracker);
}

/**
 * Handle streaming response — pipe provider SSE through transform stream to client.
 */
export async function handleStreamingResponse({ providerResponse, provider, model, sourceFormat, targetFormat, userAgent, body, stream, translatedBody, finalBody, requestStartTime, connectionId, apiKey, clientRawRequest, onRequestSuccess, requestSignal, reqLogger, toolNameMap, customToolNames, streamController, onStreamComplete, streamDetailId, appendLog, pxpipe, reqTag, log, credentials }) {
  const notifySuccess = () => {
    if (!onRequestSuccess) return;
    Promise.resolve()
      .then(onRequestSuccess)
      .catch(err => {
        console.error("[ChatCore] onRequestSuccess failed:", err?.message || err);
      });
  };

  // Streams in a dialect the outcome tracker understands are judged before and
  // after commit; any other executor stream keeps the plain pass-through path.
  const outcomeTracker = supportsOutcome(targetFormat) ? createStreamingOutcomeTracker({ format: targetFormat }) : null;
  if (!outcomeTracker) notifySuccess();

  // When upstream returns HTML/text instead of SSE (e.g. Cloudflare 5xx error
  // page), piping it through the SSE transform stream causes Next.js
  // "failed to pipe response" and crashes the chat router. Read the body,
  // pull a short human-readable message from the <title>, sanitize it, and
  // return a clean JSON error instead. The message is stripped of HTML tags
  // and clamped so untrusted upstream text never reaches the client verbatim
  // (the UI may render error.message as HTML). Nothing was sent yet, so this is
  // a routable 502 rather than a success.
  const upstreamContentType = (providerResponse.headers.get('content-type') || '').toLowerCase();
  if (upstreamContentType && !upstreamContentType.includes('text/event-stream') && !upstreamContentType.includes('application/json')) {
    const bodyText = await providerResponse.text().catch(() => '');
    const titleMatch = bodyText.match(/<title>([^<]+)<\/title>/i);
    const sanitizedTitle = (titleMatch?.[1] || '').replace(/<[^>]*>/g, '').replace(/[\r\n]+/g, ' ').trim().slice(0, 160);
    const shortMsg = sanitizedTitle
      || (bodyText.length < 200 ? bodyText.replace(/<[^>]*>/g, '').trim().slice(0, 160) : `Upstream returned non-SSE response (${upstreamContentType})`);
    if (log?.errorLine) log.errorLine(reqTag, "✗", `BLOCKED ${HTTP_STATUS.BAD_GATEWAY} · ${provider}/${model} · non-SSE (${upstreamContentType})\n    ${shortMsg}`);
    else console.warn(`[STREAM] ${provider} | ${model} | blocked pipe: ${shortMsg} [${HTTP_STATUS.BAD_GATEWAY}]`);
    streamController?.handleError?.(new Error(`upstream non-SSE: ${providerResponse.status}`));
    appendLog?.({ status: `FAILED ${HTTP_STATUS.BAD_GATEWAY}` });
    return outcomeErrorResult(HTTP_STATUS.BAD_GATEWAY, `[${HTTP_STATUS.BAD_GATEWAY}]: ${shortMsg || "Upstream returned invalid streaming content"}`, OUTCOME_ERROR.INVALID_CONTENT_TYPE);
  }

  const stallTimeoutMs = PROVIDERS[provider]?.stallTimeoutMs || STREAM_STALL_TIMEOUT_MS;
  let upstreamResponse = providerResponse;
  if (outcomeTracker) {
    // Hold the stream until it shows usable output: an error event, an empty
    // terminal or a reset before that point is still routable to another account
    // or combo member, because the client has not received a byte yet.
    const precommit = await createPrecommitStream(providerResponse, outcomeTracker, {
      signal: requestSignal || streamController?.signal,
      stallTimeoutMs,
    });
    if (!precommit.ok) {
      const { outcome } = precommit;
      const aborted = outcome.state === OUTCOME_STATE.CLIENT_ABORTED;
      const status = aborted ? 499 : HTTP_STATUS.BAD_GATEWAY;
      if (aborted) streamController?.handleDisconnect?.("client_aborted");
      else streamController?.handleError?.(new Error(`${outcome.errorKind}: ${outcome.error}`));
      appendLog?.({ status: `FAILED ${status}` });
      onStreamComplete?.({ content: "", thinking: "" }, null, null, outcome);
      return aborted
        ? outcomeErrorResult(499, "Request aborted", OUTCOME_ERROR.ABORTED)
        : outcomeErrorResult(HTTP_STATUS.BAD_GATEWAY, outcome.error, outcome.errorKind);
    }
    upstreamResponse = new Response(
      streamFromPrecommit(precommit).pipeThrough(createOutcomeTrackingStream(outcomeTracker)),
      { status: providerResponse.status, statusText: providerResponse.statusText, headers: providerResponse.headers }
    );
  }

  const finalizeStream = (contentObj, usage, ttftAt, outcome) => {
    if (outcomeTracker && outcome?.ok) notifySuccess();
    onStreamComplete?.(contentObj, usage, ttftAt, outcome);
  };
  const transformStream = buildTransformStream({ provider, sourceFormat, targetFormat, userAgent, reqLogger, toolNameMap, customToolNames, model, connectionId, body, onStreamComplete: finalizeStream, apiKey, credentials, outcomeTracker });

  // Terminal bytes when the stream aborts after HTTP 200 was already sent, so the
  // client sees a real error instead of a silently truncated stream.
  // Responses passthrough keeps its own response.failed shape; every other client
  // format gets the OpenAI error frame + [DONE], or `event: error` for Claude.
  const isResponsesPassthrough = sourceFormat === FORMATS.OPENAI_RESPONSES && targetFormat === FORMATS.OPENAI_RESPONSES;
  const onAbortTerminal = isResponsesPassthrough
    ? buildAbortedResponsesTerminalBytes
    : (message) => buildStreamErrorBytes(HTTP_STATUS.GATEWAY_TIMEOUT, message, sourceFormat);
  // A reset, stall or client cancel after commit never reaches flush(); report it
  // so usage, account success and the request detail reflect the real outcome.
  const lifecycle = outcomeTracker ? {
    onError: (error) => {
      outcomeTracker.fail(error?.errorKind || OUTCOME_ERROR.RESET, error?.message || "Upstream stream failed after commit");
      transformStream.finalizeOutcome();
    },
    onCancel: (reason) => {
      outcomeTracker.abortClient(typeof reason === "string" ? reason : "Client disconnected");
      transformStream.finalizeOutcome();
    },
  } : {};
  const transformedBody = pipeWithDisconnect(upstreamResponse, transformStream, streamController, onAbortTerminal, stallTimeoutMs, lifecycle);

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
    response: new Response(transformedBody, { headers: { ...SSE_HEADERS, ...upstreamResponseHeaders(providerResponse.headers) } })
  };
}

/**
 * Build onStreamComplete callback for streaming usage tracking.
 */
export function buildOnStreamComplete({ provider, model, connectionId, apiKey, requestStartTime, body, stream, finalBody, translatedBody, clientRawRequest, pxpipe, reqTag, log }) {
  const streamDetailId = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

  const onStreamComplete = (contentObj, usage, ttftAt, outcome = null) => {
    const latency = {
      ttft: ttftAt ? ttftAt - requestStartTime : Date.now() - requestStartTime,
      total: Date.now() - requestStartTime
    };

    if (outcome && !outcome.ok) {
      const aborted = outcome.state === OUTCOME_STATE.CLIENT_ABORTED;
      saveRequestDetail(buildRequestDetail({
        provider, model, connectionId,
        latency,
        tokens: { prompt_tokens: 0, completion_tokens: 0 },
        request: extractRequestConfig(body, stream),
        providerRequest: finalBody || translatedBody || null,
        providerResponse: { error: outcome.error, errorKind: outcome.errorKind },
        response: { error: outcome.error, errorKind: outcome.errorKind, type: "streaming" },
        pxpipe,
        status: aborted ? "aborted" : "error"
      }, { id: streamDetailId })).catch(err => {
        console.error("[RequestDetail] Failed to update streaming content:", err.message);
      });
      return;
    }

    const safeContent = contentObj?.content || "[Empty streaming response]";
    const safeThinking = contentObj?.thinking || null;

    saveRequestDetail(buildRequestDetail({
      provider, model, connectionId,
      latency,
      tokens: usage || { prompt_tokens: 0, completion_tokens: 0 },
      request: extractRequestConfig(body, stream),
      providerRequest: finalBody || translatedBody || null,
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
