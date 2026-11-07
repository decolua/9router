import { ROLE } from "../schema/index.js";

// Mistral emits thinking and text as content chunks instead of OpenAI fields.
export function normalizeMistralContent(message) {
  const parts = message?.content;
  if (!Array.isArray(parts) || !parts.length || parts.some(p => p?.type !== "thinking" && p?.type !== "text")) return message;
  const reasoning = parts.filter(p => p.type === "thinking").flatMap(p => Array.isArray(p.thinking) ? p.thinking : []).map(p => p?.text || "").join("");
  const text = parts.filter(p => p.type === "text").map(p => p.text || "").join("");
  return { ...message, content: text || null, ...(reasoning ? { reasoning_content: reasoning } : {}) };
}

// Build OpenAI delta carrying reasoning_content (optional leading assistant role)
export function reasoningDelta(text, withRole = false) {
  return withRole
    ? { role: ROLE.ASSISTANT, reasoning_content: text }
    : { reasoning_content: text };
}

// Lazily add the canonical OpenAI reasoning field when an upstream streams the
// vendor aliases instead: `reasoning` (string) and `reasoning_details[]`
// (OpenRouter-style lanes). Only ever ADDS the field — the aliases stay intact
// for clients that read them — and never touches a delta that already carries
// reasoning_content. Without this, OpenAI-shaped clients see no thinking at all:
// reasoningDelta()/the SSE→JSON aggregator/usage tracking all read
// reasoning_content.
export function liftReasoningAliases(delta) {
  if (!delta || typeof delta !== "object") return delta;
  if (typeof delta.reasoning_content === "string" && delta.reasoning_content) return delta;
  const text = extractReasoningText(delta);
  return text ? { ...delta, reasoning_content: text } : delta;
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
