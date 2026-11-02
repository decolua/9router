import { ROLE, CLAUDE_BLOCK } from "../schema/index.js";

// Anthropic rejects whitespace at the end of an assistant prefill. Run after
// compression, and copy changed branches so a fallback can reuse the input.
export function normalizeClaudeAssistantTail(body) {
  if (!Array.isArray(body?.messages)) return body;
  let messages = body.messages;
  while (messages.at(-1)?.role === ROLE.ASSISTANT) {
    const last = messages.at(-1);
    let content = last.content;
    if (typeof content === "string") {
      content = content.trimEnd();
    } else if (Array.isArray(content)) {
      let end = content.length;
      while (end > 0) {
        const block = content[end - 1];
        // Never rewrite tools, media, or signed thinking blocks.
        if (block?.type !== CLAUDE_BLOCK.TEXT || typeof block.text !== "string") break;
        const text = block.text.trimEnd();
        if (text) {
          if (text !== block.text || end !== content.length) {
            content = [...content.slice(0, end - 1), { ...block, text }];
          }
          break;
        }
        end--;
      }
      if (end !== content.length) content = content.slice(0, end);
    } else {
      break;
    }

    // An empty prefill carries no content. Remove it instead of sending an
    // empty text block or inventing assistant text, then check the exposed tail.
    if (content.length === 0) {
      messages = messages.slice(0, -1);
      continue;
    }
    if (content !== last.content) {
      messages = [...messages.slice(0, -1), { ...last, content }];
    }
    break;
  }
  return messages === body.messages ? body : { ...body, messages };
}
