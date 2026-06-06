/**
 * Validate OpenAI-style tool call arguments before returning a successful
 * response to clients. Some upstreams can return HTTP 200 while truncating
 * function.arguments mid-JSON; coding agents then try to execute broken tool
 * calls and poison the session. Treat that as a retryable upstream failure so
 * combo/account fallback can try the next route.
 */

/**
 * @param {unknown} value
 * @returns {string}
 */
function preview(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return String(text || "").slice(0, 160);
}

/**
 * Validate JSON-like function arguments for a single tool call.
 * OpenAI-compatible chat completions should expose function.arguments as a
 * JSON string. Empty string is tolerated for providers that stream name first,
 * but non-empty strings must parse as JSON.
 *
 * @param {object} toolCall
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function validateToolCallArguments(toolCall) {
  const fn = toolCall?.function;
  if (!fn) return { ok: true };

  const args = fn.arguments;
  if (args == null || args === "") return { ok: true };

  if (typeof args !== "string") {
    try {
      JSON.stringify(args);
      return { ok: true };
    } catch {
      return { ok: false, reason: `non-serializable tool arguments for ${fn.name || "unknown"}` };
    }
  }

  try {
    JSON.parse(args);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: `malformed tool arguments for ${fn.name || "unknown"}: ${err?.message || "invalid JSON"} (prefix=${JSON.stringify(preview(args))})`,
    };
  }
}

/**
 * Validate all tool_calls in an OpenAI-style chat completion response.
 * @param {object} responseBody
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function validateChatCompletionToolCalls(responseBody) {
  const choices = Array.isArray(responseBody?.choices) ? responseBody.choices : [];
  for (const choice of choices) {
    const calls = choice?.message?.tool_calls;
    if (!Array.isArray(calls)) continue;
    for (const call of calls) {
      const result = validateToolCallArguments(call);
      if (!result.ok) return result;
    }
  }
  return { ok: true };
}
