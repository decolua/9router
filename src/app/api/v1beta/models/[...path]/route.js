import { handleChat } from "@/sse/handlers/chat.js";
import {
  clearAccountError,
  getProviderCredentials,
  isValidApiKey,
  markAccountUnavailable,
} from "@/sse/services/auth.js";
import { getSettings } from "@/lib/localDb";
import { PROVIDER_MODELS } from "@/shared/constants/models";
import { GEMINI_NATIVE_TTS_FETCH_TIMEOUT_MS } from "open-sse/config/runtimeConfig.js";
import { initTranslators, translateRequest } from "open-sse/translator/index.js";
import { FORMATS } from "open-sse/translator/formats.js";
import { OPENAI_FINISH } from "open-sse/translator/schema/index.js";
import { openaiToGeminiResponse } from "open-sse/translator/response/openai-to-gemini.js";

let initialized = false;
const GEMINI_NATIVE_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";
// Gemini model id charset (matches sanitizeGeminiFunctionName); blocks path traversal in upstream URL.
const GEMINI_NATIVE_MODEL_PATTERN = /^[a-zA-Z0-9_.:-]+$/;

/**
 * Initialize translators once
 */
async function ensureInitialized() {
  if (!initialized) {
    await initTranslators();
    initialized = true;
  }
}

/**
 * Handle CORS preflight
 */
export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "*"
    }
  });
}

/**
 * POST /v1beta/models/{model}:generateContent        — non-streaming
 * POST /v1beta/models/{model}:streamGenerateContent  — streaming (SSE)
 *
 * Streaming intent is determined by the URL action suffix (canonical Gemini API
 * convention), NOT by a body field. generationConfig.stream is not a real
 * Gemini API field and Gemini CLI never sets it.
 *
 * The @google/genai SDK always uses :streamGenerateContent?alt=sse for chat.
 * The upstream handleChat returns OpenAI SSE format; we transform it to
 * Gemini SSE format on the fly via transformOpenAISSEToGeminiSSE().
 */
export async function POST(request, { params }) {
  await ensureInitialized();

  try {
    const { path } = await params;
    // path = ["provider", "model:action"] or ["model:action"]

    let model;
    let action; // ":generateContent" | ":streamGenerateContent"

    if (path.length >= 2) {
      // Format: /v1beta/models/provider/model:generateContent
      const provider = path[0];
      const modelAction = path[1];
      action = modelAction.includes(":streamGenerateContent")
        ? ":streamGenerateContent"
        : ":generateContent";
      const modelName = modelAction
        .replace(":streamGenerateContent", "")
        .replace(":generateContent", "");
      model = provider + "/" + modelName;
    } else {
      // Format: /v1beta/models/model:generateContent
      const modelAction = path[0];
      action = modelAction.includes(":streamGenerateContent")
        ? ":streamGenerateContent"
        : ":generateContent";
      model = modelAction
        .replace(":streamGenerateContent", "")
        .replace(":generateContent", "");
    }

    const body = await request.json();

    if (isGeminiNativeTtsRequest(model, body)) {
      return await forwardGeminiNativeRequest(request, body, model, action);
    }

    // Streaming is determined by URL action suffix:
    //   :streamGenerateContent => stream: true  (SSE)
    //   :generateContent       => stream: false (plain JSON)
    const stream = action === ":streamGenerateContent";

    // Translate Gemini request → internal OpenAI shape through the translator
    // registry (direct gemini:openai route, request/gemini-to-openai.js).
    // The route must NOT reimplement this: the previous inline converter only
    // read parts[].text and silently dropped tools, functionCall/
    // functionResponse parts and inlineData (T1.2 M10).
    const convertedBody = translateRequest(FORMATS.GEMINI, FORMATS.OPENAI, model, body, stream);

    // Create new request with converted body
    const newRequest = new Request(request.url, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify(convertedBody),
    });

    const response = await handleChat(newRequest);

    if (stream) {
      // Transform OpenAI SSE => Gemini SSE on the fly.
      // The @google/genai SDK always uses :streamGenerateContent?alt=sse and
      // expects Gemini SSE chunks (no [DONE] sentinel — stream just closes).
      return transformOpenAISSEToGeminiSSE(response, model);
    } else {
      // Convert OpenAI JSON response => Gemini GenerateContentResponse
      return await convertOpenAIResponseToGemini(response, model);
    }
  } catch (error) {
    console.log("Error handling Gemini request:", error);
    return Response.json(
      { error: { message: error.message, code: 500 } },
      { status: 500 }
    );
  }
}

function extractGeminiClientApiKey(request) {
  const authHeader = request.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) return authHeader.slice(7);

  const googleApiKey = request.headers.get("x-goog-api-key");
  if (googleApiKey) return googleApiKey;

  const url = new URL(request.url);
  return url.searchParams.get("key");
}

function normalizeGeminiNativeModel(model) {
  return String(model || "")
    .replace(/^models\//, "")
    .replace(/^gemini\//, "");
}

function getGeminiTtsModelIds() {
  return new Set([
    ...(PROVIDER_MODELS.gemini || [])
      .filter((model) => (model.kind || model.type) === "tts")
      .map((model) => model.id),
    ...(PROVIDER_MODELS["gemini-tts-models"] || []).map((model) => model.id),
  ]);
}

function hasAudioResponseModality(body) {
  const modalities = body?.generationConfig?.responseModalities;
  return Array.isArray(modalities)
    && modalities.some((modality) => String(modality).toUpperCase() === "AUDIO");
}

function isGeminiNativeTtsRequest(model, body) {
  const rawModel = String(model || "");
  if (rawModel.includes("/") && !rawModel.startsWith("gemini/") && !rawModel.startsWith("models/")) {
    return false;
  }

  const modelId = normalizeGeminiNativeModel(model);
  return hasAudioResponseModality(body) || getGeminiTtsModelIds().has(modelId);
}

function buildGeminiNativeUrl(requestUrl, model, action) {
  const sourceUrl = new URL(requestUrl);
  const upstreamUrl = new URL(`${GEMINI_NATIVE_BASE_URL}/${normalizeGeminiNativeModel(model)}${action}`);

  for (const [key, value] of sourceUrl.searchParams.entries()) {
    if (key === "key") continue;
    upstreamUrl.searchParams.append(key, value);
  }

  return upstreamUrl.toString();
}

async function validateGeminiNativeClientKey(request) {
  const settings = await getSettings();
  if (!settings.requireApiKey) return null;

  const apiKey = extractGeminiClientApiKey(request);
  if (!apiKey) {
    return Response.json({ error: { message: "Missing API key" } }, { status: 401 });
  }

  const valid = await isValidApiKey(apiKey);
  if (!valid) {
    return Response.json({ error: { message: "Invalid API key" } }, { status: 401 });
  }

  return null;
}

function buildGeminiNativeAuthHeaders(credentials) {
  if (credentials?.apiKey) return { "x-goog-api-key": credentials.apiKey };
  if (credentials?.accessToken) return { Authorization: `Bearer ${credentials.accessToken}` };
  return null;
}

function corsHeadersFrom(response) {
  const headers = new Headers(response.headers);
  // Node fetch may expose a decoded body while preserving upstream compression
  // headers. Forwarding those headers makes clients decompress plain bytes again.
  headers.delete("content-encoding");
  headers.delete("content-length");
  headers.delete("transfer-encoding");
  headers.set("Access-Control-Allow-Origin", "*");
  return headers;
}

function getSafeGeminiConnectionLabel(credentials) {
  const connectionId = String(credentials?.connectionId || "unknown");
  const shortId = connectionId.slice(0, 8);
  const connectionName = String(credentials?.connectionName || "");
  if (!connectionName || connectionName.includes("@")) return shortId;
  return `${connectionName}:${shortId}`;
}

function getGeminiNativeErrorCode(error) {
  return error?.cause?.code || error?.code || error?.cause?.name || error?.name || "UNKNOWN";
}

function isGeminiNativeTimeoutError(error, timedOut) {
  if (timedOut) return true;
  const code = getGeminiNativeErrorCode(error);
  return code === "UND_ERR_HEADERS_TIMEOUT" || code === "HeadersTimeoutError";
}

function getSafeGeminiNativeErrorText(error) {
  const message = error?.message || String(error);
  const code = getGeminiNativeErrorCode(error);
  return `${message} (${code})`;
}

async function forwardGeminiNativeRequest(request, body, model, action) {
  const authError = await validateGeminiNativeClientKey(request);
  if (authError) return authError;

  const modelId = normalizeGeminiNativeModel(model);
  if (!GEMINI_NATIVE_MODEL_PATTERN.test(modelId)) {
    return Response.json({ error: { message: "Invalid model" } }, { status: 400 });
  }
  const excludeConnectionIds = new Set();
  const bodyText = JSON.stringify(body);
  let lastError = null;
  let lastStatus = null;

  while (true) {
    const credentials = await getProviderCredentials("gemini", excludeConnectionIds, modelId);
    if (!credentials || credentials.allRateLimited) {
      console.log(`[GEMINI_NATIVE] exhausted model=${modelId} status=${lastStatus || Number(credentials?.lastErrorCode) || 503} error=${lastError || credentials?.lastError || "No active credentials for provider: gemini"}`);
      return Response.json(
        { error: { message: lastError || credentials?.lastError || "No active credentials for provider: gemini" } },
        { status: lastStatus || Number(credentials?.lastErrorCode) || 503 }
      );
    }

    const authHeaders = buildGeminiNativeAuthHeaders(credentials);
    if (!authHeaders) {
      return Response.json(
        { error: { message: "No Gemini API key configured" } },
        { status: 404 }
      );
    }

    const safeConnection = getSafeGeminiConnectionLabel(credentials);
    const startedAt = Date.now();
    const upstreamUrl = buildGeminiNativeUrl(request.url, modelId, action);
    const attemptController = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      attemptController.abort();
    }, GEMINI_NATIVE_TTS_FETCH_TIMEOUT_MS);
    const abortAttempt = () => attemptController.abort();

    if (request.signal?.aborted) {
      console.log(`[GEMINI_NATIVE] client aborted model=${modelId} ms=0 conn=${safeConnection}`);
      return Response.json({ error: { message: "Client closed request" } }, { status: 499 });
    }

    request.signal?.addEventListener("abort", abortAttempt, { once: true });
    console.log(`[GEMINI_NATIVE] start model=${modelId} action=${action} conn=${safeConnection} body=${Buffer.byteLength(bodyText)}B timeout=${GEMINI_NATIVE_TTS_FETCH_TIMEOUT_MS}`);

    let upstreamResponse;
    try {
      upstreamResponse = await fetch(upstreamUrl, {
        method: "POST",
        headers: {
          "Content-Type": request.headers.get("Content-Type") || "application/json",
          ...authHeaders,
        },
        body: bodyText,
        signal: attemptController.signal,
      });
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      if (request.signal?.aborted && !timedOut) {
        console.log(`[GEMINI_NATIVE] client aborted model=${modelId} ms=${durationMs} conn=${safeConnection}`);
        return Response.json({ error: { message: "Client closed request" } }, { status: 499 });
      }

      const status = isGeminiNativeTimeoutError(error, timedOut) ? 504 : 502;
      const errorText = getSafeGeminiNativeErrorText(error);
      console.log(`[GEMINI_NATIVE] fetch failed model=${modelId} status=${status} ms=${durationMs} conn=${safeConnection} error=${errorText}`);

      const { shouldFallback } = await markAccountUnavailable(
        credentials.connectionId,
        status,
        errorText,
        "gemini",
        modelId
      );

      if (shouldFallback) {
        excludeConnectionIds.add(credentials.connectionId);
        lastError = errorText;
        lastStatus = status;
        console.log(`[GEMINI_NATIVE] fallback model=${modelId} status=${status} conn=${safeConnection} exclude=${excludeConnectionIds.size}`);
        continue;
      }

      return Response.json({ error: { message: errorText } }, { status });
    } finally {
      clearTimeout(timeout);
      request.signal?.removeEventListener("abort", abortAttempt);
    }

    console.log(`[GEMINI_NATIVE] upstream model=${modelId} status=${upstreamResponse.status} ms=${Date.now() - startedAt} conn=${safeConnection} ct=${upstreamResponse.headers.get("content-type") || "?"} cl=${upstreamResponse.headers.get("content-length") || "?"}`);

    if (upstreamResponse.ok) {
      await clearAccountError(credentials.connectionId, credentials, modelId);
      return new Response(upstreamResponse.body, {
        status: upstreamResponse.status,
        statusText: upstreamResponse.statusText,
        headers: corsHeadersFrom(upstreamResponse),
      });
    }

    const errorText = await upstreamResponse.text();
    const { shouldFallback } = await markAccountUnavailable(
      credentials.connectionId,
      upstreamResponse.status,
      errorText,
      "gemini",
      modelId
    );

    if (shouldFallback) {
      excludeConnectionIds.add(credentials.connectionId);
      lastError = errorText;
      lastStatus = upstreamResponse.status;
      continue;
    }

    return new Response(errorText, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: corsHeadersFrom(upstreamResponse),
    });
  }
}

/**
 * Transform an OpenAI SSE stream into a Gemini SSE stream.
 *
 * OpenAI SSE format (what handleChat returns):
 *   data: {"choices":[{"delta":{"content":"Hi"},"finish_reason":null}]}
 *   data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{...}}
 *   data: [DONE]
 *
 * Gemini SSE format (what @google/genai SDK expects):
 *   data: {"candidates":[{"content":{"role":"model","parts":[{"text":"Hi"}]},"index":0}]}
 *   data: {"candidates":[{"content":{"role":"model","parts":[{"text":""}]},"finishReason":"STOP","index":0}],"usageMetadata":{...}}
 *   (stream closes — no [DONE])
 *
 * F33 (REV-B nit 1): per-chunk mapping is delegated to the canonical
 * openaiToGeminiResponse (response/openai-to-gemini.js), same pattern F18
 * applied to sseToJsonHandler. The inline copy only read delta.content /
 * reasoning_content and silently dropped delta.tool_calls, so Gemini clients
 * never saw functionCall parts. toRouteStreamFrame re-projects the canonical
 * chunk onto this route's legacy frame envelope (no responseId, modelVersion
 * only on the finish frame with usage) so pure-text streams stay
 * byte-identical for existing clients.
 */
function toRouteStreamFrame(gem, parsed, model) {
  const candidate = gem.candidates?.[0];
  // Canonical's trailing usage-only chunk (empty candidates) has no frame in
  // this route's legacy shape — drop it, as the old inline code did.
  if (!candidate) return null;
  // Legacy key order: content → index → finishReason.
  const projected = { content: candidate.content, index: 0 };
  if (candidate.finishReason) projected.finishReason = candidate.finishReason;
  const frame = { candidates: [projected] };
  if (candidate.finishReason && parsed?.usage) {
    if (gem.usageMetadata) frame.usageMetadata = gem.usageMetadata;
    frame.modelVersion = parsed.model || model;
  }
  return frame;
}

function encodeGeminiFrame(encoder, frame) {
  return encoder.encode("data: " + JSON.stringify(frame) + "\r\n\r\n");
}

function transformOpenAISSEToGeminiSSE(upstreamResponse, model) {
  if (!upstreamResponse.ok || !upstreamResponse.body) {
    return upstreamResponse;
  }

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  // Canonical converter state, per stream: accumulates incremental
  // delta.tool_calls fragments and the finish-emit bookkeeping.
  const state = {};

  const transformStream = new TransformStream({
    transform(chunk, controller) {
      const text = decoder.decode(chunk, { stream: true });
      const lines = text.split("\n");

      for (const line of lines) {
        if (!line.startsWith("data:")) continue;

        const data = line.slice(5).trim();

        // Drop empty lines and the OpenAI [DONE] sentinel.
        // Gemini SSE ends by stream close, no sentinel needed.
        if (!data || data === "[DONE]") continue;

        let parsed;
        try {
          parsed = JSON.parse(data);
        } catch {
          continue;
        }

        const gem = openaiToGeminiResponse(parsed, state);
        if (!gem) continue;

        const frame = toRouteStreamFrame(gem, parsed, model);
        if (!frame) continue;

        controller.enqueue(encodeGeminiFrame(encoder, frame));
      }
    },
    flush(controller) {
      // Providers that close the stream without a finish_reason chunk would
      // otherwise swallow the accumulated tool calls (the canonical converter
      // emits them only on finish). Synthesize the terminal chunk so their
      // functionCall parts still land — pure-text streams are untouched.
      if (state._geminiFinishSent) return;
      if (!Object.keys(state._toolCallAccum || {}).length) return;
      const gem = openaiToGeminiResponse(
        { choices: [{ index: 0, delta: {}, finish_reason: OPENAI_FINISH.STOP }] },
        state
      );
      if (!gem) return;
      const frame = toRouteStreamFrame(gem, null, model);
      if (!frame) return;
      controller.enqueue(encodeGeminiFrame(encoder, frame));
    },
  });

  return new Response(upstreamResponse.body.pipeThrough(transformStream), {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

/**
 * Convert an OpenAI chat.completion JSON response into a Gemini
 * GenerateContentResponse so that Gemini CLI can parse it.
 *
 * F33 (REV-B nit 1): the message is shaped as a delta chunk and handed to the
 * canonical openaiToGeminiResponse (the inline copy only read
 * message.content, dropping tool_calls). The result is re-projected onto the
 * route's legacy envelope (candidates(content→finishReason→index) →
 * modelVersion → usageMetadata, no responseId) to keep pure-text JSON
 * byte-identical for existing clients.
 */
async function convertOpenAIResponseToGemini(response, model) {
  if (!response.ok) return response;

  let body;
  try {
    body = await response.json();
  } catch {
    return response;
  }

  if (body.candidates) return Response.json(body, {
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
  });

  if (body.error) return Response.json(body, {
    status: response.status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
  });

  const choice = body.choices?.[0];
  if (!choice) {
    return Response.json(body, {
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    });
  }

  const { message, finish_reason } = choice;

  // Non-streaming message.tool_calls carry no positional `index` (chat.completion
  // shape); the canonical accumulator keys by it, so add it — same F18 pattern
  // as sseToJsonHandler, otherwise parallel calls would merge into one.
  const delta = message?.tool_calls
    ? { ...message, tool_calls: message.tool_calls.map((tc, i) => ({ ...tc, index: i })) }
    : message;

  const gem = openaiToGeminiResponse(
    {
      id: body.id,
      model: body.model || model,
      choices: [
        {
          index: 0,
          delta,
          // Legacy shape always carried a finishReason; force the default
          // rather than omitting the field when upstream left it unset.
          finish_reason: finish_reason || OPENAI_FINISH.STOP,
        },
      ],
      usage: body.usage,
    },
    {}
  );

  const candidate = gem.candidates[0];
  const geminiResponse = {
    candidates: [
      {
        content: candidate.content,
        finishReason: candidate.finishReason,
        index: 0,
      },
    ],
    modelVersion: body.model || model,
  };

  if (gem.usageMetadata) {
    geminiResponse.usageMetadata = gem.usageMetadata;
  }

  return Response.json(geminiResponse, {
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
  });
}
