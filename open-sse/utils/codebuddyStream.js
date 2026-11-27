import { OPENAI_FINISH } from "../translator/schema/index.js";
import { SSE_DONE } from "./sseConstants.js";

const encoder = new TextEncoder();

export function normalizeCodeBuddyStream(body) {
  const decoder = new TextDecoder();
  const openChoices = new Map();
  const finishedChoices = new Set();
  let buffer = "";
  let lastChunk;
  let usage;
  let errorSeen = false;
  let doneSeen = false;

  function processLine(line, controller) {
    if (doneSeen) return;
    const trimmed = line.trim();
    if (trimmed === "event: error") errorSeen = true;
    if (trimmed.startsWith("data:")) {
      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") {
        doneSeen = true;
        if (!errorSeen && openChoices.size > 0) {
          const { id, model, created } = lastChunk;
          const choices = Array.from(openChoices, ([index, toolCallSeen]) => ({
            index,
            delta: {},
            finish_reason: toolCallSeen ? OPENAI_FINISH.TOOL_CALLS : OPENAI_FINISH.STOP,
          }));
          const terminal = { id, model, created, object: "chat.completion.chunk", choices, usage };
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(terminal)}\n\n`));
        }
        controller.enqueue(encoder.encode(SSE_DONE));
        return;
      }
      try {
        const chunk = JSON.parse(data);
        if (chunk?.error || chunk?.type === "error") errorSeen = true;
        if (chunk?.usage) usage = chunk.usage;
        if (Array.isArray(chunk?.choices)) {
          let changed = false;
          chunk.choices.forEach((choice, position) => {
            if (!choice || typeof choice !== "object") return;
            const index = choice.index ?? position;
            if (choice.finish_reason === "") {
              choice.finish_reason = null;
              changed = true;
            }
            if (choice.finish_reason) {
              finishedChoices.add(index);
              openChoices.delete(index);
            } else if (choice.delta && !finishedChoices.has(index)) {
              const hasTool = Boolean(choice.delta.tool_calls?.length);
              openChoices.set(index, hasTool || openChoices.get(index) === true);
              lastChunk = chunk;
            }
          });
          if (changed) line = `data: ${JSON.stringify(chunk)}`;
        }
      } catch {
        // Leave parsing of other upstream frames to the downstream SSE handler.
      }
    }
    controller.enqueue(encoder.encode(line + "\n"));
  }

  return body.pipeThrough(new TransformStream({
    transform(bytes, controller) {
      buffer += decoder.decode(bytes, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const line of lines) processLine(line, controller);
    },
    flush(controller) {
      buffer += decoder.decode();
      if (buffer) processLine(buffer, controller);
    },
  }));
}
