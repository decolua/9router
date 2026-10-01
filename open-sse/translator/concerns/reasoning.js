import { ROLE } from "../schema/index.js";

// Build OpenAI delta carrying reasoning_content (optional leading assistant role)
export function reasoningDelta(text, withRole = false) {
  return withRole
    ? { role: ROLE.ASSISTANT, reasoning_content: text }
    : { reasoning_content: text };
}

// Extract reasoning text from a streamed OpenAI-compatible delta across vendor shapes:
//   - reasoning_content (GLM, Qwen, DeepSeek, Kimi, Step, Hunyuan)
//   - reasoning (some compat layers)
//   - reasoning_details[] (MiniMax reasoning_split=true): [{ text|content }]
// Returns concatenated reasoning string, or "" when none.
export function extractReasoningText(delta) {
  if (!delta || typeof delta !== "object") return "";
  if (typeof delta.reasoning_content === "string" && delta.reasoning_content) return delta.reasoning_content;
  if (typeof delta.reasoning === "string" && delta.reasoning) return delta.reasoning;
  const details = delta.reasoning_details;
  if (Array.isArray(details)) {
    return details.map((d) => (typeof d === "string" ? d : d?.text || d?.content || "")).join("");
  }
  return "";
}

// Concatenate a Mistral thinking chunk payload: `thinking` is a string or a
// list of text chunks ({ type: "text", text } | string).
function joinThinkingParts(parts) {
  if (typeof parts === "string") return parts;
  if (!Array.isArray(parts)) return "";
  return parts.map((p) => (typeof p === "string" ? p : p?.text || "")).join("");
}

// Mistral reasoning models (magistral-*, mistral-medium-3.5 with reasoning_effort)
// return assistant content as a list of chunks instead of a plain string:
//   thinking chunk: { type: "thinking", thinking: <string | [{ type: "text", text }]>, closed? }
//   text chunk:     { type: "text", text }
// Standard OpenAI-compatible clients expect string `content` + `reasoning_content`.
// Returns { text, thinking } or null when content is not a chunk list.
export function splitChunkedContent(content) {
  if (!Array.isArray(content)) return null;
  let text = "";
  let thinking = "";
  for (const chunk of content) {
    if (typeof chunk === "string") { text += chunk; continue; }
    if (!chunk || typeof chunk !== "object") continue;
    if (chunk.type === "thinking") thinking += joinThinkingParts(chunk.thinking);
    else if (typeof chunk.text === "string") text += chunk.text;
  }
  return { text, thinking };
}

// Normalize an OpenAI chat delta/message whose `content` is a Mistral chunk
// list: rewrite content to the concatenated text and move thinking chunks into
// reasoning_content (appended when the field already carries reasoning).
// Returns true when the holder was rewritten, false otherwise.
export function normalizeChunkedContent(holder) {
  if (!holder || typeof holder !== "object") return false;
  const split = splitChunkedContent(holder.content);
  if (!split) return false;
  holder.content = split.text;
  if (split.thinking) {
    holder.reasoning_content = (typeof holder.reasoning_content === "string" ? holder.reasoning_content : "") + split.thinking;
  }
  return true;
}
