import { handleChat } from "@/sse/handlers/chat.js";
import { initTranslators } from "open-sse/translator/index.js";

let initialized = false;

function parseToolArguments(args) {
  if (!args) return {};
  if (typeof args === "object") return args;
  if (typeof args !== "string") return {};
  try {
    const parsed = JSON.parse(args);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function openAIToClaudeJson(body) {
  if (!body?.choices?.[0]) return body;

  const choice = body.choices[0] || {};
  const message = choice.message || {};
  const content = [];

  if (typeof message.reasoning_content === "string" && message.reasoning_content.length > 0) {
    content.push({ type: "thinking", thinking: message.reasoning_content });
  }
  if (typeof message.content === "string") {
    content.push({ type: "text", text: message.content });
  }
  if (Array.isArray(message.tool_calls)) {
    for (const tc of message.tool_calls) {
      content.push({
        type: "tool_use",
        id: tc.id || `toolu_${Date.now()}`,
        name: tc.function?.name || "unknown_tool",
        input: parseToolArguments(tc.function?.arguments),
      });
    }
  }
  if (content.length === 0) {
    content.push({ type: "text", text: "" });
  }

  const promptTokens = typeof body.usage?.prompt_tokens === "number" ? body.usage.prompt_tokens : 0;
  const completionTokens = typeof body.usage?.completion_tokens === "number" ? body.usage.completion_tokens : 0;
  const cacheRead = typeof body.usage?.prompt_tokens_details?.cached_tokens === "number" ? body.usage.prompt_tokens_details.cached_tokens : 0;
  const cacheCreate = typeof body.usage?.prompt_tokens_details?.cache_creation_tokens === "number" ? body.usage.prompt_tokens_details.cache_creation_tokens : 0;

  const finishReason = choice.finish_reason === "tool_calls"
    ? "tool_use"
    : choice.finish_reason === "length"
      ? "max_tokens"
      : "end_turn";

  const rawId = typeof body.id === "string" ? body.id.replace(/^chatcmpl-/, "") : `msg_${Date.now()}`;
  const id = rawId.startsWith("msg_") ? rawId : `msg_${rawId}`;

  const usage = {
    input_tokens: Math.max(0, promptTokens - cacheRead - cacheCreate),
    output_tokens: completionTokens,
  };
  if (cacheRead > 0) usage.cache_read_input_tokens = cacheRead;
  if (cacheCreate > 0) usage.cache_creation_input_tokens = cacheCreate;

  return {
    id,
    type: "message",
    role: "assistant",
    model: body.model || "unknown",
    content,
    stop_reason: finishReason,
    stop_sequence: null,
    usage,
  };
}

async function ensureAnthropicJsonResponse(response) {
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) return response;

  let body;
  try {
    body = await response.clone().json();
  } catch {
    return response;
  }

  // Already correct Anthropic format (success message)
  if (body?.type === "message" && Array.isArray(body?.content)) {
    return response;
  }

  // Already correct Anthropic error format
  if (body?.type === "error" && body?.error) {
    return response;
  }

  // OpenAI success format -> Anthropic
  if (Array.isArray(body?.choices)) {
    const normalized = openAIToClaudeJson(body);
    return new Response(JSON.stringify(normalized), {
      status: response.status,
      headers: response.headers,
    });
  }

  // Any error response (non-2xx or has error field) -> normalize to Anthropic error format
  if (response.status >= 400 || body?.error) {
    const message = typeof body?.error === "string"
      ? body.error
      : body?.error?.message || body?.message || `Upstream error: ${response.status}`;

    const errorTypeMap = {
      401: "authentication_error",
      403: "permission_error",
      404: "not_found_error",
      429: "rate_limit_error",
    };
    const errorType = body?.error?.type
      || errorTypeMap[response.status]
      || (response.status >= 500 ? "api_error" : "invalid_request_error");

    const normalized = {
      type: "error",
      error: { type: errorType, message }
    };
    return new Response(JSON.stringify(normalized), {
      status: response.status,
      headers: response.headers,
    });
  }

  return response;
}

/**
 * Initialize translators once
 */
async function ensureInitialized() {
  if (!initialized) {
    await initTranslators();
    initialized = true;
    console.log("[SSE] Translators initialized for /v1/messages");
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
 * POST /v1/messages - Claude/Anthropic format endpoint
 * Forces sourceFormat to "claude" so responses are always in Claude format
 */
export async function POST(request) {
  await ensureInitialized();
  const response = await handleChat(request, null, "claude");
  return ensureAnthropicJsonResponse(response);
}

