import { FORMATS } from "../formats.js";
import { fromOpenAIFinish } from "../concerns/finishReason.js";
import { GEMINI_FINISH, OPENAI_FINISH } from "../schema/finishReasons.js";

function parseArgs(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function getChoice(completion) {
  return completion?.choices?.[0] || {};
}

function getMessage(completion) {
  return getChoice(completion).message || {};
}

function getToolCalls(completion) {
  const calls = getMessage(completion).tool_calls;
  return Array.isArray(calls) ? calls : [];
}

function openAIToGeminiFinish(reason) {
  switch (reason) {
    case OPENAI_FINISH.LENGTH: return GEMINI_FINISH.MAX_TOKENS;
    case OPENAI_FINISH.CONTENT_FILTER: return GEMINI_FINISH.SAFETY;
    default: return GEMINI_FINISH.STOP;
  }
}

function openAICompletionToClaudeMessage(completion) {
  if (!completion?.choices?.[0]) return completion;
  const choice = getChoice(completion);
  const message = getMessage(completion);
  const content = [];

  const reasoning = message.reasoning_content || message.provider_specific_fields?.reasoning_content || "";
  if (reasoning) content.push({ type: "thinking", thinking: reasoning });
  if (typeof message.content === "string" && message.content.length > 0) {
    content.push({ type: "text", text: message.content });
  }
  for (const toolCall of getToolCalls(completion)) {
    const fn = toolCall.function || {};
    content.push({
      type: "tool_use",
      id: toolCall.id || `toolu_${Date.now()}_${content.length}`,
      name: fn.name || toolCall.name || "",
      input: parseArgs(fn.arguments || toolCall.arguments),
    });
  }
  if (content.length === 0) content.push({ type: "text", text: "" });

  const usage = completion.usage || {};
  return {
    id: String(completion.id || `msg_${Date.now()}`).replace(/^chatcmpl-/, ""),
    type: "message",
    role: "assistant",
    model: completion.model || "unknown",
    content,
    stop_reason: fromOpenAIFinish(choice.finish_reason, FORMATS.CLAUDE),
    stop_sequence: null,
    usage: {
      input_tokens: usage.prompt_tokens || usage.input_tokens || 0,
      output_tokens: usage.completion_tokens || usage.output_tokens || 0,
    },
  };
}

function openAICompletionToGeminiResponse(completion) {
  if (!completion?.choices?.[0]) return completion;
  const message = getMessage(completion);
  const usage = completion.usage || {};
  const parts = [];
  const reasoning = message.reasoning_content || message.provider_specific_fields?.reasoning_content || "";
  if (reasoning) parts.push({ text: reasoning, thought: true });
  if (typeof message.content === "string" && message.content.length > 0) {
    parts.push({ text: message.content });
  }
  for (const toolCall of getToolCalls(completion)) {
    const fn = toolCall.function || {};
    parts.push({
      functionCall: {
        name: fn.name || toolCall.name || "",
        args: parseArgs(fn.arguments || toolCall.arguments),
      }
    });
  }
  if (parts.length === 0) parts.push({ text: "" });

  return {
    response: {
      candidates: [{
        content: { role: "model", parts },
        finishReason: openAIToGeminiFinish(getChoice(completion).finish_reason),
        index: 0
      }],
      usageMetadata: {
        promptTokenCount: usage.prompt_tokens || usage.input_tokens || 0,
        candidatesTokenCount: usage.completion_tokens || usage.output_tokens || 0,
        totalTokenCount: usage.total_tokens || ((usage.prompt_tokens || 0) + (usage.completion_tokens || 0)),
      },
      modelVersion: completion.model || "unknown",
      responseId: completion.id || `resp_${Date.now()}`
    }
  };
}

function openAICompletionToOllama(completion) {
  if (!completion?.choices?.[0]) return completion;
  const choice = getChoice(completion);
  const message = getMessage(completion);
  const ollamaMessage = {
    role: "assistant",
    content: typeof message.content === "string" ? message.content : "",
  };
  if (message.reasoning_content) ollamaMessage.thinking = message.reasoning_content;
  const toolCalls = getToolCalls(completion).map((toolCall) => {
    const fn = toolCall.function || {};
    return {
      id: toolCall.id,
      function: {
        name: fn.name || toolCall.name || "",
        arguments: parseArgs(fn.arguments || toolCall.arguments),
      }
    };
  });
  if (toolCalls.length > 0) ollamaMessage.tool_calls = toolCalls;

  const usage = completion.usage || {};
  return {
    model: completion.model || "unknown",
    created_at: completion.created ? new Date(completion.created * 1000).toISOString() : new Date().toISOString(),
    message: ollamaMessage,
    done: true,
    done_reason: choice.finish_reason || "stop",
    prompt_eval_count: usage.prompt_tokens || usage.input_tokens || 0,
    eval_count: usage.completion_tokens || usage.output_tokens || 0,
  };
}

export function responsesApiToOpenAICompletion(responseBody, fallbackModel) {
  const output = Array.isArray(responseBody?.output) ? responseBody.output : [];
  const reasoningText = output
    .filter(item => item?.type === "reasoning")
    .flatMap(item => Array.isArray(item.summary) ? item.summary : [])
    .map(part => part?.text || "")
    .join("");
  const messages = output.filter(item => item?.type === "message");
  const msgItem = [...messages].reverse().find(item => {
    const content = Array.isArray(item.content) ? item.content : [];
    return content.some(part => typeof part.text === "string" && part.text.length > 0);
  }) || messages[messages.length - 1] || null;
  const textContent = (Array.isArray(msgItem?.content) ? msgItem.content : [])
    .map(part => part.type === "output_text" || typeof part.text === "string" ? part.text || "" : "")
    .join("");
  const toolCalls = output
    .filter(item => item?.type === "function_call")
    .map((item, idx) => ({
      id: item.call_id || `call_${item.name || "tool"}_${idx}`,
      type: "function",
      function: {
        name: item.name || "",
        arguments: typeof item.arguments === "string" ? item.arguments : JSON.stringify(item.arguments || {}),
      },
    }));

  const usage = responseBody?.usage || {};
  const message = {
    role: "assistant",
    content: textContent || (toolCalls.length > 0 ? null : ""),
  };
  if (reasoningText) message.reasoning_content = reasoningText;
  if (toolCalls.length > 0) message.tool_calls = toolCalls;

  const responseDone = responseBody?.status === "completed" || responseBody?.status === "done";
  const finishReason = toolCalls.length > 0 ? "tool_calls" : (responseDone ? "stop" : (responseBody?.status || "stop"));
  return {
    id: responseBody?.id || `chatcmpl-${Date.now()}`,
    object: "chat.completion",
    created: responseBody?.created_at || Math.floor(Date.now() / 1000),
    model: responseBody?.model || fallbackModel || "unknown",
    choices: [{ index: 0, message, finish_reason: finishReason }],
    usage: {
      prompt_tokens: usage.input_tokens || usage.prompt_tokens || 0,
      completion_tokens: usage.output_tokens || usage.completion_tokens || 0,
      total_tokens: usage.total_tokens || ((usage.input_tokens || usage.prompt_tokens || 0) + (usage.output_tokens || usage.completion_tokens || 0)),
    },
  };
}

function openAICompletionToResponsesOutput(completion) {
  if (!completion?.choices?.[0]) return completion;
  const message = getMessage(completion);
  const usage = completion.usage || {};
  const output = [];
  let idx = 0;

  const reasoning = message.reasoning_content || message.provider_specific_fields?.reasoning_content || "";
  if (reasoning) {
    output.push({
      type: "reasoning",
      id: `rs_${completion.id || Date.now()}_${idx}`,
      summary: [{ type: "summary_text", text: reasoning }],
    });
    idx++;
  }

  const text = typeof message.content === "string" ? message.content : "";
  if (text) {
    output.push({
      type: "message",
      id: `msg_${completion.id || Date.now()}_${idx}`,
      role: "assistant",
      content: [{ type: "output_text", text, annotations: [], logprobs: [] }],
    });
    idx++;
  }

  const toolCalls = getToolCalls(completion);
  if (toolCalls.length > 0) {
    for (const toolCall of toolCalls) {
      const fn = toolCall.function || {};
      const callId = toolCall.id || `call_${fn.name || "tool"}_${idx}`;
      output.push({
        type: "function_call",
        id: `fc_${callId}`,
        call_id: callId,
        name: fn.name || toolCall.name || "",
        arguments: typeof fn.arguments === "string" ? fn.arguments : JSON.stringify(fn.arguments || {}),
      });
      idx++;
    }
  } else if (!text && !reasoning) {
    output.push({
      type: "message",
      id: `msg_${completion.id || Date.now()}_${idx}`,
      role: "assistant",
      content: [{ type: "output_text", text: "", annotations: [], logprobs: [] }],
    });
  }

  const finishReason = getChoice(completion).finish_reason || "stop";
  const responseUsage = {
    input_tokens: usage.prompt_tokens || usage.input_tokens || 0,
    output_tokens: usage.completion_tokens || usage.output_tokens || 0,
    total_tokens: usage.total_tokens || ((usage.prompt_tokens || 0) + (usage.completion_tokens || 0)),
  };
  const inputDetails = usage.prompt_tokens_details || usage.input_tokens_details;
  if (inputDetails?.cached_tokens !== undefined) {
    responseUsage.input_tokens_details = { cached_tokens: inputDetails.cached_tokens };
  } else if (usage.cache_read_input_tokens !== undefined) {
    responseUsage.input_tokens_details = { cached_tokens: usage.cache_read_input_tokens };
  }
  const outputDetails = usage.completion_tokens_details || usage.output_tokens_details;
  if (outputDetails?.reasoning_tokens !== undefined) {
    responseUsage.output_tokens_details = { reasoning_tokens: outputDetails.reasoning_tokens };
  } else if (usage.reasoning_tokens !== undefined) {
    responseUsage.output_tokens_details = { reasoning_tokens: usage.reasoning_tokens };
  }

  return {
    id: completion.id ? `resp_${completion.id}` : `resp_${Date.now()}`,
    object: "response",
    created_at: completion.created || Math.floor(Date.now() / 1000),
    model: completion.model || "unknown",
    status: finishReason === "stop" || finishReason === "tool_calls" ? "completed" : finishReason,
    output,
    usage: responseUsage,
  };
}

export function projectCompletionToClientFormat(completion, sourceFormat) {
  switch (sourceFormat) {
    case FORMATS.CLAUDE:
      return openAICompletionToClaudeMessage(completion);
    case FORMATS.GEMINI:
    case FORMATS.GEMINI_CLI:
    case FORMATS.ANTIGRAVITY:
    case FORMATS.VERTEX:
      return openAICompletionToGeminiResponse(completion);
    case FORMATS.OLLAMA:
      return openAICompletionToOllama(completion);
    case FORMATS.OPENAI_RESPONSES:
    case FORMATS.OPENAI_RESPONSE:
      return openAICompletionToResponsesOutput(completion);
    default:
      return completion;
  }
}
