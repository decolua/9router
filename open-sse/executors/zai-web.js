import { createHmac } from "node:crypto";
import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { SSE_DONE, SSE_HEADERS_NO_BUFFER } from "../utils/sseConstants.js";
import { sseChunk } from "../utils/sse.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { errorResponse } from "../utils/error.js";
import { estimateInputTokens, estimateOutputTokens } from "../utils/usageTracking.js";
import { zaiBrowserChat } from "../services/zaiBrowserTransport.js";

// Z.ai (chat.z.ai) web-chat reverse adapter.
//
// chat.z.ai is Zhipu's international consumer web app — NOT an OpenAI-compatible
// API. This executor bridges it (replaces the retired chatglm-cn provider).
//
// Transport selection (the OmniRoute PR #10329 architecture, verified live):
//   * Default — browser transport: chat.z.ai's v2 completion endpoint REQUIRES
//     a short-lived `captcha_verify_param` (Aliyun Captcha, bound to a browser
//     fingerprint). Every direct HTTP request without a valid proof returns a
//     generic HTTP 500 "Internal Server Error". So without a caller-supplied
//     proof we drive the real page with playwright-core
//     (open-sse/services/zaiBrowserTransport.js) and capture the SSE stream.
//   * Signed API — only when the caller supplies a proof (JSON credential
//     { token, captcha_verify_param } or providerSpecificData): resolve the
//     deployed FE version, create the chat via POST /api/v1/chats/new, then
//     POST /api/v2/chat/completions with the signed URL + X-Signature HMAC.
//
// Credential input (apiKey field): the raw Local Storage "token", a JSON
// credential { "token": "...", "captcha_verify_param": "..." }, "Bearer ...",
// "token=..." or a bare JWT.
//
// Protocol reference: OmniRoute open-sse/executors/zai-web (protocol.ts +
// stream.ts), audited in PR #10329. Signature algorithm, request shapes and
// SSE parsing are ported 1:1.

const CFG = PROVIDERS["zai-web"] || {};
const ZAI_BASE_URL = CFG.baseUrl || "https://chat.z.ai";
const ZAI_HOME_URL = `${ZAI_BASE_URL}/`;
const ZAI_NEW_CHAT_URL = `${ZAI_BASE_URL}/api/v1/chats/new`;
const ZAI_CHAT_URL = `${ZAI_BASE_URL}/api/v2/chat/completions`;

const ZAI_DEFAULT_MODEL = "GLM-5.3";
const ZAI_DEFAULT_FE_VERSION = "prod-fe-1.1.79";
const ZAI_FE_VERSION_CACHE_TTL_MS = 15 * 60 * 1000; // 15 min
const CLIENT_PROTOCOL_VERSION = "0.0.1";
// Reverse-engineered web-client signing key (public in the shipped browser JS).
const SIGNATURE_KEY = "key-@@@@)))()((9))-xxxx&&&%%%%%";
const ZAI_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36";

// In-process frontend-version cache (survives hot-reload via global).
const FE_VERSION_CACHE = (global._zaiWebFeVersionCache ??= { version: null, expiresAt: 0 });

// ── Model capabilities (verified against chat.z.ai/api/models, prod-fe-1.1.79) ──
const ZAI_MODEL_CAPABILITIES = {
  "glm-5.2": {
    mcp: true, reasoningEffort: true, returnFc: true, thinking: true,
    vision: false, vlmTools: false, vlmWebSearch: false, vlmWebsiteMode: false, webSearch: true,
  },
  "glm-5.1": {
    mcp: true, reasoningEffort: false, returnFc: true, thinking: true,
    vision: false, vlmTools: false, vlmWebSearch: false, vlmWebsiteMode: false, webSearch: true,
  },
  "glm-5-turbo": {
    mcp: true, reasoningEffort: false, returnFc: true, thinking: true,
    vision: false, vlmTools: false, vlmWebSearch: false, vlmWebsiteMode: false, webSearch: true,
  },
  "glm-5v-turbo": {
    mcp: false, reasoningEffort: false, returnFc: true, thinking: true,
    vision: true, vlmTools: true, vlmWebSearch: true, vlmWebsiteMode: true, webSearch: true,
  },
};
const NO_ZAI_MODEL_CAPABILITIES = Object.freeze({
  mcp: false, reasoningEffort: false, returnFc: false, thinking: false,
  vision: false, vlmTools: false, vlmWebSearch: false, vlmWebsiteMode: false, webSearch: false,
});

// ── Small helpers ────────────────────────────────────────────────────────

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function parseCredentialJson(raw) {
  if (!raw.trim().startsWith("{")) return null;
  try {
    return asRecord(JSON.parse(raw));
  } catch {
    return null;
  }
}

// Bound + sanitize an upstream error string before it lands in a client-facing
// message (mirrors OmniRoute's sanitizeErrorMessage usage).
function sanitizeErrorMessage(value) {
  return String(value || "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .slice(0, 500);
}

function unprefixedModelId(modelId) {
  const trimmed = String(modelId || "").trim();
  return trimmed.split("/").at(-1) || trimmed;
}

// ── Credential parsing (ported from protocol.ts extractZaiToken) ─────────
//
// Accepts: JSON {token|accessToken|access_token}, "Authorization: Bearer ...",
// "Bearer ...", a "token=..." cookie fragment, or a bare JWT.
export function extractZaiToken(rawCredential) {
  const trimmed = String(rawCredential ?? "").trim();
  const json = parseCredentialJson(trimmed);
  if (json) {
    const token = json.token ?? json.accessToken ?? json.access_token;
    return typeof token === "string" ? token.trim() : "";
  }
  const bearer = trimmed.match(/^(?:Authorization:\s*)?Bearer\s+(.+)$/i);
  if (bearer) return bearer[1].trim();
  const normalized = trimmed.replace(/^cookie:\s*/i, "").trim();
  if (!normalized) return "";
  const match = normalized.match(/(?:^|;\s*)token=([^;]+)/);
  if (match) return match[1].trim();
  return normalized.includes(";") || normalized.includes("=") ? "" : normalized;
}

// Read the short-lived browser CAPTCHA proof from supported input locations.
export function extractZaiCaptchaVerifyParam(value) {
  const record = asRecord(value);
  if (record) {
    const direct = record.captcha_verify_param ?? record.captchaVerifyParam ?? record.zaiCaptchaVerifyParam;
    if (typeof direct === "string" && direct.trim()) return direct.trim();
    const nested = asRecord(record.providerSpecificData);
    if (nested) return extractZaiCaptchaVerifyParam(nested);
    return "";
  }
  if (typeof value !== "string") return "";
  const json = parseCredentialJson(value);
  if (json) return extractZaiCaptchaVerifyParam(json);
  const match = value.match(/(?:^|;\s*)captcha_verify_param=([^;]+)/);
  return match?.[1]?.trim() ?? "";
}

// The z.ai token is a JWT whose payload carries the user id (sub-field "id").
export function extractZaiUserId(token) {
  const payload = String(token || "").split(".")[1];
  if (!payload) return "";
  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return typeof decoded?.id === "string" ? decoded.id : "";
  } catch {
    return "";
  }
}

// ── Signing (ported 1:1 from protocol.ts buildZaiSignature) ─────────────
//
// HMAC-SHA256 over `{sorted-entries}|{base64(prompt)}|{timestamp}`, keyed by
// HMAC-SHA256(SIGNATURE_KEY, 5-minute bucket). Verified against the live
// vector in tests/unit/zai-web-executor.test.js.
export function buildZaiSignature({ prompt, requestId, timestamp, userId }) {
  const ts = String(timestamp);
  const sortedPayload = Object.entries({ timestamp: ts, requestId, user_id: userId })
    .sort(([left], [right]) => left.localeCompare(right))
    .join(",");
  const encodedPrompt = Buffer.from(String(prompt), "utf8").toString("base64");
  const bucket = Math.floor(Number(ts) / (5 * 60 * 1000));
  const derivedKey = createHmac("sha256", SIGNATURE_KEY).update(String(bucket)).digest("hex");
  return createHmac("sha256", derivedKey).update(`${sortedPayload}|${encodedPrompt}|${ts}`).digest("hex");
}

// Extract the deployed frontend version from the homepage asset path.
export function parseZaiFrontendVersion(html) {
  return String(html || "").match(/\/frontend\/(prod-fe-\d+(?:\.\d+)*)\/assets\//)?.[1] ?? null;
}

async function resolveFrontendVersion(proxyOptions, signal) {
  const now = Date.now();
  if (FE_VERSION_CACHE.version && FE_VERSION_CACHE.expiresAt > now) return FE_VERSION_CACHE.version;
  let version = ZAI_DEFAULT_FE_VERSION;
  try {
    const res = await proxyAwareFetch(
      ZAI_HOME_URL,
      { headers: { Accept: "text/html", "User-Agent": ZAI_USER_AGENT }, signal },
      proxyOptions
    );
    if (res.ok) {
      const html = await res.text().catch(() => "");
      const parsed = parseZaiFrontendVersion(html);
      if (parsed) version = parsed;
    }
  } catch {
    /* keep the default version */
  }
  FE_VERSION_CACHE.version = version;
  FE_VERSION_CACHE.expiresAt = Date.now() + ZAI_FE_VERSION_CACHE_TTL_MS;
  return version;
}

// ── Message shaping (ported from protocol.ts) ────────────────────────────

function textContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((part) => {
      const record = asRecord(part);
      if (!record || (record.type !== "text" && record.type !== "input_text")) return [];
      const text = record.text ?? record.content;
      return typeof text === "string" ? [text] : [];
    })
    .join("\n");
}

export function latestUserPrompt(messages) {
  const list = Array.isArray(messages) ? messages : [];
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i]?.role !== "user") continue;
    return textContent(list[i].content);
  }
  return "";
}

// Fold multimodal content into plain text (image payloads are stripped — the
// direct path has no browser upload; VLM image input goes through the browser
// capture flow instead).
export function foldMessages(messages) {
  return (Array.isArray(messages) ? messages : []).map((msg) => ({
    role: msg.role,
    content: textContent(msg.content),
  }));
}

export function getZaiModelCapabilities(modelId) {
  return ZAI_MODEL_CAPABILITIES[unprefixedModelId(modelId).toLowerCase()] ?? NO_ZAI_MODEL_CAPABILITIES;
}

function getFeatureOption(body, key) {
  if (body[key] !== undefined) return body[key];
  return asRecord(body.features)?.[key];
}

// Resolve each model's Deep Think control; only GLM-5.2 accepts High/Max effort.
export function resolveZaiThinkingConfig(modelId, body) {
  const capabilities = getZaiModelCapabilities(modelId);
  const supported = capabilities.thinking;
  const reasoning = asRecord(body.reasoning);
  const rawEffort =
    typeof body.reasoning_effort === "string"
      ? body.reasoning_effort.trim().toLowerCase()
      : typeof reasoning?.effort === "string"
        ? reasoning.effort.trim().toLowerCase()
        : "";
  const disabled = body.enable_thinking === false || rawEffort === "none" || rawEffort === "off";
  const effort = rawEffort === "low" || rawEffort === "medium" || rawEffort === "high" ? "high" : "max";
  return { supported, enabled: supported && !disabled, effort, effortSupported: capabilities.reasoningEffort };
}

// Resolve GLM-5V-Turbo's visible Web Search and Tools controls.
export function resolveZaiVlmConfig(modelId, body) {
  const capabilities = getZaiModelCapabilities(modelId);
  const toolsOption = getFeatureOption(body, "vlm_tools_enable");
  const webSearchOption =
    getFeatureOption(body, "vlm_web_search_enable") ??
    getFeatureOption(body, "auto_web_search") ??
    getFeatureOption(body, "web_search");
  const webSearchEnabled = webSearchOption === true || (webSearchOption !== false && capabilities.vlmWebSearch);
  return {
    toolsEnabled: capabilities.vlmTools && toolsOption !== false,
    webSearchEnabled: capabilities.webSearch && webSearchEnabled,
    websiteModeEnabled: capabilities.vlmWebsiteMode,
  };
}

function buildZaiHeaders(token, { accept, frontendVersion, signature }) {
  const headers = {
    "Content-Type": "application/json",
    Accept: accept,
    "Accept-Language": "en-US",
    "User-Agent": ZAI_USER_AGENT,
    Origin: ZAI_BASE_URL,
    Referer: `${ZAI_BASE_URL}/`,
    Authorization: `Bearer ${token}`,
  };
  if (frontendVersion) headers["X-FE-Version"] = frontendVersion;
  if (signature) headers["X-Signature"] = signature;
  return headers;
}

function buildZaiCompletionUrl({ requestId, timestamp, token, userId }) {
  const now = new Date(timestamp);
  const params = new URLSearchParams({
    timestamp: String(timestamp),
    requestId,
    user_id: userId,
    version: CLIENT_PROTOCOL_VERSION,
    platform: "web",
    token,
    user_agent: ZAI_USER_AGENT,
    language: "en-US",
    languages: "en-US,en",
    timezone: "UTC",
    cookie_enabled: "true",
    screen_width: "1280",
    screen_height: "800",
    screen_resolution: "1280x800",
    viewport_height: "800",
    viewport_width: "1280",
    viewport_size: "1280x800",
    color_depth: "24",
    pixel_ratio: "1",
    current_url: `${ZAI_BASE_URL}/`,
    pathname: "/",
    search: "",
    hash: "",
    host: "chat.z.ai",
    hostname: "chat.z.ai",
    protocol: "https:",
    referrer: "",
    title: "Z.ai - Advanced AI Chatbot & Agent powered by GLM-5.2",
    timezone_offset: "0",
    local_time: now.toISOString(),
    utc_time: now.toUTCString(),
    is_mobile: "false",
    is_touch: "false",
    max_touch_points: "0",
    browser_name: "Chrome",
    os_name: "Mac OS",
    signature_timestamp: String(timestamp),
  });
  return `${ZAI_CHAT_URL}?${params.toString()}`;
}

function buildZaiNewChatBody(messages, modelId, enableThinking, reasoningEffort, vlmConfig) {
  const prompt = latestUserPrompt(messages);
  const userMessageId = crypto.randomUUID();
  return {
    userMessageId,
    payload: {
      chat: {
        id: "",
        title: "New Chat",
        models: [modelId],
        params: {},
        history: {
          messages: {
            [userMessageId]: {
              id: userMessageId,
              parentId: null,
              childrenIds: [],
              role: "user",
              content: prompt,
              timestamp: Math.floor(Date.now() / 1000),
              models: [modelId],
            },
          },
          currentId: userMessageId,
        },
        tags: [],
        flags: [],
        features: [{ server: "tool_selector_h", status: "hidden", type: "tool_selector" }],
        mcp_servers: [],
        enable_thinking: enableThinking,
        reasoning_effort: reasoningEffort,
        auto_web_search: vlmConfig.webSearchEnabled,
        message_version: 1,
        extra: {
          vlm_tools_enable: vlmConfig.toolsEnabled,
          vlm_web_search_enable: vlmConfig.websiteModeEnabled && vlmConfig.webSearchEnabled,
          vlm_website_mode: vlmConfig.websiteModeEnabled,
        },
        timestamp: Date.now(),
        type: "default",
      },
    },
  };
}

function buildZaiRequestBody({
  body, captchaVerifyParam, chatId, messages, modelId, prompt, userMessageId,
  enableThinking, reasoningEffort, reasoningEffortSupported, vlmConfig,
}) {
  const params = Object.fromEntries(
    ["temperature", "top_p", "max_tokens", "stop"]
      .filter((key) => body[key] !== undefined)
      .map((key) => [key, body[key]])
  );
  const features = {
    image_generation: false,
    web_search: false,
    auto_web_search: vlmConfig.websiteModeEnabled ? false : vlmConfig.webSearchEnabled,
    preview_mode: true,
    flags: [],
    vlm_tools_enable: vlmConfig.toolsEnabled,
    vlm_web_search_enable: vlmConfig.websiteModeEnabled && vlmConfig.webSearchEnabled,
    vlm_website_mode: vlmConfig.websiteModeEnabled,
    enable_thinking: enableThinking,
  };
  if (enableThinking && reasoningEffortSupported) {
    features.reasoning_effort = reasoningEffort;
  }
  return {
    stream: true,
    model: modelId,
    messages: foldMessages(messages),
    signature_prompt: prompt,
    params,
    extra: {
      vlm_tools_enable: vlmConfig.toolsEnabled,
      vlm_web_search_enable: vlmConfig.websiteModeEnabled && vlmConfig.webSearchEnabled,
      vlm_website_mode: vlmConfig.websiteModeEnabled,
    },
    features,
    variables: {},
    chat_id: chatId,
    id: crypto.randomUUID(),
    current_user_message_id: userMessageId,
    current_user_message_parent_id: null,
    background_tasks: { title_generation: true, tags_generation: true },
    captcha_verify_param: captchaVerifyParam,
  };
}

// ── SSE frame parsing (ported 1:1 from stream.ts parseZaiFrame) ──────────
//
// z.ai answers some failures with HTTP 200 + an error payload in the SSE body
// (rejected signature, expired captcha, stale token). Those frames carry no
// delta but must NOT be dropped as a benign phase frame — only an *explicit*
// error field counts.
function readFrameError(frame) {
  const data = asRecord(frame.data) ?? {};
  const raw = frame.error ?? data.error;
  if (raw == null) return null;
  if (typeof raw === "string") return sanitizeErrorMessage(raw) || "upstream error";
  if (typeof raw === "object") {
    const rec = raw;
    const message = rec.detail ?? rec.message ?? rec.msg;
    if (typeof message === "string" && message) return sanitizeErrorMessage(message);
    return sanitizeErrorMessage(JSON.stringify(raw));
  }
  return sanitizeErrorMessage(String(raw));
}

export function parseZaiFrame(raw) {
  if (!raw || typeof raw !== "object") return null;
  const frame = raw;
  const error = readFrameError(frame);
  if (error) return { content: "", reasoning: "", done: true, error };

  const choices = frame.choices;
  if (Array.isArray(choices) && choices.length > 0) {
    const delta = asRecord(choices[0]?.delta) ?? {};
    const finishReason = choices[0]?.finish_reason;
    return {
      content: typeof delta.content === "string" ? delta.content : "",
      reasoning: typeof delta.reasoning_content === "string" ? delta.reasoning_content : "",
      done: finishReason != null,
    };
  }

  const data = asRecord(frame.data) ?? frame;
  const phase = String(data.phase ?? "");
  const deltaContent = data.delta_content ?? data.edit_content ?? data.content;
  const done =
    data.done === true ||
    phase === "done" ||
    phase === "finish" ||
    String(frame.type ?? "") === "chat:completion:finish";
  if (typeof deltaContent === "string" && deltaContent) {
    const isThinking = phase === "thinking";
    return {
      content: isThinking ? "" : deltaContent,
      reasoning: isThinking ? deltaContent : "",
      done,
    };
  }
  if (done) return { content: "", reasoning: "", done: true };
  return null;
}

// ── SSE → OpenAI streaming transform ─────────────────────────────────────

function transformZaiStream(sourceBody, model, signal, estimatedPromptTokens = 0) {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const id = `chatcmpl-zai-${crypto.randomUUID().slice(0, 12)}`;
  const created = Math.floor(Date.now() / 1000);
  const streamModel = model || ZAI_DEFAULT_MODEL;
  let emittedRole = false;
  let finished = false;
  let totalChars = 0;

  const push = (deltaObj, finishReason = null, usage = null) => {
    const chunkObj = {
      id,
      object: "chat.completion.chunk",
      created,
      model: streamModel,
      choices: [{ index: 0, delta: deltaObj, finish_reason: finishReason, logprobs: null }],
    };
    if (usage) chunkObj.usage = usage;
    return encoder.encode(sseChunk(chunkObj));
  };

  const finishStream = (controller) => {
    if (finished) return;
    finished = true;
    if (!emittedRole) {
      emittedRole = true;
      controller.enqueue(push({ role: "assistant", content: "" }));
    }
    const completionTokens = estimateOutputTokens(totalChars);
    const finalUsage = {
      prompt_tokens: estimatedPromptTokens,
      completion_tokens: completionTokens,
      total_tokens: estimatedPromptTokens + completionTokens,
    };
    controller.enqueue(push({}, "stop", finalUsage));
    controller.enqueue(encoder.encode(SSE_DONE));
    try { controller.close(); } catch { /* already closed */ }
  };

  return new ReadableStream({
    async start(controller) {
      const reader = sourceBody.getReader();
      let buffer = "";
      try {
        while (true) {
          if (signal?.aborted) break;
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (!payload || payload === "[DONE]") continue;
            let frame;
            try { frame = JSON.parse(payload); } catch { continue; }
            const delta = parseZaiFrame(frame);
            if (!delta) continue;
            if (delta.error) {
              if (!emittedRole) {
                emittedRole = true;
                controller.enqueue(push({ role: "assistant", content: "" }));
              }
              // Surfaced as visible content, matching the other web executors'
              // mid-stream error convention: the 200 is already on the wire.
              controller.enqueue(push({ content: `[Z.ai error] ${delta.error}` }));
              controller.enqueue(push({}, "stop"));
              controller.enqueue(encoder.encode(SSE_DONE));
              try { controller.close(); } catch { /* */ }
              return;
            }
            if (!emittedRole && (delta.content || delta.reasoning)) {
              emittedRole = true;
              controller.enqueue(push({ role: "assistant", content: "" }));
            }
            if (delta.reasoning) {
              totalChars += delta.reasoning.length;
              controller.enqueue(push({ reasoning_content: delta.reasoning }));
            }
            if (delta.content) {
              totalChars += delta.content.length;
              controller.enqueue(push({ content: delta.content }));
            }
            if (delta.done) {
              finishStream(controller);
              return;
            }
          }
        }
        finishStream(controller);
      } catch (err) {
        if (!signal?.aborted) {
          try {
            if (!emittedRole) controller.enqueue(push({ role: "assistant", content: "" }));
            controller.enqueue(push({ content: `\n[Z.ai stream error: ${err?.message || String(err)}]` }, "stop"));
            controller.enqueue(encoder.encode(SSE_DONE));
          } catch { /* controller already closed */ }
        } else {
          finishStream(controller);
        }
      } finally {
        try { controller.close(); } catch { /* already closed */ }
        try { reader.releaseLock(); } catch { /* */ }
      }
    },
  });
}

// ── Non-streaming SSE aggregator ─────────────────────────────────────────

async function collectZaiContent(sourceBody, signal) {
  const decoder = new TextDecoder();
  const reader = sourceBody.getReader();
  let buffer = "";
  let content = "";
  let reasoning = "";
  try {
    while (true) {
      if (signal?.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        let frame;
        try { frame = JSON.parse(payload); } catch { continue; }
        const delta = parseZaiFrame(frame);
        if (!delta) continue;
        // An error frame (rejected signature, expired captcha) must fail the
        // request, not produce an empty success.
        if (delta.error) throw new Error(delta.error);
        if (delta.reasoning) reasoning += delta.reasoning;
        if (delta.content) content += delta.content;
        if (delta.done) break;
      }
    }
  } finally {
    try { reader.releaseLock(); } catch { /* */ }
  }
  return { content, reasoning };
}

// z.ai's SSE does not carry token counts — estimate from the request body and
// the assembled output (same convention as the other web executors). Shared by
// the signed-API and browser transports.
function nonStreamingZaiCompletion({ bodyObj, modelId, content, reasoning, url, headers, transformedBody }) {
  const outputLen = content.length + reasoning.length;
  const promptTokens = estimateInputTokens(bodyObj);
  const completionTokens = estimateOutputTokens(outputLen);
  const message = { role: "assistant", content: content || "[Z.ai returned no content]" };
  if (reasoning) message.reasoning_content = reasoning;
  const openaiResponse = {
    id: `chatcmpl-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: modelId,
    choices: [{ index: 0, message, finish_reason: "stop", logprobs: null }],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
      estimated: true,
    },
  };
  return {
    response: new Response(JSON.stringify(openaiResponse), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
    url,
    headers,
    transformedBody,
  };
}

// ── Executor ─────────────────────────────────────────────────────────────

export class ZaiWebExecutor extends BaseExecutor {
  constructor() {
    super("zai-web", CFG);
  }

  async execute({ model, body, stream, credentials, signal, log, proxyOptions }) {
    const bodyObj = body || {};
    const messages = Array.isArray(bodyObj.messages) ? bodyObj.messages : [];
    if (messages.length === 0) {
      return {
        response: errorResponse(400, "Missing or empty messages array.", "INVALID_REQUEST"),
        url: ZAI_CHAT_URL,
        headers: {},
        transformedBody: body,
      };
    }

    const raw = credentials?.apiKey || credentials?.accessToken || "";
    const token = extractZaiToken(raw);
    if (!token) {
      return {
        response: errorResponse(
          400,
          'Invalid Z.ai web-session credential — copy the "token" value from chat.z.ai Local Storage.',
          "NO_CREDENTIAL"
        ),
        url: ZAI_CHAT_URL,
        headers: {},
        transformedBody: body,
      };
    }

    const modelId = typeof model === "string" && model.trim() ? model.trim() : ZAI_DEFAULT_MODEL;
    const capabilities = getZaiModelCapabilities(modelId);

    // Only GLM-5V-Turbo accepts images; the direct path folds them to text anyway.
    const hasImages = messages.some(
      (m) => Array.isArray(m.content) && m.content.some((c) => c?.type === "image_url")
    );
    if (hasImages && !capabilities.vision) {
      return {
        response: errorResponse(
          400,
          "Image input is only supported on GLM-5V-Turbo for Z.ai web.",
          "UNSUPPORTED_IMAGE"
        ),
        url: ZAI_CHAT_URL,
        headers: {},
        transformedBody: body,
      };
    }

    const thinking = resolveZaiThinkingConfig(modelId, bodyObj);
    const vlm = resolveZaiVlmConfig(modelId, bodyObj);

    // chat.z.ai's v2 completion endpoint rejects every direct HTTP request
    // without a valid Aliyun CAPTCHA proof (generic HTTP 500 — verified live).
    // The browser transport is the default; the signed API is only reachable
    // when the caller supplies a proof.
    const captchaVerifyParam =
      extractZaiCaptchaVerifyParam(raw) ||
      extractZaiCaptchaVerifyParam(credentials?.providerSpecificData) ||
      "";

    if (!captchaVerifyParam) {
      if (process.env.ER_ZAI_BROWSER === "off") {
        return {
          response: errorResponse(
            400,
            'Z.ai chat needs a CAPTCHA proof or the browser transport — supply "captcha_verify_param" in the credential JSON, or unset ER_ZAI_BROWSER.',
            "CAPTCHA_REQUIRED"
          ),
          url: ZAI_CHAT_URL,
          headers: {},
          transformedBody: body,
        };
      }
      return this.executeViaBrowser({
        body,
        bodyObj,
        modelId,
        messages,
        stream,
        token,
        thinking,
        vlm,
        signal,
        log,
      });
    }

    try {
      const frontendVersion = await resolveFrontendVersion(proxyOptions, signal);
      const userId = extractZaiUserId(token);
      const requestId = crypto.randomUUID();
      const timestamp = Date.now();
      const prompt = latestUserPrompt(messages);
      const signature = buildZaiSignature({ prompt, requestId, timestamp, userId });
      log?.info?.("ZAI-WEB", `model=${modelId}, thinking=${thinking.enabled}, effort=${thinking.effort}, vlm=${JSON.stringify(vlm)}`);

      // 1. Create the chat (the completion attaches to it).
      const newChat = buildZaiNewChatBody(messages, modelId, thinking.enabled, thinking.effort, vlm);
      const newChatRes = await proxyAwareFetch(
        ZAI_NEW_CHAT_URL,
        {
          method: "POST",
          headers: buildZaiHeaders(token, { accept: "application/json, text/plain, */*", frontendVersion }),
          body: JSON.stringify(newChat.payload),
          signal,
        },
        proxyOptions
      );
      if (!newChatRes.ok) {
        const status = newChatRes.status;
        const msg =
          status === 401 || status === 403
            ? 'Z.ai token invalid or expired — copy a fresh "token" from chat.z.ai Local Storage.'
            : `Z.ai new-chat failed (HTTP ${status})`;
        log?.warn?.("ZAI-WEB", msg);
        return {
          response: errorResponse(status, msg, `HTTP_${status}`),
          url: ZAI_NEW_CHAT_URL,
          headers: {},
          transformedBody: body,
        };
      }
      const chatJson = await newChatRes.json().catch(() => ({}));
      const chatId = String(chatJson?.id ?? chatJson?.chat?.id ?? chatJson?.chat_id ?? "");

      // 2. Signed v2 completion (a valid captcha_verify_param is guaranteed here).
      const completionBody = buildZaiRequestBody({
        body: bodyObj,
        captchaVerifyParam,
        chatId,
        messages,
        modelId,
        prompt,
        userMessageId: newChat.userMessageId,
        enableThinking: thinking.enabled,
        reasoningEffort: thinking.effort,
        reasoningEffortSupported: thinking.effortSupported,
        vlmConfig: vlm,
      });
      const completionUrl = buildZaiCompletionUrl({ requestId, timestamp, token, userId });
      const headers = buildZaiHeaders(token, {
        accept: stream === false ? "application/json" : "text/event-stream",
        frontendVersion,
        signature,
      });

      log?.info?.("ZAI-WEB", `POST ${completionUrl}`);
      const res = await proxyAwareFetch(
        completionUrl,
        { method: "POST", headers, body: JSON.stringify(completionBody), signal },
        proxyOptions
      );
      log?.info?.("ZAI-WEB", `Completion response status=${res.status}`);

      if (!res.ok) {
        const status = res.status;
        const msg =
          status === 401 || status === 403
            ? 'Z.ai token invalid or expired — copy a fresh "token" from chat.z.ai Local Storage.'
            : status === 429
              ? "Z.ai rate limited — wait and retry."
              : `Z.ai request failed (HTTP ${status})`;
        log?.warn?.("ZAI-WEB", msg);
        return { response: errorResponse(status, msg, `HTTP_${status}`), url: completionUrl, headers, transformedBody: completionBody };
      }

      if (stream !== false) {
        return {
          response: new Response(transformZaiStream(res.body, modelId, signal, estimateInputTokens(body)), {
            status: 200,
            headers: { ...SSE_HEADERS_NO_BUFFER },
          }),
          url: completionUrl,
          headers,
          transformedBody: completionBody,
        };
      }

      const { content, reasoning } = await collectZaiContent(res.body, signal);
      return nonStreamingZaiCompletion({ bodyObj, modelId, content, reasoning, url: completionUrl, headers, transformedBody: completionBody });
    } catch (err) {
      const aborted = err?.name === "AbortError";
      const msg = err instanceof Error ? err.message : String(err);
      log?.error?.("ZAI-WEB", `Execute failed: ${msg}`);
      if (aborted) {
        return { response: errorResponse(499, "Request cancelled"), url: ZAI_CHAT_URL, headers: {}, transformedBody: body };
      }
      return { response: errorResponse(502, `Z.ai error: ${msg}`), url: ZAI_CHAT_URL, headers: {}, transformedBody: body };
    }
  }

  // Browser transport — drives the real chat.z.ai page (solving the Aliyun
  // CAPTCHA natively) and feeds the captured SSE into the same parsers as the
  // signed-API path.
  async executeViaBrowser({ body, bodyObj, modelId, messages, stream, token, thinking, vlm, signal, log }) {
    const prompt = latestUserPrompt(messages);
    if (!prompt) {
      return {
        response: errorResponse(400, "Z.ai requires at least one user message.", "INVALID_REQUEST"),
        url: ZAI_CHAT_URL,
        headers: {},
        transformedBody: body,
      };
    }
    const capabilities = getZaiModelCapabilities(modelId);

    log?.info?.(
      "ZAI-WEB",
      `browser transport (model=${modelId}, thinking=${thinking.enabled}, effort=${thinking.effort}, vlm=${JSON.stringify(vlm)})`
    );
    let result;
    try {
      result = await zaiBrowserChat({ token, modelId, prompt, thinking, vlm, capabilities, signal, log });
    } catch (err) {
      const aborted = err?.name === "AbortError";
      const msg = err instanceof Error ? err.message : String(err);
      log?.error?.("ZAI-WEB", `Browser transport failed: ${msg}`);
      if (aborted) {
        return { response: errorResponse(499, "Request cancelled"), url: ZAI_CHAT_URL, headers: {}, transformedBody: body };
      }
      return {
        response: errorResponse(502, `Z.ai browser transport error: ${msg}`, "BROWSER_TRANSPORT_ERROR"),
        url: ZAI_CHAT_URL,
        headers: {},
        transformedBody: body,
      };
    }

    if (!result.ok) {
      log?.warn?.("ZAI-WEB", result.error);
      return {
        response: errorResponse(502, `Z.ai browser transport failed: ${result.error}`, "BROWSER_TRANSPORT_ERROR"),
        url: ZAI_CHAT_URL,
        headers: {},
        transformedBody: body,
      };
    }

    if (result.status < 200 || result.status >= 300) {
      const status = result.status;
      const msg =
        status === 401 || status === 403
          ? 'Z.ai session invalid — re-capture the "token" from chat.z.ai Local Storage.'
          : `Z.ai browser request failed (HTTP ${status})`;
      log?.warn?.("ZAI-WEB", msg);
      return {
        response: errorResponse(status, msg, `HTTP_${status}`),
        url: ZAI_CHAT_URL,
        headers: {},
        transformedBody: body,
      };
    }

    const upstream = new Response(result.body, {
      status: 200,
      headers: { "Content-Type": result.contentType || "text/event-stream" },
    });

    if (stream !== false) {
      return {
        response: new Response(transformZaiStream(upstream.body, modelId, signal, estimateInputTokens(body)), {
          status: 200,
          headers: { ...SSE_HEADERS_NO_BUFFER },
        }),
        url: ZAI_CHAT_URL,
        headers: {},
        transformedBody: body,
      };
    }

    const { content, reasoning } = await collectZaiContent(upstream.body, signal);
    return nonStreamingZaiCompletion({ bodyObj, modelId, content, reasoning, url: ZAI_CHAT_URL, headers: {}, transformedBody: body });
  }
}

export default ZaiWebExecutor;
