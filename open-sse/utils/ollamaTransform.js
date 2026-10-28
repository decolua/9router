// Transform OpenAI SSE stream to Ollama JSON lines format
export function transformToOllama(response, model) {
  let buffer = "";
  let pendingToolCalls = {};
  let doneSent = false;

  // One decoder for the whole stream. A multi-byte character split across two
  // network chunks has to be held until its remaining bytes arrive; decoding
  // each chunk on its own turns both halves into replacement characters.
  const decoder = new TextDecoder("utf-8", { fatal: false });
  const encoder = new TextEncoder();

  const emit = (controller, message, done) => {
    controller.enqueue(encoder.encode(JSON.stringify({ model, message, done }) + "\n"));
  };

  // Ollama ends a stream with exactly one done:true message, and that message
  // carries the tool calls when there are any. Emitting more than one leaves a
  // client that keeps the last of them holding an empty message.
  const emitDone = (controller, message) => {
    if (doneSent) return;
    doneSent = true;
    emit(controller, message, true);
  };

  const handleLine = (line, controller) => {
    if (!line.startsWith("data:")) return;
    const data = line.slice(5).trim();

    if (data === "[DONE]") {
      emitDone(controller, { role: "assistant", content: "" });
      return;
    }

    let parsed;
    try {
      parsed = JSON.parse(data);
    } catch {
      return; // Silently ignore parse errors
    }

    const delta = parsed.choices?.[0]?.delta || {};
    const content = delta.content || "";
    const toolCalls = delta.tool_calls;

    if (toolCalls) {
      for (const tc of toolCalls) {
        const idx = tc.index;
        if (!pendingToolCalls[idx]) {
          pendingToolCalls[idx] = { id: tc.id, function: { name: "", arguments: "" } };
        }
        if (tc.function?.name) pendingToolCalls[idx].function.name += tc.function.name;
        if (tc.function?.arguments) pendingToolCalls[idx].function.arguments += tc.function.arguments;
      }
    }

    if (content) {
      emit(controller, { role: "assistant", content }, false);
    }

    const finishReason = parsed.choices?.[0]?.finish_reason;
    if (finishReason === "tool_calls" || finishReason === "stop") {
      const toolCallsArr = Object.values(pendingToolCalls);
      if (toolCallsArr.length > 0) {
        const formattedCalls = toolCallsArr.map(tc => ({
          function: {
            name: tc.function.name,
            arguments: (() => { try { return JSON.parse(tc.function.arguments || "{}"); } catch { return {}; } })()
          }
        }));
        emitDone(controller, { role: "assistant", content: "", tool_calls: formattedCalls });
        pendingToolCalls = {};
      } else if (finishReason === "stop") {
        emitDone(controller, { role: "assistant", content: "" });
      }
    }
  };

  const transform = new TransformStream({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) handleLine(line, controller);
    },
    flush(controller) {
      // A last line that arrived without its newline is still a line.
      buffer += decoder.decode();
      if (buffer.trim()) handleLine(buffer.trim(), controller);
      emitDone(controller, { role: "assistant", content: "" });
    }
  });

  if (!response.body) {
    return new Response("", { status: response.status, headers: { "Content-Type": "application/x-ndjson" } });
  }
  return new Response(response.body.pipeThrough(transform), {
    headers: { "Content-Type": "application/x-ndjson", "Access-Control-Allow-Origin": "*" }
  });
}
