/**
 * Normalize CodeBuddy chat.completion.chunk dirt to OpenAI mid-stream norms.
 * - finish_reason:"" → null (not terminal)
 * - empty function_call shells on delta → drop
 */

/**
 * @param {object} chunk
 * @returns {object}
 */
export function normalizeChatChunk(chunk) {
  if (!chunk || typeof chunk !== "object" || !Array.isArray(chunk.choices)) {
    return chunk;
  }

  let changed = false;
  const choices = chunk.choices.map((choice) => {
    if (!choice || typeof choice !== "object") return choice;
    let next = choice;

    if (choice.finish_reason === "") {
      next = { ...next, finish_reason: null };
      changed = true;
    }

    const delta = next.delta;
    if (delta && typeof delta === "object" && delta.function_call) {
      const fc = delta.function_call;
      const name = fc?.name;
      const args = fc?.arguments;
      const emptyName = name == null || name === "";
      const emptyArgs = args == null || args === "";
      if (emptyName && emptyArgs) {
        const { function_call: _drop, ...restDelta } = delta;
        next = { ...next, delta: restDelta };
        changed = true;
      }
    }

    return next;
  });

  return changed ? { ...chunk, choices } : chunk;
}

/**
 * TransformStream: rewrite SSE `data: {...}` JSON lines through normalizeChatChunk.
 * Pass-through for [DONE], comments, and non-JSON data.
 * @returns {TransformStream}
 */
export function createSseNormalizeTransform() {
  let buffer = "";
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  return new TransformStream({
    transform(chunk, controller) {
      buffer += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
      const parts = buffer.split("\n");
      buffer = parts.pop() ?? "";

      for (const line of parts) {
        controller.enqueue(encoder.encode(`${rewriteSseLine(line)}\n`));
      }
    },
    flush(controller) {
      if (buffer.length) {
        controller.enqueue(encoder.encode(rewriteSseLine(buffer)));
        buffer = "";
      }
    },
  });
}

function rewriteSseLine(line) {
  if (!line.startsWith("data:")) return line;
  const payload = line.slice(5).trimStart();
  if (!payload || payload === "[DONE]") return line;
  try {
    const obj = JSON.parse(payload);
    const norm = normalizeChatChunk(obj);
    if (norm === obj) return line;
    return `data: ${JSON.stringify(norm)}`;
  } catch {
    return line;
  }
}
