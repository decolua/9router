/**
 * Convert non-streaming OpenAI Chat Completions response to Anthropic Messages format.
 * Used when client speaks Claude format but upstream provider speaks OpenAI format.
 *
 * Input:  OpenAI Chat Completions JSON  {object:"chat.completion", choices:[{message:{...}}]}
 * Output: Anthropic Messages JSON        {id:"msg_...", type:"message", content:[...]}
 */
export function translateOpenAIToClaudeIfNeeded(responseBody, sourceFormat) {
  if (!responseBody || !responseBody.choices?.[0]) return responseBody;

  const choice = responseBody.choices[0];
  const msg = choice.message || {};
  const finishReason = choice.finish_reason || "stop";

  const content = [];

  // Text content
  if (typeof msg.content === "string" && msg.content.length > 0) {
    content.push({ type: "text", text: msg.content });
  }

  // Reasoning / thinking content
  if (typeof msg.reasoning_content === "string" && msg.reasoning_content.length > 0) {
    content.push({ type: "thinking", thinking: msg.reasoning_content });
  }

  // Tool calls
  if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
    for (const tc of msg.tool_calls) {
      let input = {};
      if (typeof tc.function?.arguments === "string") {
        try { input = JSON.parse(tc.function.arguments); } catch { input = {}; }
      }
      content.push({
        type: "tool_use",
        id: tc.id || `call_${tc.function?.name || "unknown"}_${Date.now()}`,
        name: tc.function?.name || "unknown",
        input
      });
    }
  }

  // If no content blocks at all, add empty text block (Anthropic requires at least one)
  if (content.length === 0) {
    content.push({ type: "text", text: "" });
  }

  const stopReasonMap = {
    "stop": "end_turn",
    "length": "max_tokens",
    "tool_calls": "tool_use",
    "content_filter": "end_turn",
  };

  const usage = responseBody.usage || {};

  return {
    id: (responseBody.id || `msg_${Date.now()}`).replace(/^chatcmpl-/, "msg_"),
    type: "message",
    role: "assistant",
    content,
    model: responseBody.model || "claude",
    stop_reason: stopReasonMap[finishReason] || "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: usage.prompt_tokens || 0,
      output_tokens: usage.completion_tokens || 0,
    }
  };
}
