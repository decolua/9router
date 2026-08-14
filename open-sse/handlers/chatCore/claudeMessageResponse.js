import { FORMATS } from "../../translator/formats.js";
import { fromOpenAIFinish } from "../../translator/concerns/finishReason.js";

function parseToolArguments(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function flattenTextParts(value) {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value
    .map((part) => {
      if (typeof part === "string") return part;
      if (typeof part?.text === "string") return part.text;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function normalizeClassifierDecision(text) {
  const trimmed = String(text || "").trim();
  if (trimmed === "<block>no</block>" || trimmed === "<block>yes</block>") return trimmed;
  return null;
}

export function isClaudeClassifierRequest(body) {
  if (!body || body.stream !== false) return false;
  const stopSequences = Array.isArray(body.stop_sequences) ? body.stop_sequences : [];
  if (!stopSequences.some((seq) => String(seq || "").trim() === "</block>")) return false;

  const systemText = [
    flattenTextParts(body.system),
    ...(Array.isArray(body.messages)
      ? body.messages
        .filter((msg) => msg?.role === "system")
        .map((msg) => flattenTextParts(msg.content))
      : []),
  ]
    .filter(Boolean)
    .join("\n");

  return /security\s+monitor/i.test(systemText);
}

export function openAICompletionToClaudeMessage(responseBody, { classifierMode = false } = {}) {
  if (!responseBody?.choices?.[0]) {
    if (classifierMode) {
      throw new Error("Claude Code classifier returned an invalid decision; expected exactly <block>no</block> or <block>yes</block>.");
    }
    return responseBody;
  }

  const choice = responseBody.choices[0];
  const message = choice.message || {};
  const content = [];
  const textContent = typeof message.content === "string" ? message.content : "";
  const reasoning = message.reasoning_content || message.provider_specific_fields?.reasoning_content || "";

  if (classifierMode) {
    const decision = normalizeClassifierDecision(textContent);
    if (!decision) {
      throw new Error("Claude Code classifier returned an invalid decision; expected exactly <block>no</block> or <block>yes</block>.");
    }
    content.push({ type: "text", text: decision });
  } else {
    if (reasoning) content.push({ type: "thinking", thinking: reasoning });
    if (textContent.length > 0) content.push({ type: "text", text: textContent });
    for (const toolCall of message.tool_calls || []) {
      const fn = toolCall.function || {};
      content.push({
        type: "tool_use",
        id: toolCall.id || `toolu_${Date.now()}_${content.length}`,
        name: fn.name || toolCall.name || "",
        input: parseToolArguments(fn.arguments || toolCall.arguments),
      });
    }
    if (content.length === 0) content.push({ type: "text", text: "" });
  }

  const usage = responseBody.usage || {};
  return {
    id: String(responseBody.id || `msg_${Date.now()}`).replace(/^chatcmpl-/, ""),
    type: "message",
    role: "assistant",
    model: responseBody.model || "unknown",
    content,
    stop_reason: fromOpenAIFinish(choice.finish_reason, FORMATS.CLAUDE),
    stop_sequence: null,
    usage: {
      input_tokens: usage.prompt_tokens || usage.input_tokens || 0,
      output_tokens: usage.completion_tokens || usage.output_tokens || 0,
    },
  };
}
