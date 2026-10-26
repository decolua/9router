/**
 * Assemble an Anthropic Message from a Claude SSE stream.
 *
 * handleNonStreamingResponse already tolerates a provider that answers
 * text/event-stream to a non-streaming request, but it parsed that body with
 * parseSSEToOpenAIResponse regardless of targetFormat. That parser reads
 * `choices[].delta`, a shape Anthropic SSE never has, so an anthropic-format
 * upstream that streams anyway left the client with a 200 carrying
 * `content: ""` and `usage: {}` instead of the answer (observed against
 * claude-haiku-4-5 behind an anthropic-compatible proxy on
 * /v1/chat/completions, while /v1/messages answered correctly).
 *
 * Rebuilding the Message keeps the response in the upstream's own format, so
 * the usual claude -> client translation downstream still applies unchanged.
 *
 * Returns null when the stream carried no `message_start`, or `{ error }` when
 * the stream failed mid-flight.
 */
export function parseClaudeSSEToMessage(rawSSE, fallbackModel = null) {
  let message = null;
  let error = null;
  const blocks = new Map(); // content block index → block being accumulated

  for (const line of String(rawSSE || "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;

    let event;
    try {
      event = JSON.parse(payload);
    } catch {
      continue; // ignore malformed lines, same as the OpenAI parser
    }

    switch (event.type) {
      case "error":
        error = event.error || event;
        break;

      case "message_start":
        // Carries id, model, role, stop_reason and the input/cache token counts.
        message = { ...(event.message || {}), content: [] };
        break;

      case "content_block_start":
        blocks.set(event.index, { ...(event.content_block || {}), _text: "", _json: "" });
        break;

      case "content_block_delta": {
        const block = blocks.get(event.index);
        if (!block) break;
        const delta = event.delta || {};
        // text_delta → text, thinking_delta → thinking: one accumulator, the
        // block type decides which field it lands in (see finalizeBlock).
        if (typeof delta.text === "string") block._text += delta.text;
        if (typeof delta.thinking === "string") block._text += delta.thinking;
        if (typeof delta.partial_json === "string") block._json += delta.partial_json;
        if (typeof delta.signature === "string") block.signature = delta.signature;
        break;
      }

      case "message_delta":
        if (!message) break;
        if (event.delta?.stop_reason !== undefined) message.stop_reason = event.delta.stop_reason;
        if (event.delta?.stop_sequence !== undefined) message.stop_sequence = event.delta.stop_sequence;
        // message_delta carries only output_tokens; merge so the input/cache
        // counters captured at message_start survive.
        if (event.usage) message.usage = { ...(message.usage || {}), ...event.usage };
        break;
    }
  }

  if (error) return { error };
  if (!message) return null;

  message.content = [...blocks.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, block]) => finalizeBlock(block));
  if (!message.model && fallbackModel) message.model = fallbackModel;
  return message;
}

function finalizeBlock(block) {
  const { _text, _json, ...rest } = block;

  if (rest.type === "thinking") return { ...rest, thinking: _text };
  if (rest.type === "tool_use" || rest.type === "server_tool_use") {
    let input = rest.input || {};
    if (_json) {
      try {
        input = JSON.parse(_json);
      } catch { /* truncated stream: keep whatever input_json_delta gave us */ }
    }
    return { ...rest, input };
  }
  // text and anything unknown: a text block is the only other delta-carrying type.
  return rest.type === "text" ? { ...rest, text: _text } : rest;
}
