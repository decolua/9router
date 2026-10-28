import { FORMATS } from "../../translator/formats.js";
import { needsTranslation } from "../../translator/index.js";
import { openAICompletionToClaudeMessage } from "../../translator/concerns/claudeMessage.js";
import { ollamaBodyToOpenAI } from "../../translator/response/ollama-to-openai.js";
import { addBufferToUsage, filterUsageForFormat, applyUsageMultipliers, estimateInputTokens, estimateResponseOutputTokens, hasValidUsage } from "../../utils/usageTracking.js";
import { createErrorResult } from "../../utils/error.js";
import { rescueResponse } from "../../translator/concerns/toolCallRescue.js";
import { applyJsonGuard } from "../../translator/concerns/jsonGuard.js";
import { applyOpenAIToolBridge } from "../../translator/concerns/toolBridge.js";
import { parseToolCallReply } from "../../executors/webCookieToolBridge.js";
import { upstreamResponseHeaders } from "../../utils/upstreamHeaders.js";
import { HTTP_STATUS } from "../../config/runtimeConfig.js";
import { parseSSEToOpenAIResponse } from "./sseToJsonHandler.js";
import { unwrapClineEnvelope } from "../../shared/clineEnvelope.js";
import { buildRequestDetail, extractRequestConfig, extractUsageFromResponse, saveUsageStats, formatDoneLine } from "./requestDetail.js";
import { appendRequestLog, saveRequestDetail } from "@/lib/usageDb.js";
import { decloakToolNames } from "../../utils/claudeCloaking.js";
import { applyModelAlias, calledModelName } from "../../utils/modelAlias.js";
import { restoreToolNames } from "../../utils/opencodeFingerprint.js";
import { ROLE, RESPONSES_ITEM } from "../../translator/schema/index.js";

function parseToolArguments(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}


/** Declared tool names from a request's tools/functions arrays. */
function declaredToolNames(args) {
  const names = [];
  const push = (n) => {
    if (typeof n === "string" && n.trim()) names.push(n.trim());
  };
  for (const t of args?.tools || []) {
    if (t?.function) push(t.function.name);
    else push(t?.name);
  }
  for (const f of args?.functions || []) push(f?.name);
  return names;
}

let bridgeCallSeq = 0;

/**
 * The request-side bridge teaches two call formats - a ```tool_call fence and a
 * <<TOOL_CALL>> marker. toolBridge.js reads the shapes a model invents on its
 * own, so this second pass reads the shapes the bridge itself asked for.
 *
 * Returns null when the reply carries no call. A call naming a tool the client
 * never offered is dropped instead of invented; a near miss on spelling is
 * mapped back to the declared name so client handlers still match.
 */
function bridgeFromBridgeMarkers(text, args) {
  if (typeof text !== "string" || !text) return null;
  const { content, calls } = parseToolCallReply(text);
  if (!calls.length) return null;

  const declared = declaredToolNames(args);
  const norm = (v) => String(v || "").toLowerCase().replace(/[-_]+/g, "_");
  const byNorm = new Map(declared.map((n) => [norm(n), n]));

  const accepted = [];
  for (const call of calls) {
    const name = declared.length ? byNorm.get(norm(call.name)) : call.name;
    if (!name) continue;
    bridgeCallSeq += 1;
    accepted.push({
      id: `call_bridge${Date.now().toString(36)}${bridgeCallSeq.toString(36)}`,
      type: "function",
      function: { name, arguments: JSON.stringify(call.arguments ?? {}) },
    });
  }
  if (!accepted.length) return null;
  return { content, tool_calls: accepted };
}

/**
 * OpenAI Tool Bridge - response side, non-streaming.
 *
 * A text-only provider (browser-session models with `tools: false`) answers a
 * tool request in prose, so the client receives a plain string and waits for a
 * tool_call that never arrives. The model's own answer is where the invocation
 * is declared - `{"name": ...}`, `<tool_use>`, `to=read_file {...}` - so
 * rewriting it is a FORMAT repair on content the model wrote, never a guess
 * about intent.
 *
 * Both client shapes are covered: the OpenAI chat envelope
 * (`choices[0].message.content`) and the Claude envelope (`content[]` text
 * blocks). The tool catalogue comes from the request the client actually sent,
 * which is the only trustworthy list of what may be called.
 */
export function bridgeOpenAIChatResponse(response, body) {
  // The catalogue travels with the request in whichever shape the client used.
  const catalogue = body?._openaiToolBridge || {};
  const sourceTools = Array.isArray(body?.tools) && body.tools.length
    ? body.tools
    : (Array.isArray(catalogue.tools) ? catalogue.tools : undefined);
  const sourceFunctions = Array.isArray(body?.functions) && body.functions.length
    ? body.functions
    : (Array.isArray(catalogue.functions) ? catalogue.functions : undefined);

  const args = {
    tools: sourceTools,
    functions: sourceFunctions,
  };

  let applied = 0;

  // OpenAI chat envelope.
  const message = response?.choices?.[0]?.message;
  if (message && typeof message.content === "string" && !message.tool_calls) {
    const out = applyOpenAIToolBridge({ content: message.content }, args);
    if (out.openaiToolBridge?.applied) {
      message.content = out.content;
      message.tool_calls = out.tool_calls;
      applied += out.tool_calls.length;
    } else {
      // Second pass: the fenced / marker shapes the request-side bridge asks for.
      // toolBridge.js reads the marker shapes models invent on their own; these
      // two are the ones the bridge itself taught the model to write.
      const marked = bridgeFromBridgeMarkers(out.content ?? message.content, args);
      if (marked) {
        message.content = marked.content;
        message.tool_calls = marked.tool_calls;
        applied += marked.tool_calls.length;
      }
    }
  }

  // Claude envelope: content is an array of blocks; the bridge reads text blocks.
  if (Array.isArray(response?.content) && !response?.tool_calls) {
    const texts = response.content.filter((b) => b?.type === "text" && typeof b.text === "string");
    if (texts.length) {
      const joined = texts.map((b) => b.text).join("\n");
      const out = applyOpenAIToolBridge({ content: joined }, args);
      let calls = out.openaiToolBridge?.applied ? out.tool_calls : null;
      let cleaned = out.content;
      if (!calls) {
        const marked = bridgeFromBridgeMarkers(joined, args);
        if (marked) {
          calls = marked.tool_calls;
          cleaned = marked.content;
        }
      }
      if (calls?.length) {
        // Keep the prose as a text block (it explains the call) and add tool_use
        // blocks after it, mirroring what a natively tool-capable model emits.
        texts[0].text = cleaned;
        for (let i = 1; i < texts.length; i++) texts[i].text = "";
        for (const tc of calls) {
          response.content.push({
            type: "tool_use",
            id: tc.id,
            name: tc.function.name,
            input: parseToolArguments(tc.function.arguments),
          });
        }
        applied += calls.length;
      }
    }
  }

  return applied;
}
/**
 * Convert an OpenAI Chat Completions non-streaming response body into the
 * OpenAI Responses API shape. Used when a Responses-format client (e.g. Codex)
 * is routed to a Chat Completions upstream and `stream:false` - the streaming
 * path already emits Responses events, but the JSON path returned a raw
 * `chat.completion` body, so tool_calls were invisible to Responses clients.
 */
function extractCustomToolInput(argumentsValue) {
  const argumentsText = typeof argumentsValue === "string" ? argumentsValue : JSON.stringify(argumentsValue || {});
  try {
    const parsed = JSON.parse(argumentsText);
    if (parsed && typeof parsed === "object" && typeof parsed.input === "string") return parsed.input;
  } catch { /* raw freeform input */ }
  return argumentsText;
}

function openAICompletionToResponses(responseBody, customToolNames = null) {
  const choice = responseBody?.choices?.[0];
  if (!choice) return responseBody;

  const message = choice.message || {};
  const output = [];

  // Reasoning → a reasoning item (summary text), mirroring the streaming path.
  const reasoning = message.reasoning_content || message.reasoning;
  if (typeof reasoning === "string" && reasoning.length > 0) {
    output.push({
      type: RESPONSES_ITEM.REASONING,
      summary: [{ type: RESPONSES_ITEM.SUMMARY_TEXT, text: reasoning }],
    });
  }

  // Assistant text → a message item with output_text content.
  const text = typeof message.content === "string" ? message.content : "";
  if (text.length > 0) {
    output.push({
      type: RESPONSES_ITEM.MESSAGE,
      role: ROLE.ASSISTANT,
      content: [{ type: RESPONSES_ITEM.OUTPUT_TEXT, text, annotations: [] }],
    });
  }

  // tool_calls → function_call/custom_tool_call items (Responses-native tool shape).
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
  const status = choice.finish_reason === "tool_calls" ? "completed" : (choice.finish_reason === "stop" ? "completed" : (choice.finish_reason || "completed"));

  return {
    id: `resp_${responseBody.id || ""}`.replace(/^resp_chatcmpl-/, "resp_"),
    object: "response",
    created_at: responseBody.created || Math.floor(Date.now() / 1000),
    model: responseBody.model || "unknown",
    status,
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
 * Translate non-streaming response body from provider format → OpenAI format.
 */
export function translateNonStreamingResponse(responseBody, targetFormat, sourceFormat, customToolNames = null) {
  if (targetFormat === sourceFormat) return responseBody;
  // Provider responded in OpenAI Chat Completions shape but the client speaks
  // Responses API - convert so tool_calls/text surface as Responses `output`.
  if (targetFormat === FORMATS.OPENAI && sourceFormat === FORMATS.OPENAI_RESPONSES) {
    return openAICompletionToResponses(responseBody, customToolNames);
  }
  if (targetFormat === FORMATS.OPENAI && sourceFormat === FORMATS.CLAUDE) {
    return openAICompletionToClaudeMessage(responseBody);
  }
  if (targetFormat === FORMATS.OPENAI) return responseBody;

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
        // Handle inline image data (from image generation models)
        const inlineData = part.inlineData || part.inline_data;
        if (inlineData?.data) {
          const mimeType = inlineData.mimeType || inlineData.mime_type || "image/png";
          textContent += `\n![image](data:${mimeType};base64,${inlineData.data})\n`;
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
    // the request was translated to Claude format - the targetFormat is Claude but the
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
export async function handleNonStreamingResponse({ providerResponse, provider, model, sourceFormat, targetFormat, body, stream, translatedBody, finalBody, requestStartTime, connectionId, apiKey, requestedModel, clientRawRequest, onRequestSuccess, reqLogger, toolNameMap, customToolNames, trackDone, appendLog, pxpipe, reqTag, log, pluginResult, modelMultipliers = null, isAntiProbe = false, hideError = false }) {
  trackDone();
  const contentType = providerResponse.headers.get("content-type") || "";
  let responseBody;
  // Which format `responseBody` ends up in: the provider's own when it answers
  // normally, the OpenAI pivot when we had to rebuild it out of a stream.
  let responseBodyFormat = targetFormat;

  if (contentType.includes("text/event-stream")) {
    const sseText = await providerResponse.text();
    const parsed = parseSSEToOpenAIResponse(sseText, model);
    if (!parsed) {
      appendLog({ status: `FAILED ${HTTP_STATUS.BAD_GATEWAY}` });
      return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Invalid SSE response for non-streaming request", undefined, null, hideError);
    }
    if (parsed.error) {
      const upstreamStatus = Number(parsed.error.status);
      const status = Number.isInteger(upstreamStatus) && upstreamStatus >= 400 && upstreamStatus <= 599
        ? upstreamStatus
        : HTTP_STATUS.BAD_GATEWAY;
      appendLog({ status: `FAILED ${status}` });
      return createErrorResult(status, parsed.error.message || "Upstream SSE stream failed");
    }
    responseBody = parsed;
    responseBodyFormat = FORMATS.OPENAI;
  } else {
    try {
      responseBody = await providerResponse.json();
    } catch (err) {
      appendLog({ status: `FAILED ${HTTP_STATUS.BAD_GATEWAY}` });
      console.error(`[ChatCore] Failed to parse JSON from ${provider}:`, err.message);
      return createErrorResult(HTTP_STATUS.BAD_GATEWAY, `Invalid JSON response from ${provider}`);
    }
  }

  // Unwrap before any consumer reads choices/usage so non-stream clients get a
  // bare OpenAI body and usage tracking sees data.usage. No-op unless the
  // provider opts in via transport.quirks.clineEnvelope.
  responseBody = unwrapClineEnvelope(responseBody, provider);

  reqLogger.logProviderResponse(providerResponse.status, providerResponse.statusText, providerResponse.headers, responseBody);
  if (onRequestSuccess) {
    Promise.resolve()
      .then(onRequestSuccess)
      .catch(err => {
        console.error("[ChatCore] onRequestSuccess failed:", err?.message || err);
      });
  }

  // Decloak tool_use names once on raw Claude body, before any translation (INPUT side)
  responseBody = decloakToolNames(responseBody, toolNameMap);

  let usage = extractUsageFromResponse(responseBody);
  const outTokens = usage?.completion_tokens ?? usage?.output_tokens ?? 0;
  const inTokens = usage?.prompt_tokens ?? usage?.input_tokens ?? 0;

  if (!usage || (inTokens === 0 && outTokens === 0)) {
    const estimatedOut = estimateResponseOutputTokens(responseBody);
    const estimatedIn = estimateInputTokens(body);
    if (estimatedIn > 0 || estimatedOut > 0) {
      usage = {
        prompt_tokens: estimatedIn,
        completion_tokens: estimatedOut,
        total_tokens: estimatedIn + estimatedOut,
        estimated: true,
      };
      if (responseBody && typeof responseBody === "object") {
        responseBody.usage = usage;
      }
    }
  } else if (outTokens === 0) {
    const estimatedOut = estimateResponseOutputTokens(responseBody);
    if (estimatedOut > 0) {
      if (usage.completion_tokens !== undefined || usage.prompt_tokens !== undefined) {
        usage.completion_tokens = estimatedOut;
        usage.total_tokens = (usage.prompt_tokens || 0) + estimatedOut;
      } else if (usage.output_tokens !== undefined || usage.input_tokens !== undefined) {
        usage.output_tokens = estimatedOut;
        usage.total_tokens = (usage.input_tokens || 0) + estimatedOut;
      }
      if (responseBody?.usage) {
        if (responseBody.usage.completion_tokens !== undefined) {
          responseBody.usage.completion_tokens = estimatedOut;
          responseBody.usage.total_tokens = (responseBody.usage.prompt_tokens || 0) + estimatedOut;
        } else if (responseBody.usage.output_tokens !== undefined) {
          responseBody.usage.output_tokens = estimatedOut;
          responseBody.usage.total_tokens = (responseBody.usage.input_tokens || 0) + estimatedOut;
        }
      }
    }
  } else if (inTokens === 0 && body) {
    const estimatedIn = estimateInputTokens(body);
    if (estimatedIn > 0) {
      if (usage.prompt_tokens !== undefined || usage.completion_tokens !== undefined) {
        usage.prompt_tokens = estimatedIn;
        usage.total_tokens = estimatedIn + (usage.completion_tokens || 0);
      } else if (usage.input_tokens !== undefined || usage.output_tokens !== undefined) {
        usage.input_tokens = estimatedIn;
        usage.total_tokens = estimatedIn + (usage.output_tokens || 0);
      }
      if (responseBody?.usage) {
        if (responseBody.usage.prompt_tokens !== undefined) {
          responseBody.usage.prompt_tokens = estimatedIn;
          responseBody.usage.total_tokens = estimatedIn + (responseBody.usage.completion_tokens || 0);
        } else if (responseBody.usage.input_tokens !== undefined) {
          responseBody.usage.input_tokens = estimatedIn;
          responseBody.usage.total_tokens = estimatedIn + (responseBody.usage.output_tokens || 0);
        }
      }
    }
  }

  if (modelMultipliers && usage) {
    usage = applyUsageMultipliers(usage, modelMultipliers);
  }
  appendLog({ tokens: usage, status: "200 OK" });
  saveUsageStats({ provider, model, tokens: usage, connectionId, apiKey, requestedModel, endpoint: clientRawRequest?.endpoint, silent: true });
  if (log?.line) log.line(reqTag, "📊", formatDoneLine({ usage, latency: { total: Date.now() - requestStartTime } }));

  const translatedResponse = needsTranslation(responseBodyFormat, sourceFormat)
    ? translateNonStreamingResponse(responseBody, responseBodyFormat, sourceFormat, customToolNames)
    : responseBody;
  const isClaudeMessageResponse = sourceFormat === FORMATS.CLAUDE && translatedResponse?.type === "message";
  // Responses-format translation produces a `object:"response"` body with no
  // `choices`; skip the Chat-Completions-specific post-processing below for it.
  // `responseBodyFormat` is the provider side of the pair; a client that speaks
  // Responses gets an `object:"response"` body with no `choices` to post-process.
  const isResponsesResponse = (responseBodyFormat === FORMATS.OPENAI_RESPONSES || sourceFormat === FORMATS.OPENAI_RESPONSES) && translatedResponse?.object === "response";

  // Fix finish_reason for tool_calls: some providers return non-standard values (e.g. "other")
  if (translatedResponse?.choices?.[0]) {
    const choice = translatedResponse.choices[0];
    const msg = choice.message;
    const hasToolCalls = Array.isArray(msg?.tool_calls) && msg.tool_calls.length > 0;
    if (hasToolCalls && choice.finish_reason !== "tool_calls") {
      choice.finish_reason = "tool_calls";
    }
  }

  // A call the client cannot satisfy ends the turn: `Invalid args for tool "Bash":
  // must have required property 'command'` is the client validating against the
  // schema this very request declared, and it throws rather than continuing. Run
  // after the finish_reason fix so a dropped call can correct that reason back
  // and leave a well-formed answer instead of a half-finished tool turn.
  if (Array.isArray(translatedBody?.tools) && translatedBody.tools.length > 0) {
    const rescued = rescueResponse(translatedResponse, translatedBody.tools);
    if (rescued.renamed || rescued.recovered || rescued.dropped) {
      log?.debug?.("TOOLRESCUE", `${rescued.renamed} renamed, ${rescued.recovered} recovered, ${rescued.dropped} dropped (response)`);
    }
  }

  // OpenAI Tool Bridge (opt-in per model): a provider with no native tool
  // support answers in prose. The invocation is already in the model's answer,
  // so promoting it to tool_calls is a format repair, not a guess.
  if (pluginResult?.isToolBridgeActive && translatedResponse && typeof translatedResponse === "object") {
    const bridged = bridgeOpenAIChatResponse(translatedResponse, body);
    if (bridged > 0) {
      log?.debug?.("TOOLBRIDGE", `${bridged} call(s) recovered from prose · ${provider}/${model}`);
    }
  }

  // JSON Guard (opt-in per model): make machine-readable output parseable again.
  // Runs after translation and after the tool rescue, because both rewrite the
  // tool_calls this reads. Only the non-streaming path reaches here - a streaming
  // answer's tool arguments arrive as fragments and are forwarded as they land,
  // so there is no complete value to repair without buffering every tool call.
  if (pluginResult?.isJsonGuardActive && translatedResponse && typeof translatedResponse === "object") {
    const guarded = applyJsonGuard(translatedResponse, translatedBody?.tools);
    if (guarded.changed) {
      const s = guarded.stats;
      log?.debug?.("JSONGUARD", `${s.textRepaired} text repaired, ${s.argsRepaired} args repaired, ${s.argsDropped} args dropped, ${s.argsCleaned} schema-cleaned (${s.argsFilled} filled, ${s.argsMissing} still missing)`);
    } else {
      log?.debug?.("JSONGUARD", "checked, nothing to repair");
    }
  }

  // Ensure OpenAI-required fields
  if (!isClaudeMessageResponse && !isResponsesResponse) {
    if (!translatedResponse.object) translatedResponse.object = "chat.completion";
    if (!translatedResponse.created) translatedResponse.created = Math.floor(Date.now() / 1000);
  }

  // Strip Azure-specific fields
  if (!isClaudeMessageResponse && !isResponsesResponse) {
    delete translatedResponse.prompt_filter_results;
    if (translatedResponse?.choices) {
      for (const choice of translatedResponse.choices) delete choice.content_filter_results;
    }
  }

  if (translatedResponse?.usage) {
    if (modelMultipliers) {
      translatedResponse.usage = applyUsageMultipliers(translatedResponse.usage, modelMultipliers);
    }
    translatedResponse.usage = filterUsageForFormat(addBufferToUsage(translatedResponse.usage), sourceFormat);
  }

  if ((isAntiProbe || requestedModel) && translatedResponse && typeof translatedResponse === "object") {
    if (requestedModel && translatedResponse.model) {
      translatedResponse.model = requestedModel;
    }
    if (isAntiProbe) {
      delete translatedResponse.system_fingerprint;
    }
  }

  // Rescue zero-output tokens for clients:
  // When content is empty (e.g. thinking models that used all tokens for reasoning),
  // promote reasoning_content into content so standard OpenAI clients don't see 0 output tokens.
  if (!isClaudeMessageResponse && !isResponsesResponse && translatedResponse?.choices) {
    for (const choice of translatedResponse.choices) {
      if ((!choice?.message?.content || !choice.message.content.trim()) && choice?.message?.reasoning_content) {
        choice.message.content = choice.message.reasoning_content;
      } else if ((!choice?.message?.content || !choice.message.content.trim()) && !choice?.message?.tool_calls) {
        const reason = choice?.finish_reason;
        choice.message.content = reason === "length"
          ? "[Model stopped: max_tokens limit reached before output could be generated. Please increase max_tokens.]"
          : reason === "content_filter"
          ? "[Model stopped: Output filtered by upstream provider content policy.]"
          : "[The model generated zero output tokens. Upstream completed with empty response.]";
      }
    }
  }

  // Log first: the operator has to see the model that actually served the call.
  reqLogger.logConvertedResponse(translatedResponse);
  applyModelAlias(translatedResponse, calledModelName(requestedModel, model));

  const totalLatency = Date.now() - requestStartTime;
  saveRequestDetail(buildRequestDetail({
    provider, model, connectionId, requestedModel,
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
    pxpipe,
    status: "success"
  }, { endpoint: clientRawRequest?.endpoint || null })).catch(err => {
    console.error("[RequestDetail] Failed to save:", err.message);
  });

  return {
    success: true,
    response: new Response(JSON.stringify(restoreToolNames(translatedResponse, toolNameMap)), {
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", ...upstreamResponseHeaders(providerResponse.headers) }
    })
  };
}
