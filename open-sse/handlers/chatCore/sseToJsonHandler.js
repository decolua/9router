import { convertResponsesStreamToJson } from "../../transformer/streamToJsonConverter.js";
import { restoreToolNames } from "../../utils/opencodeFingerprint.js";
import { createErrorResult } from "../../utils/error.js";
import { HTTP_STATUS } from "../../config/runtimeConfig.js";
import { FORMATS } from "../../translator/formats.js";
import { openAICompletionToClaudeMessage } from "../../translator/concerns/claudeMessage.js";
import { PROVIDERS } from "../../config/providers.js";
import { buildRequestDetail, extractRequestConfig, saveUsageStats, formatDoneLine } from "./requestDetail.js";
import { claudeMessageFromChatCompletion } from "./clientFormatResponse.js";
import { ROLE, RESPONSES_ITEM, OPENAI_FINISH } from "../../translator/schema/index.js";
import { extractReasoningText } from "../../translator/concerns/reasoning.js";

// Responses-API providers (e.g. codex) may emit SSE without content-type + use Responses output shape
const isResponsesProvider = (p) => PROVIDERS[p]?.format === FORMATS.OPENAI_RESPONSES;
import { saveRequestDetail, appendRequestLog } from "@/lib/usageDb.js";

function textFromResponsesMessageItem(item) {
  if (!item?.content || !Array.isArray(item.content)) return "";
  const byType = item.content.find((c) => c.type === "output_text");
  if (typeof byType?.text === "string") return byType.text;
  const anyText = item.content.find((c) => typeof c.text === "string");
  if (typeof anyText?.text === "string") return anyText.text;
  return "";
}

/**
 * Codex / Responses API may emit many alternating reasoning + message items.
 * Early message blocks often have empty output_text; the user-visible answer is usually in the last non-empty message.
 */
function pickAssistantMessageForChatCompletion(output) {
  if (!Array.isArray(output)) return { msgItem: null, textContent: null };
  const messages = output.filter((item) => item?.type === "message");
  if (messages.length === 0) return { msgItem: null, textContent: null };
  for (let i = messages.length - 1; i >= 0; i--) {
    const text = textFromResponsesMessageItem(messages[i]);
    if (text.length > 0) return { msgItem: messages[i], textContent: text };
  }
  const last = messages[messages.length - 1];
  return { msgItem: last, textContent: textFromResponsesMessageItem(last) };
}

/**
 * Upstream Responses API status → OpenAI `finish_reason`.
 *
 * A Responses body legitimately carries `in_progress` / `queued` / `failed` /
 * `incomplete`, and none of those are OpenAI finish_reason values: a client that
 * receives one cannot tell a truncated or unfinished answer from a finished one.
 * `incomplete` means the upstream cut the answer short at max_output_tokens, so it
 * maps to `length`; every other status — including a non-terminal one — is the
 * explicit `stop` default. The result is always inside the OpenAI enum.
 */
function finishReasonFromResponsesStatus(status, hasToolCalls) {
  if (hasToolCalls) return OPENAI_FINISH.TOOL_CALLS;
  return status === "incomplete" ? OPENAI_FINISH.LENGTH : OPENAI_FINISH.STOP;
}

/**
 * Convert an OpenAI Chat Completions JSON body into the Responses API shape.
 * Inlined here (not imported from nonStreamingHandler.js) to avoid a circular
 * import. Mirrors openAICompletionToResponses in nonStreamingHandler.js.
 */
function extractCustomToolInput(argumentsValue) {
  const argumentsText = typeof argumentsValue === "string" ? argumentsValue : JSON.stringify(argumentsValue || {});
  try {
    const parsed = JSON.parse(argumentsText);
    if (parsed && typeof parsed === "object" && typeof parsed.input === "string") return parsed.input;
  } catch { /* raw freeform input */ }
  return argumentsText;
}

function chatCompletionToResponses(responseBody, customToolNames = null) {
  const choice = responseBody?.choices?.[0];
  if (!choice) return responseBody;

  const message = choice.message || {};
  const output = [];

  const reasoning = message.reasoning_content || message.reasoning;
  if (typeof reasoning === "string" && reasoning.length > 0) {
    output.push({
      type: RESPONSES_ITEM.REASONING,
      summary: [{ type: RESPONSES_ITEM.SUMMARY_TEXT, text: reasoning }],
    });
  }

  const text = typeof message.content === "string" ? message.content : "";
  if (text.length > 0) {
    output.push({
      type: RESPONSES_ITEM.MESSAGE,
      role: ROLE.ASSISTANT,
      content: [{ type: RESPONSES_ITEM.OUTPUT_TEXT, text, annotations: [] }],
    });
  }

  for (const tc of message.tool_calls || []) {
    const fn = tc.function || {};
    const custom = customToolNames?.has(fn.name);
    output.push({
      type: custom ? RESPONSES_ITEM.CUSTOM_TOOL_CALL : RESPONSES_ITEM.FUNCTION_CALL,
      id: `${custom ? "ctc" : "fc"}_${tc.id || ""}`,
      call_id: tc.id || "",
      name: fn.name || "",
      ...(custom
        ? { input: extractCustomToolInput(fn.arguments) }
        : { arguments: typeof fn.arguments === "string" ? fn.arguments : JSON.stringify(fn.arguments || {}) }),
    });
  }

  const usage = responseBody.usage || {};
  return {
    id: `resp_${responseBody.id || ""}`.replace(/^resp_chatcmpl-/, "resp_"),
    object: "response",
    created_at: responseBody.created || Math.floor(Date.now() / 1000),
    model: responseBody.model || "unknown",
    status: "completed",
    background: false,
    error: null,
    output,
    usage: {
      input_tokens: usage.prompt_tokens || usage.input_tokens || 0,
      output_tokens: usage.completion_tokens || usage.output_tokens || 0,
      total_tokens: usage.total_tokens || (usage.prompt_tokens || 0) + (usage.completion_tokens || 0),
    },
  };
}

/**
 * Parse OpenAI-style SSE text into a single chat completion JSON.
 * Used when provider forces streaming but client wants non-streaming.
 */
export function parseSSEToOpenAIResponse(rawSSE, fallbackModel) {
  const chunks = [];
  let streamError = null;

  for (const line of String(rawSSE || "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      const chunk = JSON.parse(payload);
      if (chunk?.error) streamError = chunk.error;
      else chunks.push(chunk);
    } catch { /* ignore malformed lines */ }
  }

  if (streamError) return { error: streamError };
  if (chunks.length === 0) return null;

  const first = chunks[0];
  const contentParts = [];
  const reasoningParts = [];
  // Nonstandard `delta.reasoning` (some upstreams/relayers stream the thinking
  // block under this key). Kept separate and used ONLY when no canonical
  // `delta.reasoning_content` was seen, so a stream carrying both cannot double up.
  const legacyReasoningParts = [];
  const toolCallMap = new Map(); // index -> { id, type, function: { name, arguments } }
  let finishReason = "stop";
  let usage = null;

  for (const chunk of chunks) {
    const choice = chunk?.choices?.[0];
    const delta = choice?.delta || {};
    if (typeof delta.content === "string" && delta.content.length > 0) contentParts.push(delta.content);
    // Canonical key wins per delta; vendor aliases (`reasoning`,
    // `reasoning_details[]`) accumulate in a legacy bucket used ONLY when no
    // canonical content arrived anywhere in the stream — so a stream carrying
    // both keys cannot double up, while an alias-only lane's thinking is still
    // kept (upstream v0.5.111 alias coverage, federation precedence semantics).
    if (typeof delta.reasoning_content === "string" && delta.reasoning_content.length > 0) reasoningParts.push(delta.reasoning_content);
    else {
      const aliasReasoning = extractReasoningText(delta);
      if (aliasReasoning.length > 0) legacyReasoningParts.push(aliasReasoning);
    }
    if (choice?.finish_reason) finishReason = choice.finish_reason;
    if (chunk?.usage && typeof chunk.usage === "object") usage = chunk.usage;

    // Accumulate tool_calls from streaming deltas
    if (Array.isArray(delta.tool_calls)) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index ?? 0;
        if (!toolCallMap.has(idx)) {
          toolCallMap.set(idx, { id: tc.id || "", type: "function", function: { name: "", arguments: "" } });
        }
        const existing = toolCallMap.get(idx);
        if (tc.id) existing.id = tc.id;
        if (tc.function?.name) existing.function.name += tc.function.name;
        if (tc.function?.arguments) existing.function.arguments += tc.function.arguments;
      }
    }
  }

  const message = { role: "assistant", content: contentParts.join("") || (toolCallMap.size > 0 ? null : "") };
  // Nonstandard `delta.reasoning` (some upstreams/relayers stream the thinking
  // block under this key). The legacy bucket is used ONLY when no canonical
  // `delta.reasoning_content` was seen, so a stream carrying both cannot double up.
  const reasoningText = reasoningParts.length > 0 ? reasoningParts.join("") : legacyReasoningParts.join("");
  if (reasoningText.length > 0) message.reasoning_content = reasoningText;
  if (toolCallMap.size > 0) {
    message.tool_calls = [...toolCallMap.entries()].sort((a, b) => a[0] - b[0]).map(([, tc]) => tc);
  }

  const result = {
    id: first.id || `chatcmpl-${Date.now()}`,
    object: "chat.completion",
    created: first.created || Math.floor(Date.now() / 1000),
    model: first.model || fallbackModel || "unknown",
    choices: [{ index: 0, message, finish_reason: finishReason }]
  };
  if (usage) result.usage = usage;
  return result;
}

/**
 * Handle case: provider forced streaming but client wants JSON.
 * Supports both Codex/Responses API SSE and standard Chat Completions SSE.
 */
export async function handleForcedSSEToJson({ providerResponse, sourceFormat, targetFormat, provider, model, body, stream, translatedBody, finalBody, requestStartTime, connectionId, apiKey, clientRawRequest, onRequestSuccess, customToolNames, toolNameMap, trackDone, appendLog, reqTag, log }) {
  const contentType = providerResponse.headers.get("content-type") || "";
  const isSSE = contentType.includes("text/event-stream") || (contentType === "" && isResponsesProvider(provider));
  if (!isSSE) return null; // not handled here

  trackDone();

  const ctx = {
    provider, model, connectionId,
    request: extractRequestConfig(body, stream),
    providerRequest: finalBody || translatedBody || null
  };

  // Codex/Responses API SSE path
  // Branch on the UPSTREAM format (targetFormat = format we spoke to the provider in),
  // not the client format: a Responses-API client behind a chat-native forced-streaming
  // provider still receives chat SSE chunks, which must go through the standard path.
  const isCodexResponsesApi = isResponsesProvider(provider) || targetFormat === FORMATS.OPENAI_RESPONSES;
  if (isCodexResponsesApi) {
    try {
      const jsonResponse = await convertResponsesStreamToJson(providerResponse.body);

      // A Responses upstream that closed the stream WITHOUT a terminal event has
      // not answered, so a body with no assistant output there is a failed
      // upstream (quota, abort, free-route rate limit) — not an empty answer. Left
      // alone it ships as HTTP 200 + `finish_reason:"in_progress"` to a chat client
      // and as `content:[{type:"text",text:""}]` + `stop_reason:"end_turn"` to an
      // Anthropic one, neither of which a health check can tell apart from a model
      // that legitimately had nothing to say. Fail loud instead. A COMPLETED
      // upstream with empty output is still a 200: it explicitly finished.
      const { msgItem, textContent } = pickAssistantMessageForChatCompletion(jsonResponse.output);
      // A tool-only answer is not an empty one: `function_call` items (and their
      // Responses `custom_tool_call` sibling) are real assistant output.
      const funcCallItems = (jsonResponse.output || []).filter(item => item.type === "function_call");
      const toolItems = (jsonResponse.output || []).filter(item => item.type === "function_call" || item.type === "custom_tool_call");
      const hasAssistantOutput = (typeof textContent === "string" && textContent.length > 0) || toolItems.length > 0;
      if (!jsonResponse.terminal && !hasAssistantOutput) {
        console.error("[ChatCore] Responses API upstream closed without a terminal event and produced no output");
        return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Upstream returned no output and never completed (upstream_empty_completion)");
      }

      // Tool calls are Responses `function_call` items and pin finish_reason to
      // `tool_calls`. The ONE mapped finish_reason below is used by both the client
      // body and the recorded detail row, so a DB read can never disagree with what
      // the client received.
      const toolCalls = funcCallItems.map((item, idx) => ({
        id: item.call_id || `call_${item.name}_${Date.now()}_${idx}`,
        type: "function",
        function: {
          name: item.name,
          arguments: typeof item.arguments === "string" ? item.arguments : JSON.stringify(item.arguments || {})
        }
      }));
      const hasToolCalls = toolCalls.length > 0;
      const finishReason = finishReasonFromResponsesStatus(jsonResponse.status, hasToolCalls);

      if (onRequestSuccess) await onRequestSuccess();

      const usage = jsonResponse.usage || {};
      appendLog({ tokens: usage, status: "200 OK" });
      saveUsageStats({ provider, model, tokens: usage, connectionId, apiKey, endpoint: clientRawRequest?.endpoint, silent: true });
      if (log?.line) log.line(reqTag, "📊", formatDoneLine({ usage, latency: { total: Date.now() - requestStartTime } }));

      // Same cache-inclusive total for the recorded detail, so the DB and the
      // client-facing usage can never disagree.
      const inTokensForLog = (usage.input_tokens || 0)
        + (usage.cache_read_input_tokens || usage.cached_tokens || 0)
        + (usage.cache_creation_input_tokens || 0);
      const totalLatency = Date.now() - requestStartTime;

      saveRequestDetail(buildRequestDetail({
        ...ctx,
        latency: { ttft: totalLatency, total: totalLatency },
        tokens: { prompt_tokens: inTokensForLog, completion_tokens: usage.output_tokens || 0 },
        response: { content: textContent, thinking: null, finish_reason: finishReason },
        status: "success"
      }, { endpoint: clientRawRequest?.endpoint || null })).catch(() => {});

      // Client is Responses API → return as-is
      if (sourceFormat === FORMATS.OPENAI_RESPONSES) {
        return { success: true, response: new Response(JSON.stringify(restoreToolNames(jsonResponse, toolNameMap)), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }) };
      }

      // Build client-format response.
      // input_tokens EXCLUDES cached tokens on cache-capable upstreams, so summing
      // only input+output under-reports prompt_tokens — measured: 2012 reported
      // where the real prompt was ~5344 with 5332 served from cache. Fold the cache
      // counters in, and keep them visible in prompt_tokens_details so a client can
      // tell a cache hit from a small prompt.
      const cacheRead = usage.cache_read_input_tokens || usage.cached_tokens || 0;
      const cacheCreate = usage.cache_creation_input_tokens || 0;
      const inTokens = (usage.input_tokens || 0) + cacheRead + cacheCreate;
      const outTokens = usage.output_tokens || 0;
      const cacheDetails = (cacheRead > 0 || cacheCreate > 0)
        ? { prompt_tokens_details: {
              ...(cacheRead > 0 ? { cached_tokens: cacheRead } : {}),
              ...(cacheCreate > 0 ? { cache_creation_tokens: cacheCreate } : {}) } }
        : {};
      let finalResp;

      if (sourceFormat === FORMATS.ANTIGRAVITY || sourceFormat === FORMATS.GEMINI || sourceFormat === FORMATS.GEMINI_CLI) {
        finalResp = {
          response: {
            candidates: [{ content: { role: "model", parts: [{ text: textContent || "" }] }, finishReason: "STOP", index: 0 }],
            usageMetadata: { promptTokenCount: inTokens, candidatesTokenCount: outTokens, totalTokenCount: inTokens + outTokens },
            modelVersion: model,
            responseId: jsonResponse.id || `resp_${Date.now()}`
          }
        };
      } else {
        const message = { role: "assistant", content: textContent || (hasToolCalls ? null : "") };
        if (hasToolCalls) message.tool_calls = toolCalls;
        const chatCompletion = {
          id: jsonResponse.id || `chatcmpl-${Date.now()}`,
          object: "chat.completion",
          created: jsonResponse.created_at || Math.floor(Date.now() / 1000),
          model: jsonResponse.model || model,
          choices: [{ index: 0, message, finish_reason: finishReason }],
          usage: { prompt_tokens: inTokens, completion_tokens: outTokens, total_tokens: inTokens + outTokens, ...cacheDetails }
        };
        // An Anthropic client reads `content[]`, never `choices[]`. Handing it a
        // chat.completion body is a silent HTTP 200 with no content, not an error.
        finalResp = sourceFormat === FORMATS.CLAUDE
          ? claudeMessageFromChatCompletion(chatCompletion)
          : chatCompletion;
      }

      if (sourceFormat === FORMATS.CLAUDE) {
        finalResp = openAICompletionToClaudeMessage(finalResp);
      }

      return { success: true, response: new Response(JSON.stringify(restoreToolNames(finalResp, toolNameMap)), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }) };
    } catch (err) {
      console.error("[ChatCore] Responses API SSE→JSON failed:", err);
      return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Failed to convert streaming response to JSON");
    }
  }

  // Standard Chat Completions SSE path
  try {
    const sseText = await providerResponse.text();
    const parsed = parseSSEToOpenAIResponse(sseText, model);
    if (!parsed) return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Invalid SSE response for non-streaming request");
    if (parsed.error) {
      // Structured error chunks may carry the real upstream status (e.g. the
      // Qoder executor emits status 403 for billing envelopes). Preserve it so
      // the account loop locks/falls back on the right status instead of a
      // generic 502. Anything outside 400-599 still maps to 502.
      const upstreamStatus = Number(parsed.error.status);
      const status = Number.isInteger(upstreamStatus) && upstreamStatus >= 400 && upstreamStatus <= 599
        ? upstreamStatus
        : HTTP_STATUS.BAD_GATEWAY;
      return createErrorResult(
        status,
        parsed.error.message || "Upstream SSE stream failed"
      );
    }

    if (onRequestSuccess) await onRequestSuccess();

    const usage = parsed.usage || {};
    appendLog({ tokens: usage, status: "200 OK" });
    saveUsageStats({ provider, model, tokens: usage, connectionId, apiKey, endpoint: clientRawRequest?.endpoint, silent: true });
    if (log?.line) log.line(reqTag, "📊", formatDoneLine({ usage, latency: { total: Date.now() - requestStartTime } }));

    const totalLatency = Date.now() - requestStartTime;
    saveRequestDetail(buildRequestDetail({
      ...ctx,
      latency: { ttft: totalLatency, total: totalLatency },
      tokens: usage,
      response: {
        content: parsed.choices?.[0]?.message?.content || null,
        thinking: parsed.choices?.[0]?.message?.reasoning_content || null,
        finish_reason: parsed.choices?.[0]?.finish_reason || "unknown"
      },
      status: "success"
    }, { endpoint: clientRawRequest?.endpoint || null })).catch(() => {});

    // Re-attach usage explicitly. This handler already HAS the correct usage — it is
    // the same object written to the usage DB, and for a cached Claude request that DB
    // row reads cache_read_input_tokens: 11022 — yet the client was observed receiving
    // no usage field at all (verified 2026-08-04 with a fingerprinted payload matched
    // on both sides). Whatever drops it between assembly and serialisation, the client
    // must not be left unable to account for its own token spend: a caller cannot tell
    // a 90%-cached request from a cheap one without this.
    if (usage && Object.keys(usage).length > 0) parsed.usage = usage;

    // Strip reasoning_content only when content is non-empty.
    // When content is empty (e.g. thinking models that used all tokens for reasoning),
    // reasoning_content is the only useful output and must be preserved.
    // Previously this was unconditional, which broke Qwen3.5, Claude extended thinking, etc.
    if (parsed?.choices) {
      for (const choice of parsed.choices) {
        if (choice?.message?.reasoning_content && choice.message.content) {
          delete choice.message.reasoning_content;
        }
      }
    }

    // A Responses-format client (e.g. Codex) forced this provider to stream,
    // but wants JSON back. parseSSEToOpenAIResponse yields a Chat Completions
    // body; convert it to the Responses `output` shape so tool_calls are not
    // lost on the non-streaming return path. Inlined (not imported from
    // nonStreamingHandler.js) to avoid a circular import: nonStreamingHandler
    // already imports parseSSEToOpenAIResponse from this module.
    //
    // An Anthropic client (`POST /v1/messages`) needs the same treatment in the
    // other direction: it reads `content[]`, so a raw chat.completion body is a
    // silent HTTP 200 with no assistant content.
    let finalBody;
    if (sourceFormat === FORMATS.OPENAI_RESPONSES) {
      finalBody = chatCompletionToResponses(parsed, customToolNames);
    } else if (sourceFormat === FORMATS.CLAUDE) {
      finalBody = claudeMessageFromChatCompletion(parsed);
    } else {
      finalBody = parsed;
    }

    return { success: true, response: new Response(JSON.stringify(restoreToolNames(finalBody, toolNameMap)), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }) };
  } catch (err) {
    console.error("[ChatCore] Chat Completions SSE→JSON failed:", err);
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Failed to convert streaming response to JSON");
  }
}
