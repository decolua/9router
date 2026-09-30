/**
 * Context Truncation & Pruning Helper for 9Router
 * Trims old conversation messages while preserving System prompts and recent turns.
 */

export function pruneContextMessages(body, limit = 20) {
  if (!body || typeof body !== "object") return;
  const maxKeep = Math.max(4, Number(limit) || 20);

  // OpenAI / Claude format: body.messages
  if (Array.isArray(body.messages) && body.messages.length > maxKeep + 1) {
    const systemMsgs = body.messages.filter((m) => m.role === "system");
    const nonSystemMsgs = body.messages.filter((m) => m.role !== "system");

    if (nonSystemMsgs.length > maxKeep) {
      const keptNonSystem = nonSystemMsgs.slice(-maxKeep);
      body.messages = [...systemMsgs, ...keptNonSystem];
    }
  }

  // OpenAI Responses format: body.input
  if (Array.isArray(body.input) && body.input.length > maxKeep + 1) {
    const systemInputs = body.input.filter((m) => m.role === "system");
    const nonSystemInputs = body.input.filter((m) => m.role !== "system");

    if (nonSystemInputs.length > maxKeep) {
      const keptNonSystem = nonSystemInputs.slice(-maxKeep);
      body.input = [...systemInputs, ...keptNonSystem];
    }
  }

  // Gemini format: body.contents
  if (Array.isArray(body.contents) && body.contents.length > maxKeep) {
    body.contents = body.contents.slice(-maxKeep);
  }
}
