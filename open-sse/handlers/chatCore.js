import { detectFormat, getTargetFormat, resolveTransport } from "../services/provider.js";
import { translateRequest } from "../translator/index.js";
import { stripThinkingSuffix } from "../translator/concerns/thinkingUnified.js";
import { FORMATS } from "../translator/formats.js";
import { normalizeClaudePassthrough } from "../translator/formats/claude.js";
import { COLORS } from "../utils/stream.js";
import { createStreamController, isXaiReasoningRequest } from "../utils/streamHandler.js";
import { refreshWithRetry } from "../services/tokenRefresh.js";
import { createRequestLogger } from "../utils/requestLogger.js";
import { resolveSessionId } from "../utils/sessionManager.js";
import { getModelTargetFormat, getModelStrip, getModelUpstreamId, getModelType, PROVIDER_ID_TO_ALIAS } from "../config/providerModels.js";
import { PROVIDERS } from "../config/providers.js";
import { createErrorResult, parseUpstreamError, formatProviderError } from "../utils/error.js";
import { HTTP_STATUS, XAI_REASONING_STREAM_TIMEOUT_MS } from "../config/runtimeConfig.js";
import { handleBypassRequest } from "../utils/bypassHandler.js";
import { trackPendingRequest, appendRequestLog, saveRequestDetail } from "@/lib/usageDb.js";
import { getExecutor } from "../executors/index.js";
import { buildRequestDetail, extractRequestConfig } from "./chatCore/requestDetail.js";
import { handleForcedSSEToJson } from "./chatCore/sseToJsonHandler.js";
import { handleNonStreamingResponse } from "./chatCore/nonStreamingHandler.js";
import { handleStreamingResponse, buildOnStreamComplete } from "./chatCore/streamingHandler.js";
import { detectClientTool, isNativePassthrough } from "../utils/clientDetector.js";
import { dedupeTools } from "../utils/toolDeduper.js";
import { injectCaveman } from "../rtk/caveman.js";
import { injectPonytail } from "../rtk/ponytail.js";
import { compressMessages, formatRtkLog } from "../rtk/index.js";
import { compressWithPxpipe } from "../rtk/pxpipe.js";
import { compressWithHeadroom, formatHeadroomLog, formatHeadroomSizeLog, isHeadroomPhantomSavings } from "../rtk/headroom.js";
import { getCapabilitiesForModel } from "../providers/capabilities.js";
import { stripUnsupportedModalities } from "../translator/concerns/modality.js";
import { prefetchRemoteImages } from "../translator/concerns/prefetch.js";

/**
 * Core chat handler - shared between SSE and Worker
 * @param {object} options.body - Request body
 * @param {object} options.modelInfo - { provider, model }
 * @param {object} options.credentials - Provider credentials
 * @param {string} options.sourceFormatOverride - Override detected source format (e.g. "openai-responses")
 */
export async function handleChatCore({ body, modelInfo, credentials, log, onCredentialsRefreshed, onRequestSuccess, onDisconnect, clientRawRequest, connectionId, userAgent, apiKey, ccFilterNaming, rtkEnabled, headroomEnabled, headroomUrl, headroomCompressUserMessages, cavemanEnabled, cavemanLevel, ponytailEnabled, ponytailLevel, pxpipeEnabled, pxpipeMinChars, pxpipeTimeoutMs, pxpipeTransform, onPxpipeEvent, sourceFormatOverride, providerThinking }) {
  const { provider, model } = modelInfo;
  const requestStartTime = Date.now();
  // Stable per-session color so all lines of one CLI conversation share a tag
  const sessionSeed = (() => {
    try {
      return resolveSessionId({ headers: clientRawRequest?.headers, body, connectionId, scope: provider });
    } catch {
      return connectionId || "";
    }
  })();
  const reqTag = log?.tagForSession ? log.tagForSession(sessionSeed) : (log?.nextTag ? log.nextTag() : "");

  const sourceFormat = sourceFormatOverride || detectFormat(body);

  // Check for bypass patterns (warmup, skip, cc naming)
  const bypassResponse = handleBypassRequest(body, model, userAgent, ccFilterNaming);
  if (bypassResponse) return bypassResponse;

  const alias = PROVIDER_ID_TO_ALIAS[provider] || provider;
  const modelTargetFormat = getModelTargetFormat(alias, model);
  // Multi-endpoint providers: pick transport matching sourceFormat → zero translation
  const runtimeTransport = resolveTransport(provider, sourceFormat);
  const targetFormat = modelTargetFormat || runtimeTransport?.format || getTargetFormat(provider);
  if (runtimeTransport && credentials) credentials.runtimeTransport = runtimeTransport;
  const stripList = getModelStrip(alias, model);
  const upstreamModel = getModelUpstreamId(alias, model);

  // Inject provider-level thinking config override (only if client hasn't set)
  // on/off → extended type (body.thinking), none/low/medium/high → effort type (body.reasoning_effort)
  if (providerThinking?.mode && providerThinking.mode !== "auto") {
    const mode = providerThinking.mode;
    if (mode === "on" && !body.thinking) {
      log?.debug?.("THINKING", "Injecting provider-level thinking config override: on");
      body = { ...body, thinking: { type: "enabled", budget_tokens: 10000 } };
    } else if (mode === "off" && !body.thinking) {
      body = { ...body, thinking: { type: "disabled" } };
    } else if (!body.reasoning_effort) {
      body = { ...body, reasoning_effort: mode };
    }
  }

  const clientRequestedStreaming = body.stream === true || sourceFormat === FORMATS.ANTIGRAVITY || sourceFormat === FORMATS.GEMINI || sourceFormat === FORMATS.GEMINI_CLI;
  const providerRequiresStreaming = PROVIDERS[provider]?.forceStream === true;
  let stream = providerRequiresStreaming ? true : (body.stream !== false);

  // Image generation models require non-streaming (Google v1internal:generateContent)
  const modelType = getModelType(alias, model);
  const isImageGenModel = modelType === "imageGen" || /image|imagen|image-generation/i.test(model);
  if (isImageGenModel && (provider === "antigravity" || provider === "gemini-cli")) {
    stream = false;
  }

  // DeepSeek-TUI: interactive TUI panel sends stream:true and needs SSE.
  // Non-interactive mode (-p flag) sends without stream and can't parse SSE.
  // Only force non-streaming when client didn't explicitly request it.
  const detectedTool = detectClientTool(clientRawRequest?.headers || {}, body);
  if (detectedTool === "deepseek-tui" && body.stream !== true) stream = false;

  // Check client Accept header preference for non-streaming requests
  // This fixes AI SDK compatibility where clients send Accept: application/json
  const acceptHeader = clientRawRequest?.headers?.accept || "";
  const clientPrefersJson = acceptHeader.includes("application/json");
  const clientPrefersSSE = acceptHeader.includes("text/event-stream");
  if (clientPrefersJson && !clientPrefersSSE && body.stream !== true && !providerRequiresStreaming) {
    stream = false;
  }

  const reqLogger = await createRequestLogger(sourceFormat, targetFormat, model);
  if (clientRawRequest) reqLogger.logClientRawRequest(clientRawRequest.endpoint, clientRawRequest.body, clientRawRequest.headers);
  reqLogger.logRawRequest(body);
  log?.debug?.("FORMAT", `${sourceFormat} → ${targetFormat} | stream=${stream}`);

  // Native passthrough: CLI tool and provider are the same ecosystem
  // Skip all translation/normalization — only model and Bearer are swapped
  const clientTool = detectClientTool(clientRawRequest?.headers || {}, body);
  const passthrough = isNativePassthrough(clientTool, provider);

  // Expose raw client headers to translators/executors for session-id resolution
  if (credentials) credentials.rawHeaders = clientRawRequest?.headers || {};

  // Auto-strip media blocks the model can't read (vision/audio/pdf) before translation.
  if (!passthrough) {
    const caps = getCapabilitiesForModel(provider, model);
    if (stripUnsupportedModalities(body, sourceFormat, caps)) {
      log?.debug?.("MODALITY", `stripped unsupported media for ${provider}/${model}`);
    }
    // Convert remote image URLs to base64 for targets that can't fetch URLs.
    try {
      const n = await prefetchRemoteImages(body, sourceFormat, targetFormat, { signal: undefined });
      if (n > 0) log?.debug?.("MODALITY", `prefetched ${n} remote image(s) for ${targetFormat}`);
    } catch (e) { log?.warn?.("MODALITY", `image prefetch failed: ${e.message}`); }
  }

  let translatedBody;
  let toolNameMap;
  if (passthrough) {
    log?.debug?.("PASSTHROUGH", `${clientTool} → ${provider} | native lossless`);
    translatedBody = { ...body, model: stripThinkingSuffix(upstreamModel) };
    // Normalize newer Cowork/CC beta shapes (adaptive thinking, mid-conversation system) the API rejects
    if (clientTool === "claude") normalizeClaudePassthrough(translatedBody, translatedBody.model);
  } else {
    translatedBody = translateRequest(sourceFormat, targetFormat, upstreamModel, body, stream, credentials, provider, reqLogger, stripList, connectionId, clientTool);
    if (!translatedBody) {
      trackPendingRequest(model, provider, connectionId, false, true);
      return createErrorResult(HTTP_STATUS.BAD_REQUEST, `Failed to translate request for ${sourceFormat} → ${targetFormat}`);
    }
    toolNameMap = translatedBody._toolNameMap;
    delete translatedBody._toolNameMap;
    translatedBody.model = stripThinkingSuffix(upstreamModel);
  }

  // Dedupe duplicate built-in tools when equivalent MCP tools are present (Claude clients only).
  if (clientTool === "claude" && Array.isArray(translatedBody.tools)) {
    const { tools: deduped, stripped } = dedupeTools(translatedBody.tools);
    if (stripped.length > 0) {
      translatedBody.tools = deduped;
      log?.debug?.("TOOLDEDUP", `stripped ${stripped.length}: ${stripped.slice(0, 3).join(", ")}${stripped.length > 3 ? "..." : ""}`);
    }
  }

  // Token savers: applied at the final body just before dispatch
  // Covers both passthrough (source shape) and translated (target shape) flows
  const finalFormat = passthrough ? sourceFormat : targetFormat;

  // TTS models don't support tool messages/function calling
  if (getModelType(alias, model) === "tts" && translatedBody.messages) {
    translatedBody.messages = translatedBody.messages.filter(msg => msg.role !== "tool");
    delete translatedBody.tools;
  }

  // RTK: compress tool_result content
  const rtkStats = compressMessages(translatedBody, rtkEnabled);
  const rtkLine = formatRtkLog(rtkStats);
  if (rtkLine) log?.debug?.("RTK", rtkLine);

  // Headroom: optional external proxy compression; fail open if proxy is absent.
  const headroomDiagnostics = {};
  const headroomStats = await compressWithHeadroom(translatedBody, { enabled: headroomEnabled, url: headroomUrl, model: upstreamModel, format: finalFormat, compressUserMessages: headroomCompressUserMessages, diagnostics: headroomDiagnostics });
  const headroomLine = formatHeadroomLog(headroomStats);
  const headroomSizeLine = formatHeadroomSizeLog(headroomDiagnostics);
  if (headroomLine) {
    log?.info?.("HEADROOM", `${headroomLine}${headroomSizeLine ? ` | ${headroomSizeLine}` : ""}`);
    if (isHeadroomPhantomSavings(headroomStats, headroomDiagnostics)) {
      log?.warn?.("HEADROOM", `reported token delta, but outbound JSON shrank <5%; provider may bill near-original payload | ${headroomSizeLine}`);
    }
  } else if (headroomEnabled) log?.warn?.("HEADROOM", `skipped: ${headroomDiagnostics.reason || "compression unavailable"}${headroomDiagnostics.endpoint ? ` (${headroomDiagnostics.endpoint})` : ""}`);

  // Caveman: inject terse-style system prompt
  if (cavemanEnabled && cavemanLevel) {
    injectCaveman(translatedBody, finalFormat, cavemanLevel);
    log?.debug?.("CAVEMAN", `${cavemanLevel} | ${finalFormat}`);
  }

  // Token Saver observability: summarize RTK byte savings + caveman state for request details.
  const rtkSaved = rtkStats ? (rtkStats.bytesBefore - rtkStats.bytesAfter) : 0;
  const tokenSaver = (rtkStats && rtkStats.hits?.length) || (cavemanEnabled && cavemanLevel)
    ? {
        rtk: rtkStats && rtkStats.hits?.length
          ? {
              bytesBefore: rtkStats.bytesBefore,
              bytesAfter: rtkStats.bytesAfter,
              savedBytes: rtkSaved,
              savedPercent: rtkStats.bytesBefore > 0
                ? Number(((rtkSaved / rtkStats.bytesBefore) * 100).toFixed(1))
                : 0,
              hits: rtkStats.hits.length,
              filtersUsed: [...new Set(rtkStats.hits.map((h) => h.filter))],
            }
          : null,
        caveman: cavemanEnabled && cavemanLevel ? { level: cavemanLevel } : null,
      }
    : null;

  // Ponytail: inject lazy-senior-dev system prompt
  if (ponytailEnabled && ponytailLevel) {
    injectPonytail(translatedBody, finalFormat, ponytailLevel);
    log?.debug?.("PONYTAIL", `${ponytailLevel} | ${finalFormat}`);
  }

  // PXPIPE: image bulky context (Claude-format bodies only), last saver before dispatch
  let pxpipeSummary = null;
  if (pxpipeEnabled) {
    const pxpipeResult = await compressWithPxpipe(translatedBody, {
      enabled: true, format: finalFormat, model: upstreamModel,
      minChars: pxpipeMinChars, timeoutMs: pxpipeTimeoutMs, transform: pxpipeTransform,
    });
    pxpipeSummary = pxpipeResult.summary;
    if (pxpipeResult.body) translatedBody = pxpipeResult.body;
    if (pxpipeSummary?.applied) log?.debug?.("PXPIPE", `${pxpipeSummary.imageCount}img`);
    try { onPxpipeEvent?.({ provider, model, ...pxpipeSummary }); } catch { /* stats must not break requests */ }
  }

  const executor = getExecutor(provider);
  trackPendingRequest(model, provider, connectionId, true);
  appendRequestLog({ model, provider, connectionId, status: "PENDING" }).catch(() => { });

  const msgCount = translatedBody.messages?.length || translatedBody.input?.length || translatedBody.contents?.length || translatedBody.request?.contents?.length || 0;
  log?.debug?.("REQUEST", `${provider.toUpperCase()} | ${model} | ${msgCount} msgs`);

  const isXaiReasoning = isXaiReasoningRequest(provider, model, translatedBody || body);
  const xaiReasoningTimeouts = isXaiReasoning ? {
    connectTimeoutMs: XAI_REASONING_STREAM_TIMEOUT_MS,
    firstChunkTimeoutMs: XAI_REASONING_STREAM_TIMEOUT_MS,
    stallTimeoutMs: XAI_REASONING_STREAM_TIMEOUT_MS
  } : null;
  const streamController = createStreamController({
    log, provider, model, reqTag,
    ...(xaiReasoningTimeouts ? {
      firstChunkTimeoutMs: xaiReasoningTimeouts.firstChunkTimeoutMs,
      stallTimeoutMs: xaiReasoningTimeouts.stallTimeoutMs
    } : {})
  });

  const proxyOptions = {
    connectionProxyEnabled: credentials?.providerSpecificData?.connectionProxyEnabled === true,
    connectionProxyUrl: credentials?.providerSpecificData?.connectionProxyUrl || "",
    connectionNoProxy: credentials?.providerSpecificData?.connectionNoProxy || "",
    vercelRelayUrl: credentials?.providerSpecificData?.vercelRelayUrl || "",
    strictProxy: credentials?.providerSpecificData?.strictProxy === true,
  };

  if (proxyOptions.vercelRelayUrl) {
    const connectionName = credentials?.connectionName || credentials?.connectionId || "unknown";
    const poolId = credentials?.providerSpecificData?.connectionProxyPoolId || "none";
    log?.info?.("PROXY", `${provider.toUpperCase()} | ${model} | conn=${connectionName} | pool=${poolId} | relay=${proxyOptions.vercelRelayUrl}`);
  } else if (proxyOptions.connectionProxyEnabled && proxyOptions.connectionProxyUrl) {
    let maskedProxyUrl = proxyOptions.connectionProxyUrl;
    try {
      const parsed = new URL(proxyOptions.connectionProxyUrl);
      const host = parsed.hostname || "";
      const port = parsed.port ? `:${parsed.port}` : "";
      const protocol = parsed.protocol || "http:";
      maskedProxyUrl = `${protocol}//${host}${port}`;
    } catch {
      // Keep raw if URL parsing fails
    }

    const poolId = credentials?.providerSpecificData?.connectionProxyPoolId || "none";
    const connectionName = credentials?.connectionName || credentials?.connectionId || "unknown";
    log?.info?.("PROXY", `${provider.toUpperCase()} | ${model} | conn=${connectionName} | pool=${poolId} | url=${maskedProxyUrl}`);
  }

  if (proxyOptions.connectionProxyEnabled && proxyOptions.connectionNoProxy) {
    const connectionName = credentials?.connectionName || credentials?.connectionId || "unknown";
    log?.debug?.("PROXY", `${provider.toUpperCase()} | ${model} | conn=${connectionName} | no_proxy=${proxyOptions.connectionNoProxy}`);
  }

  // Execute request
  let providerResponse, providerUrl, providerHeaders, finalBody;
  try {
    const result = await executor.execute({ model, body: translatedBody, stream, credentials, signal: streamController.signal, log, proxyOptions, connectTimeoutMs: xaiReasoningTimeouts?.connectTimeoutMs });
    providerResponse = result.response;
    providerUrl = result.url;
    providerHeaders = result.headers;
    finalBody = result.transformedBody;
    reqLogger.logTargetRequest(providerUrl, providerHeaders, finalBody);
  } catch (error) {
    trackPendingRequest(model, provider, connectionId, false, true);
    appendRequestLog({ model, provider, connectionId, status: `FAILED ${error.name === "AbortError" ? 499 : HTTP_STATUS.BAD_GATEWAY}` }).catch(() => { });
    saveRequestDetail(buildRequestDetail({
      provider, model, connectionId,
      latency: { ttft: 0, total: Date.now() - requestStartTime },
      tokens: { prompt_tokens: 0, completion_tokens: 0 },
      request: extractRequestConfig(body, stream),
      providerRequest: translatedBody || null,
      response: { error: error.message || String(error), status: error.name === "AbortError" ? 499 : 502, thinking: null },
      pxpipe: pxpipeSummary,
      status: "error",
      tokenSaver
    })).catch(() => { });

    if (error.name === "AbortError") {
      streamController.handleError(error);
      return createErrorResult(499, "Request aborted");
    }
    const errMsg = formatProviderError(error, provider, model, HTTP_STATUS.BAD_GATEWAY);
    if (log?.errorLine) {
      log.errorLine(reqTag, "✗", `ERROR · ${provider}/${model} · ${Date.now() - requestStartTime}ms\n    ${errMsg}${error?.stack ? `\n    ${error.stack}` : ""}`);
    } else {
      log?.error?.("ERROR", errMsg);
    }
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, errMsg);
  }

  // Handle 401/403 - try token refresh (skip for noAuth providers)
  if (!executor.noAuth && (providerResponse.status === HTTP_STATUS.UNAUTHORIZED || providerResponse.status === HTTP_STATUS.FORBIDDEN)) {
    try {
      const newCredentials = await refreshWithRetry(() => executor.refreshCredentials(credentials, log), 3, log);
      if (newCredentials?.accessToken || newCredentials?.copilotToken) {
        log?.info?.("TOKEN", `${provider.toUpperCase()} | refreshed`);
        Object.assign(credentials, newCredentials);
        if (onCredentialsRefreshed) {
          try { await onCredentialsRefreshed(newCredentials); } catch (e) { log?.warn?.("TOKEN", `onCredentialsRefreshed failed: ${e.message}`); }
        }
        try {
          const retryResult = await executor.execute({ model, body: translatedBody, stream, credentials, signal: streamController.signal, log, proxyOptions, connectTimeoutMs: xaiReasoningTimeouts?.connectTimeoutMs });
          if (retryResult.response.ok) { providerResponse = retryResult.response; providerUrl = retryResult.url; }
        } catch { log?.warn?.("TOKEN", `${provider.toUpperCase()} | retry after refresh failed`); }
      } else {
        log?.warn?.("TOKEN", `${provider.toUpperCase()} | refresh failed`);
        // Only escalate to needs_relogin when the upstream OAuth response
        // explicitly told us the refresh token itself is bad (Auth0 family
        // revoke, idle expiry, refresh-token reuse). Transient null results
        // (network blip, 5xx) stay quiet so we don't false-flag good accounts.
        if (onCredentialsRefreshed && isUnrecoverableRefreshError(newCredentials)) {
          try {
            await onCredentialsRefreshed({
              error: newCredentials.error || "unrecoverable_refresh_error",
              code: newCredentials.code || newCredentials.error,
              providerStatus: providerResponse.status,
            });
          } catch (e) {
            log?.warn?.("TOKEN", `onCredentialsRefreshed (unrecoverable) failed: ${e.message}`);
          }
        }
      }
    } catch (e) {
      log?.warn?.("TOKEN", `${provider.toUpperCase()} | refresh threw: ${e.message}`);
    }
  }

  // Provider returned error
  if (!providerResponse.ok) {
    trackPendingRequest(model, provider, connectionId, false, true);
    const { statusCode, message, resetsAtMs } = await parseUpstreamError(providerResponse, executor);
    appendRequestLog({ model, provider, connectionId, status: `FAILED ${statusCode}` }).catch(() => { });
    saveRequestDetail(buildRequestDetail({
      provider, model, connectionId,
      latency: { ttft: 0, total: Date.now() - requestStartTime },
      tokens: { prompt_tokens: 0, completion_tokens: 0 },
      request: extractRequestConfig(body, stream),
      providerRequest: finalBody || translatedBody || null,
      response: { error: message, status: statusCode, thinking: null },
      pxpipe: pxpipeSummary,
      status: "error",
      tokenSaver
    })).catch(() => { });

    const errMsg = formatProviderError(new Error(message), provider, model, statusCode);
    if (log?.errorLine) {
      log.errorLine(reqTag, "✗", `ERROR · ${provider}/${model} · ${Date.now() - requestStartTime}ms\n    ${errMsg}${error?.stack ? `\n    ${error.stack}` : ""}`);
    } else {
      log?.error?.("ERROR", errMsg);
    }
    reqLogger.logError(new Error(message), finalBody || translatedBody);
    return createErrorResult(statusCode, errMsg, resetsAtMs);
  }

  // xAI: passively capture rate-limit headers from the successful upstream
  // response. xAI exposes no usage/quota endpoint, but `/v1/chat/completions`
  // returns x-ratelimit-* headers. Persist per-connection (fire-and-forget, no
  // extra request, no added latency) so the Usage page can render them.
  if (provider === "xai" && typeof onProviderRateLimit === "function") {
    const h = providerResponse.headers;
    const num = (k) => {
      const v = h?.get?.(k);
      const n = v == null ? NaN : Number(v);
      return Number.isFinite(n) ? n : null;
    };
    const snapshot = {
      capturedAt: new Date().toISOString(),
      limitRequests: num("x-ratelimit-limit-requests"),
      remainingRequests: num("x-ratelimit-remaining-requests"),
      limitTokens: num("x-ratelimit-limit-tokens"),
      remainingTokens: num("x-ratelimit-remaining-tokens"),
    };
    if (snapshot.limitRequests != null || snapshot.limitTokens != null) {
      Promise.resolve(onProviderRateLimit(snapshot)).catch(() => {});
    }
  }

  const sharedCtx = { provider, model, body, stream, translatedBody, finalBody, requestStartTime, connectionId, apiKey, clientRawRequest, onRequestSuccess, tokenSaver, pxpipe: pxpipeSummary, reqTag, log };
  const appendLog = (extra) => appendRequestLog({ model, provider, connectionId, ...extra }).catch(() => { });
  const trackDone = () => trackPendingRequest(model, provider, connectionId, false);

  // Provider forced streaming but client wants JSON
  if (!clientRequestedStreaming && providerRequiresStreaming) {
    const result = await handleForcedSSEToJson({ ...sharedCtx, providerResponse, sourceFormat, trackDone, appendLog });
    if (result) { streamController.handleComplete(); return result; }
  }

  // True non-streaming response
  if (!stream) {
    const result = await handleNonStreamingResponse({ ...sharedCtx, providerResponse, sourceFormat, targetFormat, reqLogger, toolNameMap, trackDone, appendLog });
    streamController.handleComplete();
    return result;
  }

  // Streaming response
  const { onStreamComplete, streamDetailId } = buildOnStreamComplete({ ...sharedCtx });
  return handleStreamingResponse({ ...sharedCtx, providerResponse, sourceFormat, targetFormat, userAgent, reqLogger, toolNameMap, streamController, onStreamComplete, streamDetailId });
}

export function isTokenExpiringSoon(expiresAt, bufferMs = 5 * 60 * 1000) {
  if (!expiresAt) return false;
  return new Date(expiresAt).getTime() - Date.now() < bufferMs;
}
