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
  let openTagType = null; // track which tag was opened: 'think' or 'thinking'
  const OPEN_THINK = "<" + "think" + ">";
  const CLOSE_THINK = "<" + "/" + "think" + ">";
  const OPEN_THINKING = "<" + "thinking" + ">";
  const CLOSE_THINKING = "<" + "/" + "thinking" + ">";

  function feed(text) {
    if (!text) return { reasoning: "", text: "" };
    
    // Concatenate with pending first
    let input = pending + text;
    
    // Strip control/configuration BLOCKS entirely (opening tag + content + closing tag)
    // These are metadata directives, not reasoning content
    
    // Strip full control blocks: <thinking_mode ...>CONTENT</thinking_mode>
    // Match any opening variant followed by content and closing tag
    input = input.replace(/<thinking_mode[^>]*>[\s\S]*?<\/thinking_mode>/g, '');
    
    // Strip orphaned control tags (opening without closing, or closing without opening)
    input = input.replace(/<thinking_mode[^>]*>/g, '');
    input = input.replace(/<\/thinking_mode>/g, '');
    
    // Strip max_thinking_length blocks and tags
    input = input.replace(/<max_thinking_length[^>]*>[\s\S]*?<\/max_thinking_length>/g, '');
    input = input.replace(/<max_thinking_length[^>]*>/g, '');
    input = input.replace(/<\/max_thinking_length>/g, '');
    
    let i = 0;
    let reasoning = "";
    let cleaned = "";

    while (i < input.length) {
      if (!inThinking) {
        // Look for either opening tag
        const idxThink = input.indexOf(OPEN_THINK, i);
        const idxThinking = input.indexOf(OPEN_THINKING, i);
        let idx = -1;
        let tag = null;
        let tagType = null;

        // Find whichever comes first
        if (idxThink !== -1 && (idxThinking === -1 || idxThink < idxThinking)) {
          idx = idxThink;
          tag = OPEN_THINK;
          tagType = 'think';
        } else if (idxThinking !== -1) {
          idx = idxThinking;
          tag = OPEN_THINKING;
          tagType = 'thinking';
        }

        if (idx === -1 || idx + tag.length > input.length) break;
        const segment = input.slice(i, idx);
        cleaned += segment;
        i = idx + tag.length;
        inThinking = true;
        openTagType = tagType;
      } else {
        // Look for matching closing tag
        const tag = openTagType === 'think' ? CLOSE_THINK : CLOSE_THINKING;
        const idx = input.indexOf(tag, i);
        if (idx === -1 || idx + tag.length > input.length) break;
        const segment = input.slice(i, idx);
        reasoning += segment;
        i = idx + tag.length;
        inThinking = false;
        openTagType = null;
      }
    }

    const tail = input.slice(i);
    // Only buffer suffix if an unclosed '<' in tail could begin a partial tag.
    const lastAngle = tail.lastIndexOf("<");
    let safeLen = tail.length;
    if (lastAngle !== -1) {
      const afterAngle = tail.slice(lastAngle);
      // Check if afterAngle could be a partial of any expected tag
      let isPartialMatch = false;
      if (inThinking) {
        // Look for partial close tag matching the opened tag type
        const wantTag = openTagType === 'think' ? CLOSE_THINK : CLOSE_THINKING;
        if (
          afterAngle.length > 0 &&
          afterAngle.length < wantTag.length &&
          wantTag.startsWith(afterAngle)
        ) {
          isPartialMatch = true;
        }
      } else {
        // Look for partial open tag (either think or thinking)
        if (
          (afterAngle.length > 0 &&
           afterAngle.length < OPEN_THINK.length &&
           OPEN_THINK.startsWith(afterAngle)) ||
          (afterAngle.length > 0 &&
           afterAngle.length < OPEN_THINKING.length &&
           OPEN_THINKING.startsWith(afterAngle))
        ) {
          isPartialMatch = true;
        }
      }
      if (isPartialMatch) {
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
      openTagType = null;
    },
  };
}
