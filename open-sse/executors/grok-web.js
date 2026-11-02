import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { SSE_DONE, SSE_HEADERS_NO_BUFFER } from "../utils/sseConstants.js";
import { sseChunk } from "../utils/sse.js";
import { GROK_TLS_USER_AGENT, GrokTlsUnavailableError, grokTlsFetch, isCloudflareChallenge } from "../services/grokTlsClient.js";
import { buildToolRegistry, buildGrokMessage, mapNativeToolCard, parseClientToolCallMarkup, hasOpenToolCallMarkup } from "./grok-web-tools.js";
import { buildGrokCookieHeader } from "../utils/webCookieAuth.js";

const GROK_CHAT_API = PROVIDERS["grok-web"].baseUrl;
const IMAGE_TURN_TIMEOUT_MS = 170000;

// Everything routes to grok-4-1-thinking-1129 — the only modelName the
// conversations/new endpoint still accepts (older grok-3/grok-4/420 names 403
// with "Model is not found"). FAST is the reliably-available mode; the
// THINKING/EXPERT/420 modes are usage-gated per account.
const MODEL_MAP = {
  "grok-3": { grokModel: "grok-4-1-thinking-1129", modelMode: "MODEL_MODE_FAST", isThinking: false },
  "grok-3-mini": { grokModel: "grok-4-1-thinking-1129", modelMode: "MODEL_MODE_GROK_4_1_MINI_THINKING", isThinking: true },
  "grok-3-thinking": { grokModel: "grok-4-1-thinking-1129", modelMode: "MODEL_MODE_GROK_4_1_THINKING", isThinking: true },
  "grok-4": { grokModel: "grok-4-1-thinking-1129", modelMode: "MODEL_MODE_FAST", isThinking: false },
  "grok-4-mini": { grokModel: "grok-4-1-thinking-1129", modelMode: "MODEL_MODE_GROK_4_1_MINI_THINKING", isThinking: true },
  "grok-4-thinking": { grokModel: "grok-4-1-thinking-1129", modelMode: "MODEL_MODE_GROK_4_1_THINKING", isThinking: true },
  "grok-4-heavy": { grokModel: "grok-4-1-thinking-1129", modelMode: "MODEL_MODE_EXPERT", isThinking: true },
  "grok-4.1-mini": { grokModel: "grok-4-1-thinking-1129", modelMode: "MODEL_MODE_GROK_4_1_MINI_THINKING", isThinking: true },
  "grok-4.1-fast": { grokModel: "grok-4-1-thinking-1129", modelMode: "MODEL_MODE_FAST", isThinking: false },
  "grok-4.1-expert": { grokModel: "grok-4-1-thinking-1129", modelMode: "MODEL_MODE_EXPERT", isThinking: true },
  "grok-4.1-thinking": { grokModel: "grok-4-1-thinking-1129", modelMode: "MODEL_MODE_GROK_4_1_THINKING", isThinking: true },
  "grok-4.2": { grokModel: "grok-4-1-thinking-1129", modelMode: "MODEL_MODE_GROK_420", isThinking: false },
  "grok-4.20": { grokModel: "grok-4-1-thinking-1129", modelMode: "MODEL_MODE_GROK_420", isThinking: false },
  "grok-4.20-beta": { grokModel: "grok-4-1-thinking-1129", modelMode: "MODEL_MODE_GROK_420", isThinking: false },
};

// Grok Imagine free tier renders 480p; 720p exists on paid quota keys but the
// 480p request is what a logged-out-of-SuperGrok account reliably gets.
const GROK_VIDEO_RESOLUTION = "480p";
const VIDEO_TURN_TIMEOUT_MS = 300000;

/** Grok Imagine video payload — captured from grok.com/imagine submit. */
function buildGrokVideoPayload({ prompt, size, duration }) {
  const aspectRatio = /^\d{1,2}:\d{1,2}$/.test(String(size || "")) ? String(size) : "16:9";
  return {
    modelName: "imagine-video-gen",
    message: `${prompt} --mode=custom`,
    enableImageStreaming: true,
    enableSideBySide: true,
    sendFinalMetadata: true,
    responseMetadata: { experiments: [], modelConfigOverride: { modelMap: {} } },
    mediaGenInput: {
      textToVideo: {
        prompt,
        aspectRatio,
        duration: Number.isFinite(Number(duration)) && Number(duration) > 0 ? Number(duration) : 6,
        resolutionName: GROK_VIDEO_RESOLUTION,
      },
    },
    kind: "CONVERSATION_KIND_IMAGINE",
  };
}

/**
 * Deep-scan the NDJSON reply for the finished video asset. The exact chunk
 * shape has not been pinned (varies by client build), so collect any mp4 URL
 * or relative path from nested JSON — including cardAttachment.jsonData-style
 * stringified payloads.
 */
function findGrokVideoUrl(text) {
  const found = [];
  const visit = (value) => {
    if (found.length > 8) return;
    if (typeof value === "string") {
      if (/\.mp4(\?|#|$)/i.test(value)) { found.push(value); return; }
      const trimmed = value.trim();
      if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
        try { visit(JSON.parse(trimmed)); } catch { /* not JSON */ }
      }
      return;
    }
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (value && typeof value === "object") { Object.values(value).forEach(visit); }
  };
  for (const line of String(text).split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try { visit(JSON.parse(trimmed)); } catch { /* skip partial lines */ }
  }
  return found[found.length - 1] || null;
}

function randomString(length, alphanumeric = false) {
  const chars = alphanumeric ? "abcdefghijklmnopqrstuvwxyz0123456789" : "abcdefghijklmnopqrstuvwxyz";
  let result = "";
  for (let i = 0; i < length; i++) result += chars[Math.floor(Math.random() * chars.length)];
  return result;
}

function generateStatsigId() {
  const msg = Math.random() < 0.5
    ? `x1:TypeError: Cannot read properties of null (reading 'children["${randomString(5, true)}"]')`
    : `x1:TypeError: Cannot read properties of undefined (reading '${randomString(10)}')`;
  return btoa(msg);
}

function randomHex(bytes) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

function parseOpenAIMessages(messages) {
  const extracted = [];
  for (const msg of messages) {
    let role = String(msg.role || "user");
    if (role === "developer") role = "system";
    let content = "";
    if (typeof msg.content === "string") {
      content = msg.content;
    } else if (Array.isArray(msg.content)) {
      content = msg.content.filter((c) => c.type === "text").map((c) => String(c.text || "")).join(" ");
    }
    if (!content.trim()) continue;
    extracted.push({ role, text: content });
  }

  let lastUserIdx = -1;
  for (let i = extracted.length - 1; i >= 0; i--) {
    if (extracted[i].role === "user") { lastUserIdx = i; break; }
  }

  const parts = [];
  for (let i = 0; i < extracted.length; i++) {
    const { role, text } = extracted[i];
    parts.push(i === lastUserIdx ? text : `${role}: ${text}`);
  }
  return parts.join("\n\n");
}

async function* readGrokNdjsonEvents(body, signal) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      if (signal?.aborted) return;
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      while (true) {
        const idx = buffer.indexOf("\n");
        if (idx < 0) break;
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        try { yield JSON.parse(line); } catch { /* skip */ }
      }
    }
    buffer += decoder.decode();
    const remaining = buffer.trim();
    if (remaining) {
      try { yield JSON.parse(remaining); } catch { /* skip */ }
    }
  } finally {
    reader.releaseLock();
  }
}

async function* extractContent(eventStream, isThinkingModel, signal) {
  let fingerprint = "";
  let responseId = "";
  let thinkOpened = false;

  for await (const event of readGrokNdjsonEvents(eventStream, signal)) {
    if (event.error) {
      yield { error: event.error.message || `Grok error: ${event.error.code}`, done: true };
      return;
    }
    const resp = event.result?.response;
    if (!resp) continue;

    if (resp.llmInfo?.modelHash && !fingerprint) fingerprint = resp.llmInfo.modelHash;
    if (resp.responseId) responseId = resp.responseId;

    if (resp.toolUsageCard) {
      yield { toolCard: resp.toolUsageCard, toolCardId: resp.toolUsageCardId, fingerprint, responseId };
      continue;
    }

    if (resp.modelResponse) {
      const mr = resp.modelResponse;
      if (thinkOpened && isThinkingModel) {
        if (mr.message) yield { thinking: mr.message };
        thinkOpened = false;
      }
      if (mr.message) yield { fullMessage: mr.message, fingerprint, responseId };
      if (mr.metadata?.llm_info?.modelHash) fingerprint = mr.metadata.llm_info.modelHash;
      continue;
    }

    if (resp.token != null) yield { delta: resp.token, fingerprint, responseId };
  }
  yield { done: true, fingerprint, responseId };
}

function buildStreamingResponse(eventStream, model, cid, created, isThinkingModel, signal, toolRegistry) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      try {
        controller.enqueue(encoder.encode(sseChunk({
          id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: null,
          choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null, logprobs: null }],
        })));

        let fp = "";
        let pending = ""; // buffered tail — held back while a <tool_call> may be opening
        let holding = false;
        const toolCalls = [];
        for await (const chunk of extractContent(eventStream, isThinkingModel, signal)) {
          if (chunk.fingerprint) fp = chunk.fingerprint;

          if (chunk.error) {
            controller.enqueue(encoder.encode(sseChunk({
              id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: fp || null,
              choices: [{ index: 0, delta: { content: `[Error: ${chunk.error}]` }, finish_reason: null, logprobs: null }],
            })));
            break;
          }
          if (chunk.thinking) {
            controller.enqueue(encoder.encode(sseChunk({
              id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: fp || null,
              choices: [{ index: 0, delta: { reasoning_content: chunk.thinking }, finish_reason: null, logprobs: null }],
            })));
            continue;
          }
          if (chunk.toolCard && toolRegistry) {
            const call = mapNativeToolCard(chunk.toolCard, chunk.toolCardId, toolRegistry);
            if (call) toolCalls.push(call);
            continue;
          }
          if (chunk.done) break;
          if (chunk.delta) {
            if (toolRegistry?.enabled) {
              pending += chunk.delta;
              if (hasOpenToolCallMarkup(pending)) { holding = true; continue; }
              if (holding) continue;
              // Flush the safe prefix, keep a small tail in case "<tool_call>" opens across chunks.
              const keep = Math.min(12, pending.length);
              const flush = pending.slice(0, pending.length - keep);
              if (flush) {
                controller.enqueue(encoder.encode(sseChunk({
                  id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: fp || null,
                  choices: [{ index: 0, delta: { content: flush }, finish_reason: null, logprobs: null }],
                })));
              }
              pending = pending.slice(pending.length - keep);
            } else {
              controller.enqueue(encoder.encode(sseChunk({
                id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: fp || null,
                choices: [{ index: 0, delta: { content: chunk.delta }, finish_reason: null, logprobs: null }],
              })));
            }
          }
          if (chunk.fullMessage && toolRegistry?.enabled) {
            pending = chunk.fullMessage; // snapshot replaces the buffer
          }
        }

        // Tool-call extraction: markup beats native cards.
        const markupCalls = toolRegistry?.enabled ? parseClientToolCallMarkup(pending, toolRegistry) : null;
        const calls = markupCalls || (toolCalls.length ? toolCalls : null);
        if (calls?.length) {
          for (let i = 0; i < calls.length; i++) {
            controller.enqueue(encoder.encode(sseChunk({
              id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: fp || null,
              choices: [{ index: 0, delta: { tool_calls: [{ index: i, ...calls[i] }] }, finish_reason: null, logprobs: null }],
            })));
          }
          controller.enqueue(encoder.encode(sseChunk({
            id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: fp || null,
            choices: [{ index: 0, delta: {}, finish_reason: "tool_calls", logprobs: null }],
          })));
        } else {
          if (pending) {
            controller.enqueue(encoder.encode(sseChunk({
              id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: fp || null,
              choices: [{ index: 0, delta: { content: pending }, finish_reason: null, logprobs: null }],
            })));
          }
          controller.enqueue(encoder.encode(sseChunk({
            id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: fp || null,
            choices: [{ index: 0, delta: {}, finish_reason: "stop", logprobs: null }],
          })));
        }
        controller.enqueue(encoder.encode(SSE_DONE));
      } catch (err) {
        controller.enqueue(encoder.encode(sseChunk({
          id: cid, object: "chat.completion.chunk", created, model, system_fingerprint: null,
          choices: [{ index: 0, delta: { content: `[Stream error: ${err.message || String(err)}]` }, finish_reason: "stop", logprobs: null }],
        })));
        controller.enqueue(encoder.encode(SSE_DONE));
      } finally {
        controller.close();
      }
    },
  });
}

async function buildNonStreamingResponse(eventStream, model, cid, created, isThinkingModel, signal, toolRegistry) {
  let fullContent = "";
  let fingerprint = "";
  const thinkingParts = [];
  const toolCalls = [];

  for await (const chunk of extractContent(eventStream, isThinkingModel, signal)) {
    if (chunk.fingerprint) fingerprint = chunk.fingerprint;
    if (chunk.error) {
      return new Response(JSON.stringify({
        error: { message: chunk.error, type: "upstream_error", code: "GROK_ERROR" },
      }), { status: 502, headers: { "Content-Type": "application/json" } });
    }
    if (chunk.thinking) { thinkingParts.push(chunk.thinking); continue; }
    if (chunk.toolCard && toolRegistry) {
      const call = mapNativeToolCard(chunk.toolCard, chunk.toolCardId, toolRegistry);
      if (call) toolCalls.push(call);
      continue;
    }
    if (chunk.done) break;
    if (chunk.fullMessage) fullContent = chunk.fullMessage;
    else if (chunk.delta) fullContent += chunk.delta;
  }

  const msg = { role: "assistant", content: fullContent };
  if (thinkingParts.length > 0) msg.reasoning_content = thinkingParts.join("\n");

  // Tool-call extraction: markup beats native cards; strip markup from content.
  const markupCalls = toolRegistry?.enabled ? parseClientToolCallMarkup(fullContent, toolRegistry) : null;
  const calls = markupCalls || (toolCalls.length ? toolCalls : null);
  let finishReason = "stop";
  if (calls?.length) {
    msg.content = fullContent.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, "").trim();
    msg.tool_calls = calls;
    finishReason = "tool_calls";
  }

  const promptTokens = Math.ceil(fullContent.length / 4);
  const completionTokens = Math.ceil(fullContent.length / 4);

  return new Response(JSON.stringify({
    id: cid, object: "chat.completion", created, model, system_fingerprint: fingerprint || null,
    choices: [{ index: 0, message: msg, finish_reason: finishReason, logprobs: null }],
    usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: promptTokens + completionTokens },
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

export class GrokWebExecutor extends BaseExecutor {
  constructor() {
    super("grok-web", PROVIDERS["grok-web"]);
  }

  async execute({ model, body, stream, credentials, signal, log }) {
    const messages = body?.messages;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      const errResp = new Response(JSON.stringify({
        error: { message: "Missing or empty messages array", type: "invalid_request" },
      }), { status: 400, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: GROK_CHAT_API, headers: {}, transformedBody: body };
    }

    const modelInfo = MODEL_MAP[model];
    if (!modelInfo) log?.info?.("GROK-WEB", `Unmapped model ${model}, defaulting to grok-4.1-fast`);
    const { grokModel, modelMode, isThinking } = modelInfo || MODEL_MAP["grok-4.1-fast"];

    // Client tools (OpenAI `tools`) → manifest injection + native-card/markup bridge.
    const toolRegistry = buildToolRegistry(body);
    const message = toolRegistry.enabled
      ? buildGrokMessage(messages, toolRegistry, body?.tool_choice)
      : parseOpenAIMessages(messages);
    if (!message.trim()) {
      const errResp = new Response(JSON.stringify({
        error: { message: "Empty query after processing", type: "invalid_request" },
      }), { status: 400, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: GROK_CHAT_API, headers: {}, transformedBody: body };
    }

    const grokPayload = {
      temporary: true, modelName: grokModel, modelMode, message,
      fileAttachments: [], imageAttachments: [],
      disableSearch: false, enableImageGeneration: false, returnImageBytes: false,
      returnRawGrokInXaiRequest: false, enableImageStreaming: false, imageGenerationCount: 0,
      forceConcise: false, toolOverrides: {}, enableSideBySide: true, sendFinalMetadata: true,
      isReasoning: false, disableTextFollowUps: false, disableMemory: true,
      forceSideBySide: false, isAsyncChat: false, disableSelfHarmShortCircuit: false,
      deviceEnvInfo: {
        darkModeEnabled: false, devicePixelRatio: 2,
        screenWidth: 2056, screenHeight: 1329, viewportWidth: 2056, viewportHeight: 1083,
      },
    };

    const traceId = randomHex(16);
    const spanId = randomHex(8);
    const headers = {
      Accept: "*/*",
      "Accept-Encoding": "gzip, deflate, br, zstd",
      "Accept-Language": "en-US,en;q=0.9",
      Baggage: "sentry-environment=production,sentry-release=d6add6fb0460641fd482d767a335ef72b9b6abb8,sentry-public_key=b311e0f2690c81f25e2c4cf6d4f7ce1c",
      "Cache-Control": "no-cache",
      "Content-Type": "application/json",
      Origin: "https://grok.com",
      Pragma: "no-cache",
      Referer: "https://grok.com/",
      "Sec-Ch-Ua": '"Chromium";v="146", "Not(A:Brand";v="24"',
      "Sec-Ch-Ua-Mobile": "?0",
      "Sec-Ch-Ua-Platform": '"macOS"',
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "same-origin",
      "User-Agent": GROK_TLS_USER_AGENT,
      "x-statsig-id": generateStatsigId(),
      "Browser-Id": crypto.randomUUID(),
      "x-xai-request-id": crypto.randomUUID(),
      traceparent: `00-${traceId}-${spanId}-00`,
    };

    // Full cookie header: sso + paired sso-rw + cf_clearance/__cf_bm when the
    // pasted blob carries them (Grok's anti-bot and Cloudflare both need them).
    if (credentials.apiKey) {
      const cookieHeader = buildGrokCookieHeader(credentials.apiKey);
      if (cookieHeader) headers["Cookie"] = cookieHeader;
    }

    log?.info?.("GROK-WEB", `Query to ${model} (grok=${grokModel}, mode=${modelMode}), len=${message.length}`);

    let response;
    try {
      response = await grokTlsFetch(GROK_CHAT_API, {
        method: "POST", headers, body: JSON.stringify(grokPayload), timeoutMs: 120000, signal,
      });
    } catch (err) {
      if (err instanceof GrokTlsUnavailableError) {
        const errResp = new Response(JSON.stringify({
          error: { message: err.message, type: "configuration_error", code: "TLS_CLIENT_UNAVAILABLE" },
        }), { status: 503, headers: { "Content-Type": "application/json" } });
        return { response: errResp, url: GROK_CHAT_API, headers, transformedBody: grokPayload };
      }
      log?.error?.("GROK-WEB", `Fetch failed: ${err.message || String(err)}`);
      const errResp = new Response(JSON.stringify({
        error: { message: `Grok connection failed: ${err.message || String(err)}`, type: "upstream_error" },
      }), { status: 502, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: GROK_CHAT_API, headers, transformedBody: grokPayload };
    }

    if (!response.ok) {
      const status = response.status;
      let errMsg = `Grok returned HTTP ${status}`;
      if (isCloudflareChallenge(await response.clone().text().catch(() => ""))) {
        errMsg = "Grok returned a Cloudflare challenge — cf_clearance in the pasted Cookie header no longer matches this machine. Re-copy the full Cookie header from a logged-in grok.com browser on this machine.";
      } else if (status === 401 || status === 403) errMsg = "Grok auth failed — SSO cookie may be expired. Re-paste your sso cookie value from grok.com.";
      else if (status === 429) errMsg = "Grok rate limited. Wait a moment and retry, or rotate cookies.";
      log?.warn?.("GROK-WEB", errMsg);
      const errResp = new Response(JSON.stringify({
        error: { message: errMsg, type: "upstream_error", code: `HTTP_${status}` },
      }), { status, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: GROK_CHAT_API, headers, transformedBody: grokPayload };
    }

    if (!response.body) {
      const errResp = new Response(JSON.stringify({
        error: { message: "Grok returned empty response body", type: "upstream_error" },
      }), { status: 502, headers: { "Content-Type": "application/json" } });
      return { response: errResp, url: GROK_CHAT_API, headers, transformedBody: grokPayload };
    }

    const cid = `chatcmpl-grok-${crypto.randomUUID().slice(0, 12)}`;
    const created = Math.floor(Date.now() / 1000);

    let finalResponse;
    if (stream) {
      const sseStream = buildStreamingResponse(response.body, model, cid, created, isThinking, signal, toolRegistry);
      finalResponse = new Response(sseStream, {
        status: 200,
        headers: { ...SSE_HEADERS_NO_BUFFER },
      });
    } else {
      finalResponse = await buildNonStreamingResponse(response.body, model, cid, created, isThinking, signal, toolRegistry);
    }
    return { response: finalResponse, url: GROK_CHAT_API, headers, transformedBody: grokPayload };
  }

  /**
   * Media generation via conversations/new, through the Chrome-TLS client
   * (Cloudflare-gated against Node's fingerprint).
   * - image: enableImageGeneration turn; the final image arrives as a
   *   cardAttachment JSON-line chunk (progress 100, relative assets.grok.com
   *   path).
   * - video: Grok Imagine turn captured from grok.com/imagine — modelName
   *   "imagine-video-gen" + mediaGenInput.textToVideo; the mp4 asset URL is
   *   deep-scanned from the NDJSON reply (exact chunk shape varies).
   */
  async generateMedia({ prompt, kind = "image", size, duration, n = 1, credentials, signal, log }) {
    if (kind !== "image" && kind !== "video") throw new Error("Grok Web supports image and video generation only");
    if (!prompt?.trim()) throw new Error("prompt is required for media generation");
    // Video quota is ~1/day even on paid tiers — never loop video requests.
    const iterations = kind === "video" ? 1 : Math.max(1, n);

    const cookieHeader = buildGrokCookieHeader(String(credentials?.apiKey || ""));
    if (!cookieHeader) {
      throw new Error("Grok Web requires the grok.com Cookie header (sso) pasted into the connection");
    }

    const results = [];
    for (let i = 0; i < iterations; i++) {
      if (signal?.aborted) throw new Error("aborted");
      const requestId = crypto.randomUUID();
      const headers = {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        "User-Agent": GROK_TLS_USER_AGENT,
        "Sec-Ch-Ua": '"Chromium";v="146", "Not(A:Brand";v="24"',
        "Sec-Ch-Ua-Mobile": "?0",
        "Sec-Ch-Ua-Platform": '"macOS"',
        Origin: "https://grok.com",
        Referer: "https://grok.com/",
        "Browser-Id": requestId,
        "x-xai-request-id": requestId,
        "x-statsig-id": generateStatsigId(),
        Cookie: cookieHeader,
      };
      const payload = kind === "video"
        ? buildGrokVideoPayload({ prompt, size, duration })
        : {
          temporary: true,
          modelName: "grok-4-1-thinking-1129",
          modelMode: "MODEL_MODE_FAST",
          message: size ? `Generate an image (${size}): ${prompt}` : `Generate an image: ${prompt}`,
          fileAttachments: [],
          imageAttachments: [],
          disableSearch: false,
          enableImageGeneration: true,
          returnImageBytes: false,
          returnRawGrokInXaiRequest: false,
          enableImageStreaming: true,
          imageGenerationCount: 1,
          forceConcise: false,
          toolOverrides: {},
          enableSideBySide: true,
          sendFinalMetadata: true,
          isReasoning: false,
          disableTextFollowUps: false,
          disableMemory: true,
          forceSideBySide: false,
          isAsyncChat: false,
          disableSelfHarmShortCircuit: false,
          deviceEnvInfo: {
            darkModeEnabled: false, devicePixelRatio: 2,
            screenWidth: 2056, screenHeight: 1329, viewportWidth: 2056, viewportHeight: 1083,
          },
        };
      const res = await grokTlsFetch(GROK_CHAT_API, {
        method: "POST", headers, body: JSON.stringify(payload),
        timeoutMs: kind === "video" ? VIDEO_TURN_TIMEOUT_MS : IMAGE_TURN_TIMEOUT_MS, signal,
      });
      const text = await res.text();
      if (!res.ok || isCloudflareChallenge(text)) {
        throw new Error(
          isCloudflareChallenge(text)
            ? "Grok returned a Cloudflare challenge — re-copy the full Cookie header (with cf_clearance) from a logged-in grok.com browser on this machine"
            : `grok ${kind} request failed: HTTP ${res.status} ${text.slice(0, 200)}`
        );
      }
      if (kind === "video") {
        const videoUrl = findGrokVideoUrl(text);
        if (!videoUrl) {
          log?.warn?.("GROK-WEB", `no video URL in stream, tail: ${text.slice(-300)}`);
          throw new Error("grok returned no video asset — quota may be exhausted (1 video/day) or the prompt was moderated");
        }
        const dl = await grokTlsFetch(videoUrl.startsWith("http") ? videoUrl : `https://assets.grok.com/${videoUrl}`, {
          method: "GET",
          headers: { "User-Agent": GROK_TLS_USER_AGENT, Referer: "https://grok.com/", Cookie: cookieHeader },
          timeoutMs: 120000,
          signal,
        });
        if (!dl.ok) throw new Error(`video download failed: HTTP ${dl.status}`);
        const buf = Buffer.from(await dl.arrayBuffer());
        results.push({ b64: buf.toString("base64"), mime: "video/mp4" });
        break;
      }
      let finalChunk = null;
      for (const line of text.split("\n")) {
        if (!line.trim().startsWith("{")) continue;
        let outer;
        try { outer = JSON.parse(line); } catch { continue; }
        const card = outer?.result?.response?.cardAttachment?.jsonData;
        if (typeof card !== "string") continue;
        let inner;
        try { inner = JSON.parse(card); } catch { continue; }
        const chunk = inner?.image_chunk;
        if (chunk && Number(chunk.progress) >= 100 && chunk.imageUrl) finalChunk = chunk;
      }
      if (!finalChunk) {
        throw new Error("grok returned no completed image chunk — prompt may have been moderated or image generation is unavailable for this account");
      }
      const dl = await grokTlsFetch(`https://assets.grok.com/${finalChunk.imageUrl}`, {
        method: "GET",
        headers: { "User-Agent": GROK_TLS_USER_AGENT, Referer: "https://grok.com/", Cookie: cookieHeader },
        timeoutMs: 60000,
        signal,
      });
      if (!dl.ok) throw new Error(`image download failed: HTTP ${dl.status}`);
      const buf = Buffer.from(await dl.arrayBuffer());
      results.push({ b64: buf.toString("base64"), mime: finalChunk.mimeType || "image/jpeg" });
    }
    log?.info?.("GROK-WEB", `${kind} generation completed (${results.length} item(s))`);
    return results;
  }
}

export default GrokWebExecutor;
