import { FORMATS } from "../../translator/formats.js";
import { needsTranslation } from "../../translator/index.js";
import { ollamaBodyToOpenAI } from "../../translator/response/ollama-to-openai.js";
import { addBufferToUsage, filterUsageForFormat } from "../../utils/usageTracking.js";
import { createErrorResult } from "../../utils/error.js";
import { HTTP_STATUS } from "../../config/runtimeConfig.js";
import { parseSSEToOpenAIResponse } from "./sseToJsonHandler.js";
import { buildRequestDetail, extractRequestConfig, extractUsageFromResponse, saveUsageStats } from "./requestDetail.js";
import { appendRequestLog, saveRequestDetail } from "@/lib/usageDb.js";
import { decloakToolNames } from "../../utils/claudeCloaking.js";

const DIAGNOSTIC_SNIPPET_MAX = 200;
const SSE_FALLBACK_SAMPLE_LINES = 24;
const SENSITIVE_DIAGNOSTIC_KEYS = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "api-key",
  "access-token",
  "refresh-token",
  "token",
  "secret",
  "password",
  "prompt",
  "input",
  "content",
  "text",
  "message",
  "messages",
]);
const SENSITIVE_DIAGNOSTIC_KEY_SEGMENTS = new Set(["token", "key", "secret", "password"]);
const QUOTED_SENSITIVE_DIAGNOSTIC_PAIR_RE = /("(?:authorization|cookie|set(?:[-_ ]|)cookie|x(?:[-_ ]|)api(?:[-_ ]|)key|api(?:[-_ ]|)key|access(?:[-_ ]|)token|refresh(?:[-_ ]|)token|token|secret|password|prompt|input|content|text|messages?)")(\s*:\s*)"((?:\\.|[^"\\])*)(?:"|(?=[,}\]]|$))/gi;

function stripUtf8Bom(text) {
  return typeof text === "string" && text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
}

function canonicalizeDiagnosticKey(key) {
  return String(key || "")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-");
}

function isSensitiveDiagnosticKey(key) {
  if (SENSITIVE_DIAGNOSTIC_KEYS.has(key)) return true;
  return key.split("-").some((segment) => SENSITIVE_DIAGNOSTIC_KEY_SEGMENTS.has(segment));
}

function consumeJsonString(text, quoteStart) {
  let i = quoteStart + 1;
  while (i < text.length) {
    const char = text[i];
    if (char === "\\") {
      i += 2;
      continue;
    }
    if (char === '"') return { end: i + 1, closed: true };
    i += 1;
  }
  return { end: text.length, closed: false };
}

function consumeBracketedJsonValue(text, start) {
  const stack = [text[start]];
  let i = start + 1;

  while (i < text.length) {
    const char = text[i];
    if (char === '"') {
      const str = consumeJsonString(text, i);
      i = str.end;
      continue;
    }
    if (char === "{" || char === "[") stack.push(char);
    else if (char === "}" || char === "]") {
      const open = stack[stack.length - 1];
      if ((open === "{" && char === "}") || (open === "[" && char === "]")) {
        stack.pop();
        if (stack.length === 0) return i + 1;
      }
    }
    i += 1;
  }

  return text.length;
}

function consumeJsonScalar(text, start) {
  let i = start;
  while (i < text.length && !/[\],}]/.test(text[i])) i += 1;
  return i;
}

function consumeSensitiveJsonValue(text, start) {
  const first = text[start];
  if (!first) return { end: start, replacement: '[REDACTED]' };
  if (first === '"') {
    const str = consumeJsonString(text, start);
    return { end: str.end, replacement: '"[REDACTED]"' };
  }
  if (first === "{" || first === "[") {
    return { end: consumeBracketedJsonValue(text, start), replacement: '[REDACTED]' };
  }
  return { end: consumeJsonScalar(text, start), replacement: '[REDACTED]' };
}

function redactQuotedSensitiveDiagnosticFields(text) {
  return text.replace(QUOTED_SENSITIVE_DIAGNOSTIC_PAIR_RE, (_, quotedKey, separator) => `${quotedKey}${separator}"[REDACTED]"`);
}

function redactJsonLikeDiagnosticFields(text) {
  let redacted = "";
  let lastIndex = 0;
  let i = 0;

  while (i < text.length) {
    if (text[i] !== '"') {
      i += 1;
      continue;
    }

    const key = consumeJsonString(text, i);
    if (!key.closed) break;

    let cursor = key.end;
    while (cursor < text.length && /\s/.test(text[cursor])) cursor += 1;
    if (cursor >= text.length || text[cursor] !== ":") {
      i = key.end;
      continue;
    }

    const canonicalKey = canonicalizeDiagnosticKey(text.slice(i + 1, key.end - 1));
    cursor += 1;
    while (cursor < text.length && /\s/.test(text[cursor])) cursor += 1;

    if (!isSensitiveDiagnosticKey(canonicalKey)) {
      i = cursor;
      continue;
    }

    const value = consumeSensitiveJsonValue(text, cursor);
    redacted += text.slice(lastIndex, cursor) + value.replacement;
    lastIndex = value.end;
    i = value.end;
  }

  return redactQuotedSensitiveDiagnosticFields(redacted + text.slice(lastIndex));
}

function looksLikeChatCompletionsSSE(rawText) {
  const lines = String(rawText || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, SSE_FALLBACK_SAMPLE_LINES);

  if (lines.length === 0) return false;

  const allowedPrefixes = ["data:", "event:", "id:", "retry:", ":"];
  if (lines.some((line) => !allowedPrefixes.some((prefix) => line.startsWith(prefix)))) return false;

  const dataLines = lines.filter((line) => line.startsWith("data:"));
  if (dataLines.length === 0) return false;

  return dataLines.some((line) => {
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") return false;

    try {
      const parsed = JSON.parse(payload);
      const choice = parsed?.choices?.[0];
      return !!choice && typeof choice === "object" && (
        Object.prototype.hasOwnProperty.call(choice, "delta") ||
        Object.prototype.hasOwnProperty.call(choice, "message") ||
        Object.prototype.hasOwnProperty.call(choice, "finish_reason")
      );
    } catch {
      return false;
    }
  });
}

function buildSafeDiagnosticSnippet(rawText) {
  const normalized = String(rawText || "")
    .replace(/\r/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const source = normalized || String(rawText || "");
  const redactedSource = redactJsonLikeDiagnosticFields(source)
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [REDACTED]")
    .replace(/((?:^|[\s,{])(?:authorization|cookie|set-cookie|x-api-key|api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|token|secret|password)\s*[:=]\s*)([^\s,;}\]]+)/gi, "$1[REDACTED]")
    .replace(/((?:^|[\s,{])(?:prompt|input|content|text|message)\s*[:=]\s*)([^,;}\]]+)/gi, "$1[REDACTED]");

  const snippet = redactedSource.slice(0, DIAGNOSTIC_SNIPPET_MAX);
  const trailingNote = source.length > DIAGNOSTIC_SNIPPET_MAX
    ? ` …[+${source.length - DIAGNOSTIC_SNIPPET_MAX} chars truncated]`
    : "";

  return { snippet, trailingNote };
}

/**
 * Translate non-streaming response body from provider format → OpenAI format.
 */
export function translateNonStreamingResponse(responseBody, targetFormat, sourceFormat) {
  if (targetFormat === sourceFormat || targetFormat === FORMATS.OPENAI) return responseBody;

  // Gemini / Antigravity
  if (targetFormat === FORMATS.GEMINI || targetFormat === FORMATS.ANTIGRAVITY || targetFormat === FORMATS.GEMINI_CLI || targetFormat === FORMATS.VERTEX) {
    const response = responseBody.response || responseBody;
    if (!response?.candidates?.[0]) return responseBody;

    const candidate = response.candidates[0];
    const content = candidate.content;
    const usage = response.usageMetadata || responseBody.usageMetadata;
    let textContent = "", reasoningContent = "";
    const toolCalls = [];

    if (content?.parts) {
      for (const part of content.parts) {
        if (part.thought === true && part.text) reasoningContent += part.text;
        else if (part.text !== undefined) textContent += part.text;
        if (part.functionCall) {
          toolCalls.push({
            id: `call_${part.functionCall.name}_${Date.now()}_${toolCalls.length}`,
            type: "function",
            function: { name: part.functionCall.name, arguments: JSON.stringify(part.functionCall.args || {}) }
          });
        }
      }
    }

    const message = { role: "assistant" };
    if (textContent) message.content = textContent;
    if (reasoningContent) message.reasoning_content = reasoningContent;
    if (toolCalls.length > 0) message.tool_calls = toolCalls;
    if (!message.content && !message.tool_calls) message.content = "";

    let finishReason = (candidate.finishReason || "stop").toLowerCase();
    if (finishReason === "stop" && toolCalls.length > 0) finishReason = "tool_calls";

    const result = {
      id: `chatcmpl-${response.responseId || Date.now()}`,
      object: "chat.completion",
      created: Math.floor(new Date(response.createTime || Date.now()).getTime() / 1000),
      model: response.modelVersion || "gemini",
      choices: [{ index: 0, message, finish_reason: finishReason }]
    };

    if (usage) {
      result.usage = {
        prompt_tokens: (usage.promptTokenCount || 0) + (usage.thoughtsTokenCount || 0),
        completion_tokens: usage.candidatesTokenCount || 0,
        total_tokens: usage.totalTokenCount || 0
      };
      if (usage.thoughtsTokenCount > 0) {
        result.usage.completion_tokens_details = { reasoning_tokens: usage.thoughtsTokenCount };
      }
    }
    return result;
  }

  // Claude
  if (targetFormat === FORMATS.CLAUDE) {
    // Always translate a Claude-format body to OpenAI, even if `content` is
    // missing/null (e.g. M3 with max_tokens:1 spends the budget on thinking
    // and returns `content: null`). Returning the raw body would leave the
    // OpenAI client without a `choices` array and surface as a UI test error.
    // Early return if the response is already in OpenAI format (has choices array)
    // or if it has content as a non-array value (likely a different non-Claude format).
    // Some providers (e.g. xiaomi-tokenplan) return OpenAI-format responses even when
    // the request was translated to Claude format — the targetFormat is Claude but the
    // actual response is OpenAI-native and needs no further translation.
    if (responseBody.choices || (responseBody.content && !Array.isArray(responseBody.content))) return responseBody;

    let textContent = "", thinkingContent = "";
    const toolCalls = [];

    for (const block of (responseBody.content || [])) {
      if (block.type === "text") {
        // Strip markdown code block markers (e.g. kimi wraps JSON in ```json...```)
        const raw = block.text ?? "";
        const text = raw.replace(/^\s*```\s*json\s*\n?/i, "").replace(/\n?\s*```\s*$/i, "");
        textContent += text;
      } else if (block.type === "thinking") thinkingContent += block.thinking || "";
      else if (block.type === "tool_use") {
        toolCalls.push({ id: block.id, type: "function", function: { name: block.name, arguments: JSON.stringify(block.input || {}) } });
      }
    }

    const message = { role: "assistant" };
    if (textContent) message.content = textContent;
    if (thinkingContent) message.reasoning_content = thinkingContent;
    if (toolCalls.length > 0) message.tool_calls = toolCalls;
    if (!message.content && !message.tool_calls) message.content = "";

    let finishReason = responseBody.stop_reason || "stop";
    if (finishReason === "end_turn") finishReason = "stop";
    if (finishReason === "tool_use") finishReason = "tool_calls";

    const result = {
      id: `chatcmpl-${responseBody.id || Date.now()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: responseBody.model || "claude",
      choices: [{ index: 0, message, finish_reason: finishReason }]
    };

    if (responseBody.usage) {
      result.usage = {
        prompt_tokens: responseBody.usage.input_tokens || 0,
        completion_tokens: responseBody.usage.output_tokens || 0,
        total_tokens: (responseBody.usage.input_tokens || 0) + (responseBody.usage.output_tokens || 0)
      };
    }
    return result;
  }

  // Ollama
  if (targetFormat === FORMATS.OLLAMA) {
    return ollamaBodyToOpenAI(responseBody);
  }

  return responseBody;
}

/**
 * Handle non-streaming response from provider.
 */
export async function handleNonStreamingResponse({ providerResponse, provider, model, sourceFormat, targetFormat, body, stream, translatedBody, finalBody, requestStartTime, connectionId, apiKey, clientRawRequest, onRequestSuccess, reqLogger, toolNameMap, trackDone, appendLog }) {
  trackDone();
  const contentType = providerResponse.headers.get("content-type") || "";
  let responseBody;

  if (contentType.includes("text/event-stream")) {
    const sseText = await providerResponse.text();
    const parsed = parseSSEToOpenAIResponse(sseText, model);
    if (!parsed) {
      appendLog({ status: `FAILED ${HTTP_STATUS.BAD_GATEWAY}` });
      return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Invalid SSE response for non-streaming request");
    }
    responseBody = parsed;
  } else {
    // Read raw body text first so we can:
    // (a) parse as JSON (primary path), or
    // (b) try SSE fallback when provider returns SSE with wrong/missing content-type
    //     (e.g. some Anthropic-compatible providers send `text/event-stream`-shaped
    //     bodies under a plain `text/plain` or empty content-type), or
    // (c) emit a safe truncated diagnostic snippet on total parse failure.
    // We log only the first 200 chars of the RESPONSE body — never request prompts,
    // bearer tokens, or API keys.
    let rawText;
    try {
      rawText = stripUtf8Bom(await providerResponse.text());
    } catch (textErr) {
      appendLog({ status: `FAILED ${HTTP_STATUS.BAD_GATEWAY}` });
      console.error(`[ChatCore] Failed to read response body from ${provider}:`, textErr.message);
      return createErrorResult(HTTP_STATUS.BAD_GATEWAY, `Invalid JSON response from ${provider}`);
    }

    try {
      responseBody = JSON.parse(rawText);
    } catch {
      // Primary JSON parse failed.
      // Try SSE fallback only when the body clearly looks like Chat Completions SSE
      // even though the content-type is wrong or missing.
      const sseFallback = looksLikeChatCompletionsSSE(rawText)
        ? parseSSEToOpenAIResponse(rawText, model)
        : null;
      if (sseFallback) {
        console.warn(
          `[ChatCore] ${provider}: content-type "${contentType || "(none)"}" is not JSON; body parsed as SSE (fallback)`
        );
        responseBody = sseFallback;
      } else {
        const { snippet, trailingNote } = buildSafeDiagnosticSnippet(rawText);
        console.error(
          `[ChatCore] Failed to parse response from ${provider} | content-type: "${contentType || "(none)"}" | body[0:${Math.min(String(rawText || "").length, DIAGNOSTIC_SNIPPET_MAX)}]: ${snippet}${trailingNote}`
        );
        appendLog({ status: `FAILED ${HTTP_STATUS.BAD_GATEWAY}` });
        return createErrorResult(HTTP_STATUS.BAD_GATEWAY, `Invalid JSON response from ${provider}`);
      }
    }
  }

  reqLogger.logProviderResponse(providerResponse.status, providerResponse.statusText, providerResponse.headers, responseBody);
  if (onRequestSuccess) await onRequestSuccess();

  // Decloak tool_use names once on raw Claude body, before any translation (INPUT side)
  responseBody = decloakToolNames(responseBody, toolNameMap);

  const usage = extractUsageFromResponse(responseBody);
  appendLog({ tokens: usage, status: "200 OK" });
  saveUsageStats({ provider, model, tokens: usage, connectionId, apiKey, endpoint: clientRawRequest?.endpoint });

  const translatedResponse = needsTranslation(targetFormat, sourceFormat)
    ? translateNonStreamingResponse(responseBody, targetFormat, sourceFormat)
    : responseBody;

  // Fix finish_reason for tool_calls: some providers return non-standard values (e.g. "other")
  if (translatedResponse?.choices?.[0]) {
    const choice = translatedResponse.choices[0];
    const msg = choice.message;
    const hasToolCalls = Array.isArray(msg?.tool_calls) && msg.tool_calls.length > 0;
    if (hasToolCalls && choice.finish_reason !== "tool_calls") {
      choice.finish_reason = "tool_calls";
    }
  }

  // Ensure OpenAI-required fields
  if (!translatedResponse.object) translatedResponse.object = "chat.completion";
  if (!translatedResponse.created) translatedResponse.created = Math.floor(Date.now() / 1000);

  // Strip Azure-specific fields
  delete translatedResponse.prompt_filter_results;
  if (translatedResponse?.choices) {
    for (const choice of translatedResponse.choices) delete choice.content_filter_results;
  }

  if (translatedResponse?.usage) {
    translatedResponse.usage = filterUsageForFormat(addBufferToUsage(translatedResponse.usage), sourceFormat);
  }

  // Strip reasoning_content only when content is non-empty.
  // When content is empty (e.g. thinking models that used all tokens for reasoning),
  // reasoning_content is the only useful output and must be preserved.
  if (translatedResponse?.choices) {
    for (const choice of translatedResponse.choices) {
      if (choice?.message?.reasoning_content && choice.message.content) {
        delete choice.message.reasoning_content;
      }
    }
  }

  reqLogger.logConvertedResponse(translatedResponse);

  const totalLatency = Date.now() - requestStartTime;
  saveRequestDetail(buildRequestDetail({
    provider, model, connectionId,
    latency: { ttft: totalLatency, total: totalLatency },
    tokens: usage || { prompt_tokens: 0, completion_tokens: 0 },
    request: extractRequestConfig(body, stream),
    providerRequest: finalBody || translatedBody || null,
    providerResponse: responseBody || null,
    response: {
      content: translatedResponse?.choices?.[0]?.message?.content || translatedResponse?.content || null,
      thinking: translatedResponse?.choices?.[0]?.message?.reasoning_content || translatedResponse?.reasoning_content || null,
      finish_reason: translatedResponse?.choices?.[0]?.finish_reason || "unknown"
    },
    status: "success"
  }, { endpoint: clientRawRequest?.endpoint || null })).catch(err => {
    console.error("[RequestDetail] Failed to save:", err.message);
  });

  return {
    success: true,
    response: new Response(JSON.stringify(translatedResponse), {
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    })
  };
}
