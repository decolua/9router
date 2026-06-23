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

// Stateful splitter for inline "think" tags inside streamed content.
// Handles tags that span chunk boundaries (e.g. "<thin" + "k>...").
// Mirrors openai-responses.js semantics but exposes { reasoning, text }
// so it works in accumulation contexts (no event emission needed).
export function createThinkTagSplitter() {
  let pending = "";
  let inThinking = false;
  const OPEN = "<" + "think" + ">";
  const CLOSE = "<" + "/" + "think" + ">";

  function feed(text) {
    if (!text) return { reasoning: "", text: "" };
    const input = pending + text;
    let i = 0;
    let reasoning = "";
    let cleaned = "";

    while (i < input.length) {
      const tag = inThinking ? CLOSE : OPEN;
      const idx = input.indexOf(tag, i);
      // Only a real match if the tag fully fits in the remaining buffer
      // (indexOf can return a hit position when only the prefix overlaps).
      if (idx === -1 || idx + tag.length > input.length) break;
      const segment = input.slice(i, idx);
      if (inThinking) reasoning += segment;
      else cleaned += segment;
      i = idx + tag.length;
      inThinking = !inThinking;
    }

    const tail = input.slice(i);
    // Only buffer suffix if an unclosed '<' in tail could begin a partial tag.
    const wantTag = inThinking ? CLOSE : OPEN;
    const lastAngle = tail.lastIndexOf("<");
    let safeLen = tail.length;
    if (lastAngle !== -1) {
      const afterAngle = tail.slice(lastAngle);
      // afterAngle is a candidate partial if it's a non-empty prefix of wantTag
      // (strictly shorter than wantTag, so the tag isn't complete yet).
      if (
        afterAngle.length > 0 &&
        afterAngle.length < wantTag.length &&
        wantTag.startsWith(afterAngle)
      ) {
        safeLen = lastAngle;
      }
    }
    const safeSegment = tail.slice(0, safeLen);
    const pendingPart = tail.slice(safeLen);
    if (inThinking) reasoning += safeSegment;
    else cleaned += safeSegment;
    pending = pendingPart;

    return { reasoning, text: cleaned };
  }

  return {
    feed,
    isInThinking: () => inThinking,
    reset: () => {
      pending = "";
      inThinking = false;
    },
  };
}
