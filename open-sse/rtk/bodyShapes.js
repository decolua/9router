// Resolve the mutable conversation turn array from any supported request body shape.
// Used by context pruning and prompt dedup so optimizations run before format translation.

export function resolveConversationItems(body) {
  if (!body || typeof body !== "object") return null;
  if (Array.isArray(body.messages)) return body.messages;
  if (Array.isArray(body.input)) return body.input;
  if (Array.isArray(body.contents)) return body.contents;
  if (Array.isArray(body.request?.contents)) return body.request.contents;
  if (Array.isArray(body.params?.messages)) return body.params.messages;
  return null;
}

export function isGeminiLikeFormat(format) {
  return format === "gemini" || format === "gemini-cli" || format === "vertex" || format === "antigravity";
}
