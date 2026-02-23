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

  // Already anthropic format
  if (body?.type === "message" && Array.isArray(body?.content)) {
    return response;
  }

  // OpenAI fallback -> Anthropic
  if (Array.isArray(body?.choices)) {
    const normalized = openAIToClaudeJson(body);
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

