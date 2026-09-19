import { convertResponsesStreamToJson } from "../../transformer/streamToJsonConverter.js";
import { createErrorResult } from "../../utils/error.js";
import { HTTP_STATUS } from "../../config/runtimeConfig.js";
import { FORMATS } from "../../translator/formats.js";
import { PROVIDERS } from "../../config/providers.js";
import { buildRequestDetail, extractRequestConfig, saveUsageStats, formatDoneLine } from "./requestDetail.js";
import { translateResponse, initState } from "../../translator/index.js";
import { toOpenAIFinish } from "../../translator/concerns/finishReason.js";
import { collectJsonFrames } from "../../transformer/jsonToStreamConverter.js";
import { applyModelAlias, calledModelName } from "../../utils/modelAlias.js";
import { ROLE, RESPONSES_ITEM, OPENAI_BLOCK, CLAUDE_BLOCK, CLAUDE_EVENT, RESPONSES_EVENT, OPENAI_FINISH, MODEL_FALLBACK } from "../../translator/schema/index.js";

// Frames whose `type` is a provider event name, mapped to the translator format
// that can decode that event stream into OpenAI chunks.
const EVENT_FRAME_FORMAT = {
  [CLAUDE_EVENT.MESSAGE_START]: FORMATS.CLAUDE,
  [CLAUDE_EVENT.CONTENT_BLOCK_START]: FORMATS.CLAUDE,
  [CLAUDE_EVENT.CONTENT_BLOCK_DELTA]: FORMATS.CLAUDE,
  [CLAUDE_EVENT.CONTENT_BLOCK_STOP]: FORMATS.CLAUDE,
  [CLAUDE_EVENT.MESSAGE_DELTA]: FORMATS.CLAUDE,
  [CLAUDE_EVENT.MESSAGE_STOP]: FORMATS.CLAUDE,
  [CLAUDE_EVENT.ERROR]: FORMATS.CLAUDE,
  [RESPONSES_EVENT.CREATED]: FORMATS.OPENAI_RESPONSES,
  [RESPONSES_EVENT.OUTPUT_ITEM_ADDED]: FORMATS.OPENAI_RESPONSES,
  [RESPONSES_EVENT.OUTPUT_TEXT_DELTA]: FORMATS.OPENAI_RESPONSES,
  [RESPONSES_EVENT.REASONING_SUMMARY_TEXT_DELTA]: FORMATS.OPENAI_RESPONSES,
  [RESPONSES_EVENT.FUNCTION_CALL_ARGS_DELTA]: FORMATS.OPENAI_RESPONSES,
  [RESPONSES_EVENT.OUTPUT_ITEM_DONE]: FORMATS.OPENAI_RESPONSES,
  [RESPONSES_EVENT.COMPLETED]: FORMATS.OPENAI_RESPONSES,
  [RESPONSES_EVENT.FAILED]: FORMATS.OPENAI_RESPONSES,
  [RESPONSES_EVENT.DONE]: FORMATS.OPENAI_RESPONSES,
};

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
 * Parse an SSE-shaped body into a single chat completion. Used when the provider
 * streamed but the client wanted JSON, and whenever an upstream labels a body as
 * `text/event-stream` for a non-streaming request. Real gateways deviate from the
 * spec constantly — no space after `data:`, `event:` field lines, NDJSON rows
 * wearing an SSE content-type, Claude/Responses event frames on an OpenAI route,
 * or a whole JSON document mislabelled as a stream — and every one of those used
 * to read as "no response" and come back as a 502.
 */
export function parseSSEToOpenAIResponse(rawSSE, fallbackModel) {
  const frames = collectJsonFrames(rawSSE);
  if (frames.length === 0) return null;

  const openaiChunks = [];
  const eventFrames = [];
  const unknownFrames = [];
  let streamError = null;
  let wholeCompletion = null;

  for (const frame of frames) {
    if (!frame || typeof frame !== "object") continue;
    if (frame.error) streamError = frame.error;
    if (Array.isArray(frame.choices) && frame.choices[0]?.message) wholeCompletion = frame;
    else if (Array.isArray(frame.choices)) openaiChunks.push(frame);
    else if (EVENT_FRAME_FORMAT[frame.type]) eventFrames.push(frame);
    else unknownFrames.push(frame);
  }

  if (streamError) return { error: streamError };
  if (wholeCompletion) return wholeCompletion;

  if (openaiChunks.length) {
    const fromChunks = accumulateOpenAIChunks(openaiChunks, fallbackModel);
    return hasAnswer(fromChunks) ? fromChunks : harvestCompletion(frames, fallbackModel) || fromChunks;
  }
  if (eventFrames.length) {
    const chunks = translateFramesToChunks(eventFrames, EVENT_FRAME_FORMAT[eventFrames[0].type], fallbackModel);
    const fromEvents = accumulateOpenAIChunks(chunks, fallbackModel);
    return hasAnswer(fromEvents) ? fromEvents : harvestCompletion(frames, fallbackModel) || fromEvents;
  }
  return harvestCompletion(unknownFrames, fallbackModel);
}

/**
 * A completion is only usable when it says something or bills something: an empty
 * one is how a mis-parsed stream hides, so callers can fall back to the harvest.
 */
function hasAnswer(body) {
  const message = body?.choices?.[0]?.message;
  if (!message) return false;
  return !!(message.content || message.tool_calls?.length || message.reasoning_content || body?.usage);
}

/**
 * Replay provider event frames (Claude Messages / OpenAI Responses) through the
 * same response translators the live streaming path uses, so this fallback can
 * never drift from what a normal stream would have produced.
 */
function translateFramesToChunks(frames, eventFormat, fallbackModel) {
  const state = { ...initState(FORMATS.OPENAI), model: fallbackModel, customToolNames: new Set() };
  const chunks = [];
  for (const frame of frames) {
    try {
      for (const translated of [].concat(translateResponse(eventFormat, FORMATS.OPENAI, frame, state) || [])) {
        if (translated && typeof translated === "object") chunks.push(translated);
      }
    } catch {
      /* a frame this translator cannot read is picked up by the harvest fallback */
    }
  }
  return chunks;
}

/**
 * Last resort: walk the frames and collect whatever assistant text, reasoning,
 * tool calls and usage they carry, wherever they put it. Deliberately dumb — it
 * exists so an unfamiliar provider shape surfaces as a rough answer instead of a
 * blank one.
 */
function harvestCompletion(frames, fallbackModel) {
  let text = "";
  let reasoning = "";
  let usage = null;
  let model = fallbackModel || MODEL_FALLBACK;
  let finishReason = null;
  const toolCalls = new Map();

  const pushToolCall = (key, call) => {
    if (!call?.name && !call?.id) return;
    toolCalls.set(String(key), call);
  };

  for (const frame of frames) {
    if (!frame || typeof frame !== "object") continue;
    if (frame.model || frame.message?.model) model = frame.model || frame.message.model;
    usage = frame.usage || frame.message?.usage || frame.response?.usage || frame.usageMetadata || usage;
    if (frame.delta?.stop_reason) finishReason = toOpenAIFinish(frame.delta.stop_reason, FORMATS.CLAUDE);
    if (frame.candidates?.[0]?.finishReason) finishReason = toOpenAIFinish(frame.candidates[0].finishReason, FORMATS.GEMINI);

    for (const block of [].concat(frame.content || [])) {
      if (!block || typeof block !== "object") continue;
      if (block.type === CLAUDE_BLOCK.TEXT) text += block.text || "";
      else if (block.type === CLAUDE_BLOCK.THINKING) reasoning += block.thinking || "";
      else if (block.type === CLAUDE_BLOCK.TOOL_USE) pushToolCall(`blk${block.id || toolCalls.size}`, { id: block.id, name: block.name, input: block.input });
    }
    for (const part of [].concat(frame.candidates?.[0]?.content?.parts || [])) {
      if (!part || typeof part !== "object") continue;
      if (typeof part.text === "string") {
        if (part.thought === true) reasoning += part.text;
        else text += part.text;
      }
      if (part.functionCall?.name) pushToolCall(`fn${part.functionCall.name}${toolCalls.size}`, { name: part.functionCall.name, input: part.functionCall.args });
    }
    for (const item of [].concat(frame.output || frame.response?.output || [])) {
      if (!item || typeof item !== "object") continue;
      if (item.type === RESPONSES_ITEM.OUTPUT_TEXT) text += item.text || "";
      else if (item.type === RESPONSES_ITEM.MESSAGE) {
        for (const c of [].concat(item.content || [])) if (typeof c?.text === "string") text += c.text;
      } else if (item.type === RESPONSES_ITEM.FUNCTION_CALL) {
        pushToolCall(`rc${item.call_id || item.id || toolCalls.size}`, { name: item.name, input: item.arguments });
      } else if (item.type === RESPONSES_ITEM.REASONING) {
        for (const s of [].concat(item.summary || [])) if (typeof s?.text === "string") reasoning += s.text;
      }
    }

    const delta = frame.delta;
    if (typeof delta === "string") text += delta;
    else if (delta && typeof delta === "object") {
      if (typeof delta.text === "string") text += delta.text;
      if (typeof delta.content === "string" && !Array.isArray(frame.choices)) text += delta.content;
      if (typeof delta.thinking === "string") reasoning += delta.thinking;
      if (typeof delta.reasoning_content === "string") reasoning += delta.reasoning_content;
      if (typeof delta.partial_json === "string" && toolCalls.size) {
        const last = [...toolCalls.values()].pop();
        last.input = `${typeof last.input === "string" ? last.input : ""}${delta.partial_json}`;
      }
      for (const tc of [].concat(delta.tool_calls || [])) {
        if (!tc?.function?.name && !tc?.function?.arguments) continue;
        const key = `d${tc.index ?? toolCalls.size}`;
        const prev = toolCalls.get(key) || { id: tc.id, name: "", input: "" };
        toolCalls.set(key, {
          id: tc.id || prev.id,
          name: `${prev.name || ""}${tc.function?.name || ""}`,
          input: `${typeof prev.input === "string" ? prev.input : ""}${tc.function?.arguments || ""}`,
        });
      }
    }
  }

  if (!text && !reasoning && toolCalls.size === 0) return null;

  const message = { role: ROLE.ASSISTANT, content: text || (toolCalls.size ? null : "") };
  if (reasoning) message.reasoning_content = reasoning;
  if (toolCalls.size) {
    message.tool_calls = [...toolCalls.entries()].map(([key, call], index) => ({
      id: call.id || `call_${index}`,
      type: OPENAI_BLOCK.FUNCTION,
      function: {
        name: call.name || key,
        arguments: typeof call.input === "string" ? call.input : JSON.stringify(call.input || {}),
      },
    }));
  }
  const body = {
    id: `chatcmpl-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, message, finish_reason: finishReason || (toolCalls.size ? OPENAI_FINISH.TOOL_CALLS : OPENAI_FINISH.STOP) }],
  };
  if (usage) body.usage = usage;
  return body;
}

/** Accumulate OpenAI chat.completion.chunk frames into one completion. */
function accumulateOpenAIChunks(chunks, fallbackModel) {
  const first = chunks[0];
  const contentParts = [];
  const reasoningParts = [];
  const toolCallMap = new Map(); // index -> { id, type, function: { name, arguments } }
  let finishReason = "stop";
  let usage = null;

  for (const chunk of chunks) {
    const choice = chunk?.choices?.[0];
    const delta = choice?.delta || {};
    if (typeof delta.content === "string" && delta.content.length > 0) contentParts.push(delta.content);
    if (typeof delta.reasoning_content === "string" && delta.reasoning_content.length > 0) reasoningParts.push(delta.reasoning_content);
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
  if (reasoningParts.length > 0) message.reasoning_content = reasoningParts.join("");
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
export async function handleForcedSSEToJson({ providerResponse, sourceFormat, targetFormat, provider, model, body, stream, translatedBody, finalBody, requestStartTime, connectionId, apiKey, requestedModel, clientRawRequest, onRequestSuccess, customToolNames, trackDone, appendLog, reqTag, log }) {
  const contentType = providerResponse.headers.get("content-type") || "";
  const isSSE = contentType.includes("text/event-stream") || (contentType === "" && isResponsesProvider(provider));
  if (!isSSE) return null; // not handled here
  const alias = calledModelName(requestedModel, model);

  trackDone();

  const ctx = {
    provider, model, connectionId, requestedModel,
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
      if (onRequestSuccess) await onRequestSuccess();

      const usage = jsonResponse.usage || {};
      appendLog({ tokens: usage, status: "200 OK" });
      saveUsageStats({ provider, model, tokens: usage, connectionId, apiKey, requestedModel, endpoint: clientRawRequest?.endpoint, silent: true });
      if (log?.line) log.line(reqTag, "📊", formatDoneLine({ usage, latency: { total: Date.now() - requestStartTime } }));

      // Same cache-inclusive total for the recorded detail, so the DB and the
      // client-facing usage can never disagree.
      const inTokensForLog = (usage.input_tokens || 0)
        + (usage.cache_read_input_tokens || usage.cached_tokens || 0)
        + (usage.cache_creation_input_tokens || 0);
      const { msgItem, textContent } = pickAssistantMessageForChatCompletion(jsonResponse.output);
      const totalLatency = Date.now() - requestStartTime;

      saveRequestDetail(buildRequestDetail({
        ...ctx,
        latency: { ttft: totalLatency, total: totalLatency },
        tokens: { prompt_tokens: inTokensForLog, completion_tokens: usage.output_tokens || 0 },
        response: { content: textContent, thinking: null, finish_reason: jsonResponse.status || "unknown" },
        status: "success"
      }, { endpoint: clientRawRequest?.endpoint || null })).catch(() => {});

      // Client is Responses API → return as-is
      if (sourceFormat === FORMATS.OPENAI_RESPONSES) {
        applyModelAlias(jsonResponse, alias);
        return { success: true, response: new Response(JSON.stringify(jsonResponse), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }) };
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

      // Extract tool calls from Responses API output (function_call items)
      const funcCallItems = (jsonResponse.output || []).filter(item => item.type === "function_call");
      const toolCalls = funcCallItems.map((item, idx) => ({
        id: item.call_id || `call_${item.name}_${Date.now()}_${idx}`,
        type: "function",
        function: {
          name: item.name,
          arguments: typeof item.arguments === "string" ? item.arguments : JSON.stringify(item.arguments || {})
        }
      }));
      const hasToolCalls = toolCalls.length > 0;

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
        const responseDone = jsonResponse.status === "completed" || jsonResponse.status === "done";
        const finishReason = hasToolCalls ? "tool_calls" : (responseDone ? "stop" : (jsonResponse.status || "stop"));
        finalResp = {
          id: jsonResponse.id || `chatcmpl-${Date.now()}`,
          object: "chat.completion",
          created: jsonResponse.created_at || Math.floor(Date.now() / 1000),
          model: jsonResponse.model || model,
          choices: [{ index: 0, message, finish_reason: finishReason }],
          usage: { prompt_tokens: inTokens, completion_tokens: outTokens, total_tokens: inTokens + outTokens, ...cacheDetails }
        };
      }

      applyModelAlias(finalResp, alias);
      return { success: true, response: new Response(JSON.stringify(finalResp), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }) };
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
      return createErrorResult(
        HTTP_STATUS.BAD_GATEWAY,
        parsed.error.message || "Upstream SSE stream failed"
      );
    }

    if (onRequestSuccess) await onRequestSuccess();

    const usage = parsed.usage || {};
    appendLog({ tokens: usage, status: "200 OK" });
    saveUsageStats({ provider, model, tokens: usage, connectionId, apiKey, requestedModel, endpoint: clientRawRequest?.endpoint, silent: true });
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
    // Everything above is logging; the document leaving here must name the called model.
    applyModelAlias(parsed, alias);
    const finalBody = sourceFormat === FORMATS.OPENAI_RESPONSES
      ? chatCompletionToResponses(parsed, customToolNames)
      : parsed;

    return { success: true, response: new Response(JSON.stringify(finalBody), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }) };
  } catch (err) {
    console.error("[ChatCore] Chat Completions SSE→JSON failed:", err);
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Failed to convert streaming response to JSON");
  }
}
