// Helpers that turn raw chat-completion payloads and gateway error strings into
// text a person can actually read in the dashboard.

const REASONING_KEYS = ["reasoning_content", "reasoning", "thinking"];

const clean = (value) => (typeof value === "string" ? value.trim() : "");

function textFromContent(content) {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      if (typeof block === "string") return block;
      if (!block || typeof block !== "object") return "";
      return clean(block.text) || clean(block.content);
    })
    .filter(Boolean)
    .join("\n\n");
}

function reasoningFrom(message) {
  for (const key of REASONING_KEYS) {
    const value = clean(message?.[key]);
    if (value) return value;
  }
  const specific = message?.provider_specific_fields;
  if (specific && typeof specific === "object") {
    for (const key of REASONING_KEYS) {
      const value = clean(specific[key]);
      if (value) return value;
    }
  }
  return "";
}

/**
 * Reads the assistant answer out of a /v1/chat/completions body.
 * kind: "text" | "thinking" (reasoning only) | "tool" | "empty"
 */
export function extractAssistantText(payload) {
  const choice = payload?.choices?.[0] || null;
  const outputItem = Array.isArray(payload?.output)
    ? payload.output.find((item) => item?.content) || null
    : null;
  const message = choice?.message || (outputItem ? { content: outputItem.content } : null);
  const finishReason = clean(choice?.finish_reason || payload?.stop_reason);
  let text = textFromContent(message?.content);
  if (!text && typeof payload?.output_text === "string") text = payload.output_text.trim();
  const thinking = reasoningFrom(message);
  const toolCalls = Array.isArray(message?.tool_calls) ? message.tool_calls : [];

  if (text) return { kind: "text", text, thinking, toolCalls, finishReason };
  if (thinking) return { kind: "thinking", text: "", thinking, toolCalls, finishReason };
  if (toolCalls.length) {
    const names = toolCalls.map((t) => clean(t?.function?.name) || "tool").join(", ");
    return { kind: "tool", text: `Tool call requested: ${names}`, thinking, toolCalls, finishReason };
  }
  return { kind: "empty", text: "", thinking, toolCalls, finishReason };
}

/** One-sentence explanation for a successful call that produced no text. */
export function describeEmptyResponse({ finishReason, usage, thinking } = {}) {
  const completion = Number(usage?.completion_tokens ?? usage?.output_tokens);
  if (finishReason === "length") return "The model spent its whole output budget before writing any text.";
  if (finishReason && /filter|block/i.test(finishReason)) return "The provider filtered the answer before it reached you.";
  if (thinking) return "The model only returned its internal reasoning, with no final answer.";
  if (completion === 0) return "The model reported success but generated zero output tokens.";
  return "The model returned an empty answer, which usually means it refused or the provider sent back nothing.";
}

/** Shortens 32-char hex ids so a connection uuid does not swallow the line. */
function squeezeIds(value) {
  return String(value)
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, (m) => `${m.slice(0, 8)}…`)
    .replace(/([0-9a-f]{8})[0-9a-f]{12,}/gi, "$1…");
}

function innerMessageFromJson(raw) {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return { message: "", code: "", type: "" };
  let body = null;
  try {
    body = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return { message: "", code: "", type: "" };
  }
  const err = body?.error ?? body;
  let message = typeof err?.message === "string" ? err.message : typeof err === "string" ? err : "";
  const code = clean(err?.code) || clean(err?.error_code);
  const type = clean(err?.type);
  // Some proxies nest the real error as a JSON string inside `message`.
  if (message.trim().startsWith("{")) {
    const nested = innerMessageFromJson(message);
    if (nested.message) return nested;
  }
  return { message: message.trim(), code, type };
}

/**
 * Parses the strings the gateway hands back, e.g.
 * `[provider-id/model] [400]: {"error":{"message":"openai_error",...}} (reset after 30s)`
 * into a short readable line plus the pieces the UI shows as chips.
 */
export function formatGatewayError(input) {
  const raw = typeof input === "string"
    ? input
    : clean(input?.error?.message) || clean(input?.message) || (typeof input?.error === "string" ? input.error : "");
  const detail = raw || "Unknown error";

  let rest = detail;
  let model = "";
  let status = "";
  let cooldown = "";

  const modelMatch = /^\[([^\]]+)\]\s*/.exec(rest);
  if (modelMatch) {
    model = squeezeIds(modelMatch[1]);
    rest = rest.slice(modelMatch[0].length);
  }
  const cooldownMatch = /\s*\((reset after [^)]+|retry after [^)]+)\)\s*$/i.exec(rest);
  if (cooldownMatch) {
    cooldown = cooldownMatch[1];
    rest = rest.slice(0, cooldownMatch.index);
  }
  const statusMatch = /^\[?(\d{3})\]?:?\s*/.exec(rest);
  if (statusMatch) {
    status = statusMatch[1];
    rest = rest.slice(statusMatch[0].length);
  }

  const inner = innerMessageFromJson(rest);
  const code = inner.code || inner.type;
  let message = (inner.message || rest).trim();
  // A bare `openai_error` style token carries no meaning on its own.
  if (!message || /^bad_response_status_code$/i.test(message)) {
    message = inner.type && inner.type !== code ? inner.type : `Provider returned ${status || "an error"}`;
  }
  if (code && message.toLowerCase() !== code.toLowerCase()) message = `${message} (${code})`;

  return {
    message: message.length > 240 ? `${message.slice(0, 240)}…` : message,
    status,
    model,
    code,
    cooldown,
    detail,
  };
}
