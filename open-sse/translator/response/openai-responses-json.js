import { extractReasoningText } from "../concerns/reasoning.js";
import { extractTextContent } from "../formats/gemini.js";
import { CLAUDE_STOP, OPENAI_FINISH, ROLE, RESPONSES_ITEM } from "../schema/index.js";

function extractCustomToolInput(argumentsValue) {
  const argumentsText = typeof argumentsValue === "string" ? argumentsValue : JSON.stringify(argumentsValue || {});
  try {
    const parsed = JSON.parse(argumentsText);
    if (parsed && typeof parsed === "object" && typeof parsed.input === "string") return parsed.input;
  } catch { /* raw freeform input */ }
  return argumentsText;
}

export function responsesStatusFromFinishReason(finishReason) {
  if (finishReason === OPENAI_FINISH.LENGTH || finishReason === CLAUDE_STOP.MAX_TOKENS) {
    return { status: "incomplete", incomplete_details: { reason: "max_output_tokens" } };
  }
  if (finishReason === OPENAI_FINISH.CONTENT_FILTER) {
    return { status: "incomplete", incomplete_details: { reason: "content_filter" } };
  }
  return { status: "completed", incomplete_details: null };
}

/** Inverse of responsesStatusFromFinishReason, for Responses upstream -> Chat client. */
export function finishReasonFromIncompleteReason(reason) {
  if (reason === "max_output_tokens") return OPENAI_FINISH.LENGTH;
  if (reason === "content_filter") return OPENAI_FINISH.CONTENT_FILTER;
  return null;
}

/** Convert a completed Chat Completions JSON body into Responses API JSON. */
export function openAICompletionToResponses(responseBody, customToolNames = null, toolNamespaces = null) {
  const choice = responseBody?.choices?.[0];
  if (!choice) return responseBody;

  const message = choice.message || {};
  const output = [];
  const reasoning = extractReasoningText(message);
  if (reasoning) {
    output.push({
      type: RESPONSES_ITEM.REASONING,
      summary: [{ type: RESPONSES_ITEM.SUMMARY_TEXT, text: reasoning }],
    });
  }

  const text = extractTextContent(message.content);
  if (text) {
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
      ...(toolNamespaces?.get(fn.name) ? { namespace: toolNamespaces.get(fn.name) } : {}),
      ...(custom
        ? { input: extractCustomToolInput(fn.arguments) }
        : { arguments: typeof fn.arguments === "string" ? fn.arguments : JSON.stringify(fn.arguments || {}) }),
    });
  }

  const usage = responseBody.usage || {};
  const completion = responsesStatusFromFinishReason(choice.finish_reason);
  return {
    id: `resp_${responseBody.id || ""}`.replace(/^resp_chatcmpl-/, "resp_"),
    object: "response",
    created_at: responseBody.created || Math.floor(Date.now() / 1000),
    model: responseBody.model || "unknown",
    ...completion,
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
